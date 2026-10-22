// Local 2D product placement using detected landmarks, not generative try-on.
// Coordinates are pixels in the original bounded photo, never stage CSS pixels.
export const PRODUCT_TYPES = Object.freeze(['shoe', 'glasses', 'earrings', 'necklace']);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback, min, max) => Number.isFinite(value) ? clamp(value, min, max) : fallback;
const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const middle = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const ordered = (a, b) => a.x <= b.x ? [a, b] : [b, a];
const fail = message => ({ available: false, message, anchors: [] });
function inFrame(point, width, height) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= width &&
    point.y >= 0 && point.y <= height;
}
function valid(point, width, height, confidence = .65) {
  return inFrame(point,width,height) && Number.isFinite(point.visibility ?? 1) && Number.isFinite(point.presence ?? 1) &&
    (point.visibility ?? 1) >= confidence && (point.presence ?? 1) >= confidence;
}

export function getProductAnchors({ face, pose, width, height } = {}, type) {
  if (!PRODUCT_TYPES.includes(type)) return fail('请选择鞋履、眼镜、耳饰或项链。');
  if (!(width > 0 && height > 0)) return fail('请先上传清晰的人物照片。');
  // FaceLandmarker does not predict per-point visibility/presence. Its shared
  // JS landmark adapter exposes missing fields as 0, unlike Pose scores.
  // Use detected face geometry here; keep actual Pose confidence gates below.
  const faceValid = ids => ids.every(i => inFrame(face?.[i], width, height));
  const poseValid = ids => ids.every(i => valid(pose?.[i], width, height));
  const ready = anchors => ({ available: true, message: '已识别商品定位点；这是二维叠加预览，可手动微调。', anchors });
  if (type === 'glasses') {
    if (!faceValid([33, 133, 263, 362])) return fail('未识别到清晰双眼，请使用无遮挡的正面人物照。');
    const [left, right] = ordered(middle(face[33], face[133]), middle(face[263], face[362]));
    const span = distance(left, right), smallerEye = Math.min(distance(face[33], face[133]), distance(face[263], face[362]));
    const largerEye = Math.max(distance(face[33], face[133]), distance(face[263], face[362]));
    if (span < 8 || smallerEye < 2 || smallerEye / largerEye < .35) return fail('双眼过小或侧脸角度过大，请换用更清晰的正面照。');
    return ready([{ ...middle(left, right), width: span * 2.05, angle: Math.atan2(right.y - left.y, right.x - left.x), pivotY: .5, mirror: false }]);
  }
  if (type === 'earrings') {
    // FaceMesh has cheek contours, not measured ear lobes. Require Pose's
    // actual ear landmarks instead of substituting a jaw/face-edge estimate.
    if (!poseValid([7, 8])) return fail('未可靠识别到双耳，请使用双耳可见、无遮挡的人物照。');
    const [left, right] = ordered(pose[7], pose[8]), span = distance(left, right);
    if (span < 18) return fail('双耳间距过小，请使用更清晰的人物照。');
    const angle = Math.atan2(right.y - left.y, right.x - left.x);
    return ready([left, right].map((point, index) => ({ ...point, width: span * .105, angle, pivotY: .08, mirror: index === 1 })));
  }
  if (type === 'necklace') {
    if (!poseValid([11, 12])) return fail('未可靠识别到双肩，请让肩部完整进入照片。');
    const [left, right] = ordered(pose[11], pose[12]), span = distance(left, right);
    if (span < 24) return fail('肩部过小，无法可靠放置项链，请换用清晰照片。');
    return ready([{ ...middle(left, right), width: span * .49, angle: Math.atan2(right.y - left.y, right.x - left.x), pivotY: .1, mirror: false }]);
  }
  if (!poseValid([27, 28, 29, 30, 31, 32])) return fail('脚部被裁切、遮挡或置信度不足，请上传双脚完整可见的全身照。');
  const anchors = [];
  for (const [heelId, toeId] of [[29, 31], [30, 32]]) {
    const heel = pose[heelId], toe = pose[toeId], length = distance(heel, toe);
    if (length < Math.max(5, width * .006)) return fail('脚跟与脚趾方向不清晰，暂不能可靠放置鞋履。');
    // Input shoe points right. Flip left-facing feet without turning the sole
    // upside down; the user's mirror option is applied after this orientation.
    const mirror = toe.x < heel.x;
    let angle = Math.atan2(toe.y - heel.y, toe.x - heel.x);
    if (mirror) angle += angle > 0 ? -Math.PI : Math.PI;
    anchors.push({ ...middle(heel, toe), width: length * 1.4, angle, pivotY: .72, mirror });
  }
  return ready(anchors);
}

export function normalizeProductOverlay(options = {}) {
  if (!PRODUCT_TYPES.includes(options.type)) throw new Error('暂不支持这种商品品类。');
  const image = options.image, width = image?.naturalWidth || image?.videoWidth || image?.width;
  const height = image?.naturalHeight || image?.videoHeight || image?.height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width * height > 16_000_000)
    throw new Error('商品图片未解码或尺寸过大，请重新选择图片。');
  return { image, type: options.type, scale: finite(options.scale, 1, .15, 4),
    rotation: finite(options.rotation, 0, -180, 180), offsetX: finite(options.offsetX, 0, -1, 1),
    offsetY: finite(options.offsetY, 0, -1, 1), opacity: finite(options.opacity, 1, 0, 1),
    mirror: options.mirror === true, aspect: height / width };
}

export function drawProductOverlay(ctx, overlay, geometry) {
  if (!overlay) return false;
  const status = getProductAnchors(geometry, overlay.type);
  if (!status.available || !overlay.opacity) return false;
  for (const anchor of status.anchors) {
    const width = anchor.width * overlay.scale, height = width * overlay.aspect;
    ctx.save();
    ctx.globalAlpha *= overlay.opacity;
    // Offsets use measured anchor width, independent of scale and mirror.
    ctx.translate(anchor.x + overlay.offsetX * anchor.width, anchor.y + overlay.offsetY * anchor.width);
    ctx.rotate(anchor.angle + overlay.rotation * Math.PI / 180);
    ctx.scale(anchor.mirror !== overlay.mirror ? -1 : 1, 1);
    ctx.drawImage(overlay.image, -width / 2, -height * anchor.pivotY, width, height);
    ctx.restore();
  }
  return true;
}
