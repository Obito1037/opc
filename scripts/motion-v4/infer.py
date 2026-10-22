"""CPU inference using the pretrained CVPR 2022 TPS neural motion model.

JSONL stdout is the Node job protocol; diagnostics belong on stderr.
PyAV encodes in-process, so terminating this Python process cancels all work.
Author architecture and relative-keypoint algorithm are retained (MIT).
"""
from __future__ import annotations
import argparse
import gc
import hashlib
import json
import os
from pathlib import Path
import signal
import sys
import time
import traceback

ROOT = Path(__file__).resolve().parents[2]
START = time.perf_counter()
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024*1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def emit(status='running', **fields):
    print(json.dumps({'status': status, 'elapsedSeconds': round(time.perf_counter()-START, 3), **fields}, ensure_ascii=False), flush=True)


def arguments():
    p = argparse.ArgumentParser()
    p.add_argument('--source-image', type=Path)
    p.add_argument('--driving-video', required=True, type=Path)
    p.add_argument('--output', type=Path)
    p.add_argument('--validate-only', action='store_true', help='Fully decode/check driving video without importing torch or writing images.')
    p.add_argument('--normalize-driving', action='store_true', help='Validate user video and normalize aspect ratio/fps before loading model.')
    p.add_argument('--max-frames', type=int, default=16)
    p.add_argument('--fps', type=int, default=8)
    p.add_argument('--threads', type=int, default=4)
    p.add_argument('--start-seconds', type=float, default=0)
    p.add_argument('--mode', choices=['relative', 'standard'], default='relative')
    p.add_argument('--motion-strength', type=float, default=1.0, help='Interpolate normalized neural keypoints toward source (0.05..1).')
    p.add_argument('--source-fit', choices=['contain', 'stretch'], default='contain')
    p.add_argument('--checkpoint', type=Path, default=ROOT/'asset-sources/tps-v4/taichi.pth.tar')
    p.add_argument('--upstream', type=Path, default=ROOT/'asset-sources/tps-v4/upstream')
    p.add_argument('--diagnostics', action='store_true', help='Save local research contact sheet and detailed report.')
    a = p.parse_args()
    if not 2 <= a.max_frames <= 240 or not 1 <= a.fps <= 30 or not 1 <= a.threads <= 8 or a.start_seconds < 0 or not 0.05 <= a.motion_strength <= 1:
        p.error('Require max-frames 2..240, fps 1..30, threads 1..8, start-seconds >=0, motion-strength 0.05..1')
    if a.validate_only:
        if not a.driving_video.is_file():
            p.error('Missing local driving video')
        return a
    if not a.source_image or not a.output:
        p.error('--source-image and --output required for inference')
    if a.output.suffix.lower() != '.mp4':
        p.error('output must be .mp4')
    for path in [a.source_image, a.driving_video, a.checkpoint, a.upstream/'config/taichi-256.yaml']:
        if not path.is_file():
            p.error(f'Missing local file: {path}')
    return a


def run(a):
    if a.validate_only or a.normalize_driving:
        from driver_media import inspect_driver
        normalized = a.output.with_name(a.output.stem+'.driver.mp4') if a.normalize_driving and not a.validate_only else None
        try:
            driver_report = inspect_driver(a.driving_video, fps=a.fps, max_frames=a.max_frames,
                start_seconds=a.start_seconds, output=normalized, on_progress=emit)
            if a.validate_only:
                emit(status='completed', stage='validated_driver', message='动作视频格式校验通过',
                    driver=driver_report, torchImported='torch' in sys.modules)
                return
            # Original start offset is consumed during normalization.
            run_model(a, driving_path=normalized, driving_start=0, driver_report=driver_report)
        finally:
            if normalized:
                for temporary in [normalized, normalized.with_name(normalized.stem+'.partial.mp4')]:
                    if temporary.exists():
                        temporary.unlink()
    else:
        run_model(a)


