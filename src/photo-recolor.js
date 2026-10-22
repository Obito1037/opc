// Edge-aware recolouring of existing fabric. No pixels outside the semantic
// clothing region are removed, displaced, or replaced with invented geometry.
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const luminance = (r, g, b) => .2126 * r + .7152 * g + .0722 * b;
const canvas = (width, height) => Object.assign(document.createElement('canvas'), { width, height });

function boxMean(input, width, height, radius) {
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += input[y * width + x];
      integral[(y + 1) * (width + 1) + x + 1] = integral[y * (width + 1) + x + 1] + row;
    }
  }
  const output = new Float32Array(input.length), stride = width + 1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const x0 = Math.max(0, x - radius), x1 = Math.min(width, x + radius + 1);
    const y0 = Math.max(0, y - radius), y1 = Math.min(height, y + radius + 1);
    output[y * width + x] = (integral[y1 * stride + x1] - integral[y0 * stride + x1]
      - integral[y1 * stride + x0] + integral[y0 * stride + x0]) / ((x1 - x0) * (y1 - y0));
  }
  return output;
}

function guidedMask(source, mask, width, height) {
  const count = width * height, lum = new Float32Array(count), square = new Float32Array(count), product = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    lum[i] = luminance(source[i * 4], source[i * 4 + 1], source[i * 4 + 2]) / 255;
    square[i] = lum[i] * lum[i]; product[i] = lum[i] * mask[i];
  }
  const radius = Math.max(2, Math.round(width / 180));
  const mean = boxMean(lum, width, height, radius), meanMask = boxMean(mask, width, height, radius);
  const corr = boxMean(product, width, height, radius), variance = boxMean(square, width, height, radius);
  const a = new Float32Array(count), b = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    a[i] = (corr[i] - mean[i] * meanMask[i]) / (variance[i] - mean[i] * mean[i] + .0006);
    b[i] = meanMask[i] - a[i] * mean[i];
  }
  const ma = boxMean(a, width, height, radius), mb = boxMean(b, width, height, radius);
  for (let i = 0; i < count; i++) mask[i] = clamp(ma[i] * lum[i] + mb[i]);
  return mask;
}

