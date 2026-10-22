"""Bounded, local-only decoding of user-owned driving video. No torch import.

Accept MP4/MOV or WebM container bytes; strip audio and metadata when producing
the optional 256-square driver. File authenticity is not person/rights consent.
"""
from pathlib import Path
import math
import time
import av
from PIL import Image, ImageOps, ImageChops, ImageStat

MAX_BYTES = 12*1024*1024
MAX_SECONDS = 15
MAX_PIXELS = 1920*1080
MAX_FRAMES = 900
MAX_RATE = 60
CODECS = {'h264', 'hevc', 'vp8', 'vp9'}


class DriverValidationError(ValueError):
    code = 'INVALID_DRIVING_VIDEO'


def fail(message):
    raise DriverValidationError(message)


def identify(path):
    path = Path(path).resolve(strict=True)
    if not path.is_file() or not 80 <= path.stat().st_size <= MAX_BYTES:
        fail('动作视频需为本机 MP4 或 WebM 文件，且不超过 12 MB。')
    with path.open('rb') as handle:
        magic = handle.read(4096)
    if magic[4:8] == b'ftyp':
        return path, 'mp4'
    if magic[:4] == bytes.fromhex('1a45dfa3'):
        # EBML magic also identifies general Matroska. Require DocType=webm
        # inside the bounded EBML header instead of trusting an extension/MIME.
        def vint(offset, keep_marker=False):
            if offset >= len(magic) or not magic[offset]:
                fail('WebM 文件头不完整。')
            length=1
            while length <= 8 and not magic[offset] & (0x80 >> (length-1)):
                length += 1
            if length>8 or offset+length>len(magic):
                fail('WebM 文件头无效。')
            value=int.from_bytes(magic[offset:offset+length],'big')
            if not keep_marker:
                value &= (1 << (7*length))-1
            return value,length
        header_size,size_bytes=vint(4)
        end=4+size_bytes+header_size
        if end>len(magic):
            fail('WebM 文件头过大或不完整。')
        offset=4+size_bytes
        doc_type=None
        while offset<end:
            element,id_bytes=vint(offset,True)
            size,length_bytes=vint(offset+id_bytes)
            start=offset+id_bytes+length_bytes
            if start+size>end:
                fail('WebM 文件头元素不完整。')
            if element==0x4282:
                doc_type=magic[start:start+size]
            offset=start+size
        if doc_type!=b'webm':
            fail('请上传 WebM，暂不支持通用 Matroska/MKV 视频。')
        return path, 'webm'
    fail('动作视频内容不是 MP4 或 WebM；仅改扩展名不能转换格式。')


def inspect_driver(path, **kwargs):
    try:
        return _inspect_driver(path, **kwargs)
    except av.error.FFmpegError as exc:
        raise DriverValidationError('动作视频无法完整解码，请重新导出 MP4 或 WebM。') from exc


