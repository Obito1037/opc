"""Encode an owned driver from deterministic frames. No neural inference."""
import argparse
import hashlib
import json
from pathlib import Path

import av
import numpy as np
from PIL import Image, ImageDraw

parser = argparse.ArgumentParser()
parser.add_argument('--directory', required=True)
args = parser.parse_args()
directory = Path(args.directory).resolve()
manifest = json.loads((directory / 'manifest.json').read_text(encoding='utf-8'))
frames = [Image.open(directory / 'frames' / f'{i:03d}.png').convert('RGB')
          for i in range(manifest['frames'])]
output = directory / 'owned-subtle-shift.mp4'
with av.open(str(output), 'w', options={'movflags': '+faststart'}) as container:
    stream = container.add_stream('libx264', rate=manifest['fps'])
    stream.width = stream.height = 256
    stream.pix_fmt = 'yuv420p'
    stream.thread_count = 1
    stream.options = {'crf': '16', 'preset': 'veryfast'}
    for index, image in enumerate(frames):
        frame = av.VideoFrame.from_image(image)
        frame.pts = index
        for packet in stream.encode(frame):
            container.mux(packet)
    for packet in stream.encode():
        container.mux(packet)

with av.open(str(output)) as container:
    decoded = [frame.to_ndarray(format='rgb24') for frame in container.decode(video=0)]
assert len(decoded) == manifest['frames']
assert len({hashlib.sha256(frame.tobytes()).digest() for frame in decoded}) == len(decoded)
motion = [float(np.mean(np.abs(b.astype(np.float32) - a.astype(np.float32))))
          for a, b in zip(decoded, decoded[1:])]
assert max(motion) > .05, 'Driver lacks meaningful decoded pixel changes'
manifest['video'] = {'file': output.name, 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
                     'frames': len(decoded), 'fps': manifest['fps'],
                     'duration': len(decoded) / manifest['fps'], 'width': 256, 'height': 256,
                     'uniqueDecodedFrames': len(decoded), 'adjacentMeanAbsolutePixelDifference': motion,
                     'audio': False}
(directory / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
frames[0].save(directory / 'first-frame.png')
sheet = Image.new('RGB', (256 * 6, 256), '#d9dedc')
for position, index in enumerate([0, 4, 8, 12, 16, 20]):
    sheet.paste(frames[index], (position * 256, 0))
sheet.save(directory / 'contact-sheet.png')
print(json.dumps({'status': 'encoded', **manifest['video'], 'verified': False}))
