"""Extract the real driver panel from an author's research comparison video.

No generated result panel is used. Keep the composite and attribution together.
This source is a local research fixture, not a cleared commercial asset.
"""
from pathlib import Path
import hashlib
import json
import av

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'asset-sources/tps-v4'
source = OUT / 'mraa-taichi-example1.mp4'
target = OUT / 'taichi-driver-research.mp4'
frames = 0
with av.open(str(source)) as reader, av.open(str(target), 'w') as writer:
    stream = writer.add_stream('libx264', rate=10)
    stream.width = stream.height = 256
    stream.pix_fmt = 'yuv420p'
    stream.options = {'crf': '17', 'preset': 'fast'}
    for frame in reader.decode(video=0):
        # Original 1148 x 768 comparison: 124 px labels, then real 256 px
        # driver at row 2 (also duplicated in row 3), then generated results.
        rgb = frame.to_image().crop((124, 256, 380, 512))
        if frames == 0:
            rgb.save(OUT / 'driver-first.png')
        out = av.VideoFrame.from_image(rgb)
        for packet in stream.encode(out):
            writer.mux(packet)
        frames += 1
    for packet in stream.encode():
        writer.mux(packet)
manifest = {
    'source': 'https://snap-research.github.io/articulated-animation/videos/taichi-comparison/example1.mp4',
    'context': 'https://snap-research.github.io/articulated-animation/',
    'cropLTRB': [124, 256, 380, 512],
    'frames': frames, 'fps': 10, 'width': 256, 'height': 256,
    'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
    'driverSha256': hashlib.sha256(target.read_bytes()).hexdigest(),
    'rights': 'Author-published research demonstration. No independent rights clearance for commercial use or competition redistribution. Local research fixture only.',
}
(OUT / 'driver-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
print(json.dumps(manifest))