def run_model(a, driving_path=None, driving_start=None, driver_report=None):
    emit(message='加载本地 CPU 神经网络依赖', stage='dependencies')
    import av
    import numpy as np
    import psutil
    from PIL import Image, ImageOps, ImageDraw
    from scipy.spatial import ConvexHull
    import torch
    import yaml
    torch.set_num_threads(a.threads)
    torch.set_num_interop_threads(1)
    sys.path.insert(0, str(a.upstream.resolve()))
    from modules.inpainting_network import InpaintingNetwork
    from modules.keypoint_detector import KPDetector
    from modules.dense_motion import DenseMotionNetwork

    proc = psutil.Process()
    def rss():
        info = proc.memory_info()
        return round(getattr(info, 'peak_wset', info.rss)/2**20, 2)
    emit(message='载入作者 TaiChi 模型权重', stage='load', availableMemoryMiB=round(psutil.virtual_memory().available/2**20))
    config = yaml.safe_load((a.upstream/'config/taichi-256.yaml').read_text(encoding='utf-8'))['model_params']
    # weights_only forbids arbitrary checkpoint globals. mmap avoids duplicating
    # checkpoint storage; assign=True replaces meta parameters directly.
    checkpoint = torch.load(a.checkpoint, map_location='cpu', weights_only=True, mmap=True)
    with torch.device('meta'):
        inpainting = InpaintingNetwork(**config['generator_params'], **config['common_params'])
        kp = KPDetector(**config['common_params'])
        dense = DenseMotionNetwork(**config['dense_motion_params'], **config['common_params'])
    networks = [(inpainting, 'inpainting_network'), (kp, 'kp_detector'), (dense, 'dense_motion_network')]
    parameter_count = 0
    for net, key in networks:
        net.load_state_dict(checkpoint[key], strict=True, assign=True)
        net.eval()
        parameter_count += sum(p.numel() for p in net.parameters())
    del checkpoint
    gc.collect()
    if any(p.device.type != 'cpu' for net, _ in networks for p in net.parameters()):
        raise RuntimeError('Model contains unloaded or non-CPU parameters')

    source_pil = ImageOps.exif_transpose(Image.open(a.source_image)).convert('RGB')
    original_size = source_pil.size
    if a.source_fit == 'contain':
        # Preserve the full body and its aspect ratio; fit to the trained square
        # input with a border color sampled from the supplied background.
        border = source_pil.getpixel((0,0))
        source_pil = ImageOps.pad(source_pil, (256,256), color=border, method=Image.Resampling.LANCZOS)
    else:
        source_pil = source_pil.resize((256,256), Image.Resampling.LANCZOS)
    def tensor(im):
        arr = np.array(im.resize((256,256), Image.Resampling.BILINEAR), dtype=np.float32)/255.0
        return torch.from_numpy(arr).permute(2,0,1).unsqueeze(0)
    source = tensor(source_pil)
    a.output.parent.mkdir(parents=True, exist_ok=True)
    partial = a.output.with_name(a.output.stem + '.partial.mp4')
    previews, frame_times, kp_distances = [], [], []
    reader = writer = None
    try:
        reader = av.open(str(driving_path or a.driving_video))
        stream_in = reader.streams.video[0]
        if stream_in.width * stream_in.height > 4096 * 4096:
            raise ValueError('Driving video dimensions exceed local runner limit')
        writer = av.open(str(partial), 'w', options={'movflags': '+faststart'})
        stream_out = writer.add_stream('libx264', rate=a.fps)
        stream_out.width = stream_out.height = 256
        stream_out.pix_fmt = 'yuv420p'
        stream_out.options = {'crf': '18', 'preset': 'fast'}
        emitted = 0
        clip_start = a.start_seconds if driving_start is None else driving_start
        next_time = clip_start
        inference_start = time.perf_counter()
        with torch.inference_mode():
            source_kp = kp(source)
            initial_kp = None
            for index, frame in enumerate(reader.decode(stream_in)):
                frame_time = float(frame.time) if frame.time is not None else index/float(stream_in.average_rate or a.fps)
                if frame_time + 1e-7 < next_time:
                    continue
                tick = time.perf_counter()
                driving_pil = frame.to_image()
                driving_kp = kp(tensor(driving_pil))
                if initial_kp is None:
                    initial_kp = driving_kp
                    source_area = ConvexHull(source_kp['fg_kp'][0].numpy()).volume
                    driving_area = ConvexHull(initial_kp['fg_kp'][0].numpy()).volume
                    if driving_area <= 1e-8:
                        raise RuntimeError('Driving person keypoints are degenerate')
                    movement_scale = float(np.sqrt(source_area/driving_area))
                displacement = driving_kp['fg_kp'] - initial_kp['fg_kp']
                kp_distances.append(float(displacement.abs().mean()))
                normalized_kp = source_kp['fg_kp'] + displacement*movement_scale if a.mode == 'relative' else driving_kp['fg_kp']
                # Damp the learned motion representation, not rendered frames.
                # Every output still passes through dense motion + inpainting.
                target_kp = {'fg_kp': source_kp['fg_kp'] + (normalized_kp-source_kp['fg_kp'])*a.motion_strength}
                motion = dense(source_image=source, kp_driving=target_kp, kp_source=source_kp, bg_param=None, dropout_flag=False)
                prediction = inpainting(source, motion)['prediction']
                if not torch.isfinite(prediction).all():
                    raise RuntimeError('Non-finite neural prediction')
                rgb = (prediction[0].permute(1,2,0).clamp(0,1).numpy()*255).round().astype(np.uint8)
                for packet in stream_out.encode(av.VideoFrame.from_ndarray(rgb, format='rgb24')):
                    writer.mux(packet)
                emitted += 1
                next_time = clip_start + emitted/a.fps
                frame_times.append(time.perf_counter()-tick)
                if a.diagnostics:
                    previews.append((driving_pil.resize((256,256)), Image.fromarray(rgb)))
                emit(stage='inference', message='正在生成真实动作帧', frame=emitted, totalFrames=a.max_frames, frameSeconds=round(frame_times[-1],3), peakRssMiB=rss())
                del prediction, motion
                if emitted >= a.max_frames:
                    break
        if emitted < 2:
            raise RuntimeError('Driving video produced fewer than 2 frames')
        for packet in stream_out.encode():
            writer.mux(packet)
        writer.close()
        writer = None
        reader.close()
        reader = None
        # Complete decode catches a truncated encoder output before publication.
        with av.open(str(partial)) as verify:
            decoded = sum(1 for _ in verify.decode(video=0))
        if decoded != emitted:
            raise RuntimeError(f'Encoded frame mismatch: {decoded} != {emitted}')
        partial.replace(a.output)
        report = {
            'model': 'TPS CVPR2022 TaiChi pretrained neural model', 'device': 'cpu',
            'torchVersion': torch.__version__, 'threads': a.threads, 'parameters': parameter_count,
            'mode': a.mode, 'motionStrength': a.motion_strength, 'sourceFit': a.source_fit, 'sourceSize': original_size,
            'frames': emitted, 'fps': a.fps, 'width': 256, 'height': 256, 'durationSeconds': emitted/a.fps,
            'elapsedSeconds': round(time.perf_counter()-START,3), 'inferenceSeconds': round(time.perf_counter()-inference_start,3),
            'meanFrameSeconds': round(sum(frame_times)/len(frame_times),3), 'firstFrameSeconds': round(frame_times[0],3),
            'peakRssMiB': rss(), 'maxMeanKeypointDisplacement': max(kp_distances),
            'movementScale': movement_scale, 'outputBytes': a.output.stat().st_size,
            'outputSha256': sha256_file(a.output),
            'checkpointSha256': sha256_file(a.checkpoint),
            'driverValidation': driver_report,
        }
        if a.diagnostics:
            cols = min(8, emitted)
            sheet = Image.new('RGB', (cols*256, 3*280), '#202020')
            draw = ImageDraw.Draw(sheet)
            indices = np.linspace(0, emitted-1, cols).round().astype(int)
            for col, i in enumerate(indices):
                for row, im in enumerate([source_pil, previews[i][0], previews[i][1]]):
                    sheet.paste(im, (col*256,row*280+24))
                    draw.text((col*256+8,row*280+6), f"{['Source','Driver','TPS inference'][row]} / frame {i+1}", fill='white')
            sheet.save(a.output.with_suffix('.contact.png'))
            a.output.with_suffix('.report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        emit(status='completed', stage='complete', message='本地神经网络推理完成', frame=emitted, totalFrames=emitted, output=str(a.output.resolve()), **report)
    finally:
        if reader:
            reader.close()
        if writer:
            writer.close()
        if partial.exists():
            partial.unlink()


def interrupted(signum, frame):
    raise KeyboardInterrupt('cancelled')


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, interrupted)
    try:
        run(arguments())
    except KeyboardInterrupt:
        emit(status='cancelled', message='动作任务已取消')
        sys.exit(130)
    except Exception as exc:
        traceback.print_exc(file=sys.stderr)
        emit(status='failed', message=str(exc)[:500], errorType=type(exc).__name__, errorCode=getattr(exc, 'code', 'LOCAL_GENERATION_FAILED'))
        sys.exit(1)
