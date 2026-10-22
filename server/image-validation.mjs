// Bounded structural validation before any image leaves the local machine.
// Images are never executed or decoded on the HTTP server. Downstream model
// decoders still decide whether the compressed pixels are readable.
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 40_000_000;
export class ImageValidationError extends Error {
  constructor(message) { super(message); this.code = 'INVALID_IMAGE'; }
}
const invalid = message => { throw new ImageValidationError(message); };
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const crcTable = new Uint32Array(256).map((_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function pngDimensions(buffer) {
  let offset = 8, dimensions, imageData = false, ended = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset), end = offset + 12 + length;
    if (end > buffer.length) invalid('PNG 文件不完整。');
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type) || crc32(buffer.subarray(offset + 4, end - 4)) !== buffer.readUInt32BE(end - 4)) invalid('PNG 图片校验失败，请重新导出。');
    if (!dimensions) {
      if (type !== 'IHDR' || length !== 13) invalid('PNG 图片头无效。');
      dimensions = [buffer.readUInt32BE(offset + 8), buffer.readUInt32BE(offset + 12)];
      if (![1, 2, 4, 8, 16].includes(buffer[offset + 16]) || ![0, 2, 3, 4, 6].includes(buffer[offset + 17]) || buffer[offset + 18] || buffer[offset + 19] || buffer[offset + 20] > 1) invalid('PNG 图片编码无效。');
    } else if (type === 'IHDR') invalid('PNG 图片包含重复文件头。');
    if (type === 'acTL') invalid('请上传静态 PNG，暂不支持动画图片。');
    if (type === 'IDAT' && length) imageData = true;
    if (type === 'IEND') { if (length || end !== buffer.length) invalid('PNG 图片末尾无效。'); ended = true; break; }
    offset = end;
  }
  if (!dimensions || !imageData || !ended) invalid('PNG 文件不完整。');
  return dimensions;
}
function jpegDimensions(buffer) {
  let offset = 2, dimensions, scan = false, ended = false;
  while (offset < buffer.length) {
    if (buffer[offset++] !== 255) invalid('JPEG 标记无效。');
    while (buffer[offset] === 255) offset++;
    const marker = buffer[offset++];
    if (marker === 0xd9) { ended = offset === buffer.length; break; }
    if (marker === 0xd8 || marker === 0 || marker === undefined) invalid('JPEG 文件头无效。');
    if (marker >= 0xd0 && marker <= 0xd7 || marker === 1) continue;
    if (offset + 2 > buffer.length) invalid('JPEG 文件不完整。');
    const length = buffer.readUInt16BE(offset), end = offset + length;
    if (length < 2 || end > buffer.length) invalid('JPEG 文件不完整。');
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 8) invalid('JPEG 尺寸无效。');
      if (dimensions) invalid('JPEG 包含重复图像帧头。');
      dimensions = [buffer.readUInt16BE(offset + 5), buffer.readUInt16BE(offset + 3)];
    }
    offset = end;
    if (marker === 0xda) {
      scan = true;
      while (offset < buffer.length) {
        if (buffer[offset] !== 255) { offset++; continue; }
        const next = buffer[offset + 1];
        if (next === 0 || next >= 0xd0 && next <= 0xd7) { offset += 2; continue; }
        if (next === 255) { offset++; continue; }
        break;
      }
    }
  }
  if (!dimensions || !scan || !ended) invalid('JPEG 文件不完整或编码暂不支持。');
  return dimensions;
}
function webpDimensions(buffer) {
  if (buffer.readUInt32LE(4) !== buffer.length - 8) invalid('WebP 文件长度无效。');
  let offset = 12, dimensions, frameDimensions, imageData = false;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString('ascii', offset, offset + 4), size = buffer.readUInt32LE(offset + 4), start = offset + 8, end = start + size;
    if (end > buffer.length) invalid('WebP 文件不完整。');
    if (type === 'ANIM' || type === 'ANMF') invalid('暂不支持动画 WebP 图片。');
    if (type === 'VP8X') {
      if (size !== 10 || buffer[start] & 2 || dimensions || imageData) invalid('WebP 图片头无效或为动画。');
      dimensions = [1 + buffer.readUIntLE(start + 4, 3), 1 + buffer.readUIntLE(start + 7, 3)];
    } else if (type === 'VP8 ') {
      if (imageData || size < 10 || buffer[start] & 1 || buffer.toString('hex', start + 3, start + 6) !== '9d012a') invalid('WebP 图像流无效。');
      frameDimensions = [buffer.readUInt16LE(start + 6) & 0x3fff, buffer.readUInt16LE(start + 8) & 0x3fff];
      dimensions ||= frameDimensions; imageData = true;
    } else if (type === 'VP8L') {
      if (imageData || size < 5 || buffer[start] !== 0x2f) invalid('WebP 图像流无效。');
      const bits = buffer.readUInt32LE(start + 1);
      if (bits >>> 29) invalid('WebP 版本不支持。');
      frameDimensions = [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1]; dimensions ||= frameDimensions; imageData = true;
    }
    offset = end + (size & 1);
  }
  if (offset !== buffer.length || !dimensions || !imageData) invalid('WebP 文件不完整。');
  if (dimensions[0] !== frameDimensions[0] || dimensions[1] !== frameDimensions[1]) invalid('WebP 画布与图像帧尺寸不一致。');
  return dimensions;
}
export function validateImage(buffer, { minDimension = 32 } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 20 || buffer.length > MAX_IMAGE_BYTES) invalid('图片无效或超过 12 MB。');
  let mime, dimensions;
  if (buffer.subarray(0, 8).equals(pngSignature)) { mime = 'image/png'; dimensions = pngDimensions(buffer); }
  else if (buffer[0] === 255 && buffer[1] === 216) { mime = 'image/jpeg'; dimensions = jpegDimensions(buffer); }
  else if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') { mime = 'image/webp'; dimensions = webpDimensions(buffer); }
  else invalid('请上传真实的 PNG、JPEG 或 WebP 图片，不支持 SVG、GIF 或其他文件。');
  const [width, height] = dimensions;
  if (width < minDimension || height < minDimension || width > 16384 || height > 16384 || width * height > MAX_IMAGE_PIXELS) invalid(`图片尺寸需至少 ${minDimension} × ${minDimension}，且不超过 4000 万像素。`);
  return { mimeType: mime, extension: mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1], width, height, bytes: buffer.length };
}
export function parseImageDataUri(value) {
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64) invalid('图片无效或超过 12 MB。');
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4) invalid('图片必须是 PNG、JPEG 或 WebP 的 base64 数据。');
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.toString('base64') !== match[2]) invalid('图片 base64 编码无效。');
  const info = validateImage(buffer);
  if (info.mimeType !== match[1]) invalid('图片格式与声明的类型不一致。');
  return { buffer, ...info };
}
