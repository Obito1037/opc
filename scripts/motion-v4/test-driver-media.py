"""Codec/preprocessing contract tests only; fixtures are not neural results."""
from pathlib import Path
import json
import subprocess
import sys
import time
import av
from PIL import Image, ImageDraw
from driver_media import inspect_driver, DriverValidationError

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT/'test-results/motion-v4/user-driver-contract'
OUT.mkdir(parents=True,exist_ok=True)
started = time.perf_counter()
checks = []


def fixture(name, codec='libx264', fps=12, frames=40, size=(192,320), rotation=0, motion=True):
    target=OUT/name
    with av.open(str(target),'w') as c:
        s=c.add_stream(codec,rate=fps)
        s.width,s.height=size
        s.pix_fmt='yuv420p'
        s.codec_context.thread_count=1
        if rotation:
            s.set_display_rotation(rotation)
        if codec=='libx264':
            s.options={'preset':'ultrafast','crf':'18'}
        for index in range(frames):
            im=Image.new('RGB',size,(20,40,70))
            draw=ImageDraw.Draw(im)
            # Non-human moving shape, used exclusively for geometry/codec tests.
            shift=index%10 if motion else 0
            draw.rectangle((70+shift,50,120+shift,270),fill=(240,50,30))
            for packet in s.encode(av.VideoFrame.from_image(im)):
                c.mux(packet)
        for packet in s.encode():
            c.mux(packet)
    return target


mp4=fixture('portrait.mp4')
webm=fixture('portrait.webm',codec='libvpx-vp9')
for source in [mp4,webm]:
    target=OUT/(source.stem+'-'+source.suffix[1:]+'-normalized.mp4')
    report=inspect_driver(source,output=target)
    assert report['selectedFrames']==24
    assert report['normalized']['aspectRatioPreserved'] is True
    with av.open(str(target)) as c:
        frames=[f for f in c.decode(video=0)]
        assert len(frames)==24 and len(c.streams.audio)==0
        assert c.streams.video[0].average_rate==8
        im=frames[0].to_image()
        # The original red vertical rectangle stays narrow (not stretched to square).
        pixels=im.load()
        red=[(x,y) for y in range(256) for x in range(256) if pixels[x,y][0]>180 and pixels[x,y][1]<100]
        rw=max(x for x,y in red)-min(x for x,y in red)+1
        rh=max(y for x,y in red)-min(y for x,y in red)+1
        assert .18 < rw/rh < .28,(rw,rh)
    checks.append({'case':source.suffix,'passed':True,'report':report})

# Add actual MP4 display-matrix rotation using PyAV, no external process.
rotated=fixture('rotated.mp4',rotation=90)
rotation_report=inspect_driver(rotated,output=OUT/'rotated-normalized.mp4')
assert abs(rotation_report['rotationDegrees'])==90,rotation_report
with av.open(str(OUT/'rotated-normalized.mp4')) as c:
    im=next(c.decode(video=0)).to_image()
    points=[(x,y) for y in range(256) for x in range(256) if im.getpixel((x,y))[0]>180 and im.getpixel((x,y))[1]<100]
    assert max(x for x,y in points)-min(x for x,y in points)>3*(max(y for x,y in points)-min(y for x,y in points))
checks.append({'case':'rotation_metadata_applied','passed':True,'report':rotation_report})

fake=OUT/'fake.mp4'
fake.write_bytes(b'<html>not a video</html>'+b' '*100)
truncated=OUT/'truncated.mp4'
truncated.write_bytes(mp4.read_bytes()[:mp4.stat().st_size//2])
short=fixture('short.mp4',frames=10)
long=fixture('long.mp4',fps=8,frames=128)
lowfps=fixture('low-fps.mp4',fps=4,frames=16)
still=fixture('still.mp4',motion=False)
for label,source in [('fake',fake),('truncated',truncated),('short',short),('long',long),('still',still),('lowfps',lowfps)]:
    target=OUT/(label+'-should-not-exist.mp4')
    try:
        inspect_driver(source,output=target)
    except (DriverValidationError,av.error.FFmpegError) as exc:
        assert not target.exists()
        checks.append({'case':label,'passed':True,'rejected':type(exc).__name__})
    else:
        raise AssertionError(f'{label} input unexpectedly accepted')

cli=subprocess.run([sys.executable,str(ROOT/'scripts/motion-v4/infer.py'),'--validate-only',
    '--driving-video',str(webm),'--max-frames','24','--fps','8'],capture_output=True,encoding='utf-8',check=True)
events=[json.loads(line) for line in cli.stdout.splitlines()]
assert events[-1]['torchImported'] is False
assert events[-1]['stage']=='validated_driver'
checks.append({'case':'validate_only_cli_no_torch','passed':True})
assert 'torch' not in sys.modules
report={'passed':True,'neuralInference':False,'torchImported':False,'seconds':round(time.perf_counter()-started,3),'checks':checks}
(OUT/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))
