export const MAX_VIDEO_BYTES = 80 * 1024 * 1024;
const fail = () => { throw Object.assign(new Error('动作服务未返回完整、可识别的 MP4 视频。'), { code: 'INVALID_VIDEO' }); };
function boxes(bytes, start = 0, end = bytes.length) {
  const result = [];
  for (let offset = start; offset < end;) {
    if (offset + 8 > end) fail();
    let length = bytes.readUInt32BE(offset), header = 8;
    if (length === 1) { if (offset + 16 > end) fail(); const big = bytes.readBigUInt64BE(offset + 8); if (big > BigInt(Number.MAX_SAFE_INTEGER)) fail(); length = Number(big); header = 16; }
    if (length === 0) length = end - offset;
    if (length < header || offset + length > end) fail();
    result.push({ type: bytes.toString('ascii', offset + 4, offset + 8), start: offset + header, end: offset + length });
    offset += length;
  }
  return result;
}
// Structural ISO-BMFF validation, not full video decoding. The browser performs
// actual codec decoding; no arbitrary server URL or HTML is served as a result.
export function validateVideo(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 80 || bytes.length > MAX_VIDEO_BYTES) fail();
  const root = boxes(bytes), ftyp = root.find(b => b.type === 'ftyp'), moov = root.find(b => b.type === 'moov');
  if (root[0]?.type !== 'ftyp' || !ftyp || ftyp.end - ftyp.start < 8 || !moov || !root.some(b => b.type === 'mdat' && b.end > b.start)) fail();
  const children = boxes(bytes, moov.start, moov.end), mvhd = children.find(b => b.type === 'mvhd');
  if (!mvhd) fail();
  const version = bytes[mvhd.start], timeOffset = mvhd.start + (version === 1 ? 20 : 12);
  if (version > 1 || timeOffset + (version === 1 ? 12 : 8) > mvhd.end) fail();
  const scale = bytes.readUInt32BE(timeOffset), duration = version === 1 ? Number(bytes.readBigUInt64BE(timeOffset + 4)) : bytes.readUInt32BE(timeOffset + 4);
  const durationSeconds = duration / scale;
  if (!scale || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 30) fail();
  let width, height;
  for (const track of children.filter(b => b.type === 'trak')) {
    const tkhd = boxes(bytes, track.start, track.end).find(b => b.type === 'tkhd');
    if (!tkhd || tkhd.end - tkhd.start < 8) continue;
    const w = bytes.readUInt32BE(tkhd.end - 8) / 65536, h = bytes.readUInt32BE(tkhd.end - 4) / 65536;
    if (w && h) { width = w; height = h; break; }
  }
  if (!width || !height || width > 4096 || height > 4096) fail();
  return { mimeType: 'video/mp4', width, height, durationSeconds, bytes: bytes.length };
}