def _inspect_driver(path, *, fps=8, max_frames=24, start_seconds=0, output=None, on_progress=None):
    """Decode the complete input and optionally save bounded real frame samples.

    No upsampling/duplicating frames. Uploaded motion is limited to a single
    continuous video track. Node owns root containment, TTL and process timeout.
    """
    if not 1 <= fps <= 30 or not 2 <= max_frames <= 240 or not math.isfinite(start_seconds) or start_seconds < 0:
        fail('动作视频采样参数无效。')
    started = time.perf_counter()
    path, kind = identify(path)
    selected = []
    first_time = previous_time = None
    rate = None
    count = 0
    dimensions = None
    rotation = None
    max_gap = 0
    first_preview = None
    padding_color = None
    max_visual_difference = 0
    # Give libav a Python file object, never a client-controlled URL. Explicit
    # protocol restriction and default-disabled external MOV references prevent
    # media playlists from making network requests or loading referenced files.
    with path.open('rb') as handle, av.open(handle, mode='r', options={
        'protocol_whitelist': 'file', 'enable_drefs': '0',
        'probesize': '2097152', 'analyzeduration': '2000000',
    }) as reader:
        formats = set(reader.format.name.split(','))
        if kind == 'mp4' and 'mp4' not in formats or kind == 'webm' and 'webm' not in formats:
            fail('动作视频容器与文件头不一致。')
        if len(reader.streams.video) != 1:
            fail('请上传只有一个画面的动作视频。')
        stream = reader.streams.video[0]
        codec = stream.codec_context.name
        if codec not in CODECS or kind=='mp4' and codec not in {'h264','hevc'} or kind=='webm' and codec not in {'vp8','vp9'}:
            fail('请使用 H.264/H.265 MP4 或 VP8/VP9 WebM 动作视频。')
        dimensions = (stream.width, stream.height)
        if min(dimensions) < 128 or min(dimensions) > 1080 or max(dimensions) > 1920 or dimensions[0]*dimensions[1] > MAX_PIXELS:
            fail('动作视频应至少 128×128，且不超过 1080p 像素数量。')
        sar = stream.sample_aspect_ratio
        if sar is not None and abs(float(sar)-1) > 0.001:
            fail('请将动作视频导出为方形像素格式。')
        if int(stream.codec_context.color_trc) in (16,18):
            fail('暂不支持 HDR 动作视频，请导出普通 SDR 视频。')
        if stream.average_rate:
            rate = float(stream.average_rate)
            if not math.isfinite(rate) or not fps-0.01 <= rate <= MAX_RATE + 0.01:
                fail(f'动作视频帧率需在 {fps}–60 fps；不会复制帧来补足动作。')
        duration_hint = float(stream.duration*stream.time_base) if stream.duration is not None else reader.duration/av.time_base if reader.duration is not None else None
        if duration_hint is not None and (not math.isfinite(duration_hint) or duration_hint > MAX_SECONDS + 0.1):
            fail('动作视频不能超过 15 秒，请先剪短。')
        stream.codec_context.thread_count = 2
        if on_progress:
            on_progress(stage='validating_driver', message='正在本机检查动作视频')
        for frame in reader.decode(stream):
            count += 1
            if count > MAX_FRAMES or time.perf_counter()-started > 45:
                fail('动作视频解码工作量过大，请压缩或剪短。')
            if (frame.width,frame.height) != dimensions or frame.is_corrupt:
                fail('动作视频存在损坏帧或中途尺寸变化。')
            raw_time = float(frame.time) if frame.time is not None else (count-1)/rate if rate else None
            if raw_time is None or not math.isfinite(raw_time):
                fail('动作视频缺少可用的帧时间，请重新导出。')
            if first_time is None:
                first_time = raw_time
            frame_time = raw_time-first_time
            if frame_time < 0 or frame_time > MAX_SECONDS:
                fail('动作视频时间戳无效或超过 15 秒。')
            if previous_time is not None:
                gap = frame_time-previous_time
                if gap <= 0 or gap > 0.5:
                    fail('动作视频存在倒序、重复或严重断开的帧时间。')
                max_gap = max(max_gap, gap)
            previous_time = frame_time
            current_rotation = int(frame.rotation)
            if current_rotation % 90:
                fail('动作视频含不支持的旋转角度，请重新导出。')
            if rotation is None:
                rotation = current_rotation
            elif rotation != current_rotation:
                fail('动作视频中途改变了显示方向，请保持固定拍摄方向。')
            # Real selected frames only; the rest are still decoded to reject
            # truncated/corrupt oversized tails before loading the neural model.
            if len(selected) < max_frames and frame_time + 1e-6 >= start_seconds + len(selected)/fps:
                if frame_time-(start_seconds+len(selected)/fps) > 1/fps+1e-6:
                    fail('动作视频采样区间跳帧过多，请录制连续、稳定的视频。')
                im = frame.to_image()
                if rotation:
                    im = im.rotate(rotation, expand=True)
                preview = im.resize((64,64), Image.Resampling.BILINEAR)
                if first_preview is None:
                    first_preview = preview
                    padding_color = im.getpixel((0,0))
                else:
                    difference = sum(ImageStat.Stat(ImageChops.difference(preview,first_preview)).mean)/3
                    max_visual_difference = max(max_visual_difference,difference)
                if output is not None:
                    # Match the source photograph's aspect-ratio preservation.
                    im = ImageOps.pad(im, (256,256), method=Image.Resampling.LANCZOS, color=padding_color)
                    selected.append(im)
                else:
                    selected.append(None)
        if count < 8 or previous_time is None or previous_time < 0.9:
            fail('动作视频太短，请录制至少 3 秒的连续动作。')
        actual_rate = (count-1)/previous_time
        if not fps*0.98 <= actual_rate <= MAX_RATE + 1:
            fail(f'动作视频实际帧率需为 {fps}–60 fps。')
        frame_duration = 1/(rate or actual_rate)
        actual_duration = previous_time+frame_duration
        if actual_duration > MAX_SECONDS + 0.1:
            fail('动作视频不能超过 15 秒，请先剪短。')
        # Compare a known stream frame count; missing footer/duration in WebM
        # MediaRecorder is permitted, but selected decoded frames still required.
        if stream.frames and count != stream.frames:
            fail('动作视频解码帧数不完整，请重新导出。')
        if duration_hint is not None and actual_duration < duration_hint - max(0.3, 2*frame_duration):
            fail('动作视频结尾不完整，请重新上传或导出。')
        if len(selected) != max_frames or actual_duration+1e-6 < start_seconds+max_frames/fps:
            fail(f'动作视频不足 {max_frames} 个采样帧；请录制至少 {max_frames/fps:.1f} 秒，帧率不低于 {fps} fps。')
        if max_visual_difference < 0.05:
            fail('动作视频没有可见变化，请录制有轻微动作的视频。')
        result = {
            'container': kind, 'codec': codec, 'bytes': path.stat().st_size,
            'width': dimensions[0], 'height': dimensions[1], 'rotationDegrees': rotation,
            'durationSeconds': round(actual_duration,3), 'decodedFrames': count,
            'actualFps': round(actual_rate,3), 'maxFrameGapSeconds': round(max_gap,4),
            'selectedFrames': len(selected), 'targetFps': fps, 'targetDurationSeconds': max_frames/fps,
            'maxMeanVisualDifference': round(max_visual_difference,4),
            'personIdentityVerified': False, 'qualityVerified': False,
        }
    if output is not None:
        output = Path(output)
        if output.resolve() == path:
            fail('标准化输出不能覆盖原始动作视频。')
        output.parent.mkdir(parents=True,exist_ok=True)
        partial = output.with_name(output.stem+'.partial.mp4')
        try:
            if on_progress:
                on_progress(stage='normalizing_driver',message='正在保留比例并整理动作视频')
            with av.open(str(partial),'w',options={'movflags':'+faststart'}) as writer:
                stream = writer.add_stream('libx264',rate=fps)
                stream.width = stream.height = 256
                stream.pix_fmt = 'yuv420p'
                stream.codec_context.thread_count = 2
                stream.options = {'crf':'17','preset':'fast'}
                for im in selected:
                    for packet in stream.encode(av.VideoFrame.from_image(im)):
                        writer.mux(packet)
                for packet in stream.encode():
                    writer.mux(packet)
            with av.open(str(partial)) as check:
                if len(check.streams.audio) or sum(1 for _ in check.decode(video=0)) != max_frames:
                    fail('标准化动作视频校验失败。')
            partial.replace(output)
        finally:
            if partial.exists():
                partial.unlink()
        result['normalized'] = {'width':256,'height':256,'frames':max_frames,'fps':fps,'audio':False,'aspectRatioPreserved':True}
    result['validationSeconds'] = round(time.perf_counter()-started,3)
    return result