/** Build a reusable, soft fabric mask from a real clothing segmentation result. */
export function prepareRecolor(original, confidence, maskWidth, maskHeight, pose) {
  const { width, height } = original;
  if (!pose || !confidence) return null;
  const source = original.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height);
  const small = canvas(maskWidth, maskHeight), smallContext = small.getContext('2d');
  const maskPixels = smallContext.createImageData(maskWidth, maskHeight);
  for (let i = 0; i < confidence.length; i++) {
    maskPixels.data[i * 4] = maskPixels.data[i * 4 + 1] = maskPixels.data[i * 4 + 2] = 255;
    maskPixels.data[i * 4 + 3] = confidence[i] * 255;
  }
  smallContext.putImageData(maskPixels, 0, 0);
  const full = canvas(width, height), fullContext = full.getContext('2d', { willReadFrequently: true });
  fullContext.drawImage(small, 0, 0, width, height);
  const raw = fullContext.getImageData(0, 0, width, height).data;
  const mask = new Float32Array(width * height);
  const shoulderY = (pose[11].y + pose[12].y) / 2, hipY = (pose[23].y + pose[24].y) / 2;
  const shoulderX = (pose[11].x + pose[12].x) / 2, hipX = (pose[23].x + pose[24].x) / 2;
  const sw = Math.hypot(pose[11].x - pose[12].x, pose[11].y - pose[12].y), torso = hipY - shoulderY;
  if (torso < 20 || sw < 15) return null;
  // Learn the existing upper garment's colours only from its central area.
  // This separates a white tee from dark trousers even though both are clothes.
  const bins = new Map(), samples = [];
  for (let y = Math.max(0, Math.floor(shoulderY + torso * .18)); y < Math.min(height, shoulderY + torso * .72); y += 3) {
    const cx = shoulderX + (hipX - shoulderX) * ((y - shoulderY) / torso);
    for (let x = Math.max(0, Math.round(cx - sw * .28)); x < Math.min(width, cx + sw * .28); x += 3) {
      const index = y * width + x;
      if (raw[index * 4 + 3] < 210) continue;
      const r = source.data[index * 4], g = source.data[index * 4 + 1], b = source.data[index * 4 + 2];
      const key = `${r >> 5},${g >> 5},${b >> 5}`;
      const bin = bins.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      bin.n++; bin.r += r; bin.g += g; bin.b += b; bins.set(key, bin);
      samples.push(luminance(r, g, b));
    }
  }
  if (samples.length < 20) return null;
  const palette = [...bins.values()].sort((a, b) => b.n - a.n).slice(0, 12)
    .filter(bin => bin.n >= samples.length * .012).map(bin => [bin.r / bin.n, bin.g / bin.n, bin.b / bin.n]);
  samples.sort((a, b) => a - b);
  // Highly contrasted prints are ambiguous: dark motif / light cloth / skin
  // cannot be separated reliably by this local model. Keep the original rather
  // than bleach the print or paint only half of an unbroken dress.
  const darkSample = samples[Math.floor(samples.length * .10)];
  const lightSample = samples[Math.floor(samples.length * .90)];
  if (lightSample - darkSample > 105 && lightSample > darkSample * 2.6) return null;
  const referenceLuminance = Math.max(22, samples[Math.floor(samples.length * .55)]);
  let coverage = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, o = i * 4;
    if (raw[o + 3] < 70 || y < shoulderY - sw * .25 || y > hipY + torso * .2) continue;
    const r = source.data[o], g = source.data[o + 1], b = source.data[o + 2];
    let difference = Infinity;
    for (const color of palette) difference = Math.min(difference, Math.hypot(r - color[0], g - color[1], b - color[2]));
    const appearance = 1 - smooth(40, 100, difference);
    const bottom = 1 - smooth(hipY + torso * .08, hipY + torso * .2, y);
    const cx = shoulderX + (hipX - shoulderX) * clamp((y - shoulderY) / torso);
    const widthLimit = 1 - smooth(sw * .78, sw * 1.08, Math.abs(x - cx));
    mask[i] = smooth(.36, .83, raw[o + 3] / 255) * appearance * bottom * widthLimit;
    coverage += mask[i];
  }
  if (coverage < sw * torso * .10) return null;
  guidedMask(source.data, mask, width, height);
  // Sharpen high confidence interiors while retaining subpixel antialiasing.
  for (let i = 0; i < mask.length; i++) mask[i] = smooth(.10, .9, mask[i]);
  small.width = small.height = full.width = full.height = 1;
  // Cache texture terms once. Slider changes should touch fabric pixels only,
  // without re-reading the full photo or recomputing powers for every input.
  const offsets = [], alphas = [], shades = [], highlights = [];
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] <= .001) continue;
    const offset = i * 4;
    const ratio = luminance(source.data[offset], source.data[offset + 1], source.data[offset + 2]) / referenceLuminance;
    offsets.push(offset); alphas.push(mask[i]);
    shades.push(Math.pow(clamp(ratio, .04, 2.8), 1.12)); highlights.push(Math.max(0, ratio - 1.12) * 24);
  }
  return { source, mask, referenceLuminance, coverage: coverage / (width * height), palette,
    offsets: Uint32Array.from(offsets), alphas: Float32Array.from(alphas),
    shades: Float32Array.from(shades), highlights: Float32Array.from(highlights),
    output: new ImageData(new Uint8ClampedArray(source.data), width, height), cachedColor: null };
}

export function drawRecolor(context, prepared, hex, strength = 1) {
  if (!prepared) return false;
  const { source, offsets, alphas, shades, highlights, output } = prepared;
  const cacheKey = `${hex}:${strength}`;
  if (prepared.cachedColor === cacheKey) { context.putImageData(output, 0, 0); return true; }
  const color = [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16));
  for (let i = 0; i < offsets.length; i++) {
    const alpha = alphas[i] * clamp(strength), offset = offsets[i];
    // Preserve actual folds, print luminance, seams and illumination. The local
    // source texture is never replaced by a flat polygon or synthetic folds.
    for (let channel = 0; channel < 3; channel++) {
      const target = clamp(color[channel] * shades[i] + highlights[i], 0, 255);
      output.data[offset + channel] = source.data[offset + channel] * (1 - alpha) + target * alpha;
    }
  }
  prepared.cachedColor = cacheKey;
  context.putImageData(output, 0, 0);
  return true;
}
