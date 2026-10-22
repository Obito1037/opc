"""Export decoded neural-video frames to a looping GIF; no interpolation."""
import argparse
from pathlib import Path
import av
from PIL import Image, ImageDraw

parser = argparse.ArgumentParser()
parser.add_argument('--video', required=True, type=Path)
parser.add_argument('--studio-face-study', action='store_true', help='Manual ROI diagnostic for this studio framing only')
args = parser.parse_args()
with av.open(str(args.video)) as container:
    decoded = list(container.decode(video=0))
images = [frame.to_image().convert('RGB') for frame in decoded]
if not images:
    raise ValueError('No decoded frames')
# GIF represents 10ms ticks: alternate 120/130ms to preserve 24/8 = 3s.
durations = [round(((i + 1) * .125) / .01) * 10 - round((i * .125) / .01) * 10
             for i in range(len(images))]
palette = images[0].quantize(colors=256, method=Image.Quantize.MEDIANCUT)
indexed = [image.quantize(palette=palette, dither=Image.Dither.NONE) for image in images]
target = args.video.with_suffix('.preview.gif')
indexed[0].save(target, save_all=True, append_images=indexed[1:], loop=0,
                duration=durations, disposal=2, optimize=False)
print(f'{target}: {len(images)} decoded frames, {sum(durations)} ms, palette-limited preview only')
if args.studio_face_study:
    sheet = Image.new('RGB', (6 * 228, ((len(images) + 5) // 6) * 364), '#202020')
    draw = ImageDraw.Draw(sheet)
    for index, image in enumerate(images):
        x, y = index % 6 * 228, index // 6 * 364
        # Nearest zoom preserves the decoded pixels instead of smoothing defects.
        crop = image.crop((90, 4, 166, 118)).resize((228, 342), Image.Resampling.NEAREST)
        sheet.paste(crop, (x, y + 22))
        draw.text((x + 4, y + 4), f'Frame {index + 1} / 3x nearest diagnostic', fill='white')
    sheet.save(args.video.with_suffix('.face-study.png'))
