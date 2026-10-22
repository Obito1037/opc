"""Local research-only real driver from official FOMM Fashion teaser."""
from pathlib import Path
from PIL import Image, ImageSequence
import av
import json
import hashlib

root = Path(__file__).resolve().parents[2]/'asset-sources/tps-v4'
source = root/'fashion-teaser.gif'
target = root/'fashion-driver-research.mp4'
with Image.open(source) as gif, av.open(str(target), 'w') as writer:
    stream = writer.add_stream('libx264', rate=10)
    stream.width = stream.height = 256
    stream.pix_fmt = 'yuv420p'
    stream.options = {'crf': '17', 'preset': 'fast'}
    count = 0
    for frame in ImageSequence.Iterator(gif):
        driver = frame.convert('RGB').crop((56,56,456,456)).resize((256,256), Image.Resampling.LANCZOS)
        if count == 0:
            driver.save(root/'fashion-driver-first.png')
        for packet in stream.encode(av.VideoFrame.from_image(driver)):
            writer.mux(packet)
        count += 1
    for packet in stream.encode():
        writer.mux(packet)
manifest = {
    'source': 'https://raw.githubusercontent.com/AliaksandrSiarohin/first-order-model/master/sup-mat/fashion-teaser.gif',
    'context': 'https://github.com/AliaksandrSiarohin/first-order-model#example-animations',
    'cropLTRB': [56,56,456,456], 'frames': count, 'fps': 10,
    'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
    'driverSha256': hashlib.sha256(target.read_bytes()).hexdigest(),
    'rights': 'Public author research demo; rights to fashion video not independently cleared. Local research only.'
}
(root/'fashion-driver-manifest.json').write_text(json.dumps(manifest, indent=2),encoding='utf-8')
print(json.dumps(manifest))
