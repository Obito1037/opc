"""Labelled geometric test inputs, NOT generated human animation or product assets."""
from pathlib import Path
import av
import numpy as np
from PIL import Image, ImageDraw

out = Path(__file__).resolve().parent.parent / "test-results/generation-v4"
out.mkdir(parents=True, exist_ok=True)
for name, width, height in [("custom-driving-synthetic.mp4", 256, 384), ("first-frame-wide-synthetic.mp4", 1360, 136)]:
    with av.open(str(out / name), mode="w") as container:
        stream = container.add_stream("libx264", rate=8)
        stream.width, stream.height, stream.pix_fmt = width, height, "yuv420p"
        stream.options = {"preset": "ultrafast", "threads": "1"}
        for i in range(32):
            im = Image.new("RGB", (width, height), (224, 229, 236))
            draw = ImageDraw.Draw(im)
            draw.rectangle((width // 3 + i % 8, height // 4, width * 2 // 3 + i % 8, height * 3 // 4), fill=(27, 110, 210))
            draw.text((12, 8), "SYNTHETIC API CONTRACT - NOT AI RESULT", fill=(25, 25, 30))
            draw.text((12, height - 20), f"Test frame {i + 1}/32", fill=(25, 25, 30))
            for packet in stream.encode(av.VideoFrame.from_ndarray(np.asarray(im), format="rgb24")):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)
    print(out / name)
