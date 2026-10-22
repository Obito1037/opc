export const catalog = [
  { id: 'sage-shirt', category: 'clothing', name: '鼠尾草 · 短袖上衣', subtitle: '轻松轮廓 / 日常', label: 'ESSENTIAL', garment: 'shirt', color: '#899a7b', icon: 'shirt' },
  { id: 'ivory-shirt', category: 'clothing', name: '云朵白 · 基础短袖', subtitle: '纯净色调 / 百搭', label: 'BASIC', garment: 'shirt', color: '#e8e1d2', icon: 'shirt' },
  { id: 'sand-jacket', category: 'clothing', name: '沙丘 · 休闲外套', subtitle: '松弛层次 / 通勤', label: 'CITY', garment: 'jacket', color: '#b69372', icon: 'jacket' },
  { id: 'ink-jacket', category: 'clothing', name: '墨色 · 都市外套', subtitle: '利落线条 / 质感', label: 'STUDIO', garment: 'jacket', color: '#374641', icon: 'jacket' },
  { id: 'rose-dress', category: 'clothing', name: '暮玫瑰 · 连衣裙', subtitle: '柔和曲线 / 约会', label: 'MUSE', garment: 'dress', color: '#b77b76', icon: 'dress' },
  { id: 'sky-dress', category: 'clothing', name: '雾蓝 · 连衣裙', subtitle: '轻盈裙摆 / 周末', label: 'WEEKEND', garment: 'dress', color: '#78939f', icon: 'dress' },
  { id: 'cloud-sneakers', category: 'shoes', name: '云行 · 运动鞋', subtitle: '轻盈步伐 / 日常', label: 'WALK', shoe: 'sneakers', icon: 'sneakers', color: '#e7e5db' },
  { id: 'city-boots', category: 'shoes', name: '漫步 · 短靴', subtitle: '简洁轮廓 / 城市', label: 'CITY', shoe: 'boots', icon: 'boots', color: '#55473d' },
  { id: 'frame-glasses', category: 'accessories', name: '方圆 · 眼镜', subtitle: '细框细节 / 知性', label: 'DETAIL', accessory: 'glasses', icon: 'glasses', color: '#423d32' },
  { id: 'gold-earrings', category: 'accessories', name: '弧光 · 耳饰', subtitle: '金色弧线 / 点睛', label: 'GLOW', accessory: 'earrings', icon: 'earrings', color: '#bd9654' },
  { id: 'gold-necklace', category: 'accessories', name: '星点 · 项链', subtitle: '纤细项链 / 优雅', label: 'LIGHT', accessory: 'necklace', icon: 'necklace', color: '#bd9654' },
  { id: 'no-accessory', category: 'accessories', name: '自在 · 无配饰', subtitle: '回归自然 / 简约', label: 'PURE', accessory: 'none', icon: 'none', color: '#c7c2b8' },
  { id: 'rose-lip', category: 'makeup', name: '豆沙玫瑰', subtitle: '唇颊同色 / 温柔', label: 'ROSE 01', makeup: '#a34f59', icon: 'lipstick', color: '#a34f59' },
  { id: 'coral-lip', category: 'makeup', name: '落日珊瑚', subtitle: '唇颊同色 / 元气', label: 'CORAL 02', makeup: '#c46e58', icon: 'lipstick', color: '#c46e58' },
  { id: 'berry-lip', category: 'makeup', name: '微醺莓果', subtitle: '唇颊同色 / 氛围', label: 'BERRY 03', makeup: '#7c344d', icon: 'lipstick', color: '#7c344d' },
  { id: 'bare-lip', category: 'makeup', name: '原生裸色', subtitle: '唇颊同色 / 自然', label: 'NUDE 04', makeup: '#b48472', icon: 'lipstick', color: '#b48472' },
];
export const defaultLook = { garment: 'shirt', color: '#899a7b', shoe: 'sneakers', accessory: 'none', makeup: '#a34f59', makeupIntensity: 0.35, showGarment: true, photoMode: 'recolor' };
export const palette = ['#899a7b', '#e8e1d2', '#b69372', '#374641', '#b77b76', '#78939f', '#675d79', '#c5a05d'];
export const categories = {clothing:'衣服', shoes:'鞋履', accessories:'配饰', makeup:'妆容'};
export function applyProduct(look, product) {
  if (!product || !Object.hasOwn(categories, product.category)) return { ...look };
  const next = {...look};
  const fields = {clothing:['garment','color'], shoes:['shoe'], accessories:['accessory'], makeup:['makeup']}[product.category];
  fields.forEach(key => next[key] = product[key]);
  return next;
}
export function validateImageFile(file) {
  if (!file) return '请选择一张照片';
  if (!['image/jpeg','image/png','image/webp'].includes(file.type)) return '请上传 JPG、PNG 或 WebP 图片';
  if (file.size > 16 * 1024 * 1024) return '照片超过 16 MB，请压缩后再试';
  if (!file.size) return '这张图片是空文件，请重新选择';
  return '';
}
export function sanitizeLook(value) {
  const out = {...defaultLook};
  if (!value || typeof value !== 'object') return out;
  for (const [key, valid] of Object.entries({garment:['shirt','jacket','dress'],shoe:['sneakers','boots'],accessory:['none','glasses','earrings','necklace']})) {
    if (valid.includes(value[key])) out[key] = value[key];
  }
  for (const key of ['color','makeup']) if (/^#[0-9a-f]{6}$/i.test(value[key])) out[key] = value[key];
  if (Number.isFinite(value.makeupIntensity)) out.makeupIntensity = Math.max(0,Math.min(1,value.makeupIntensity));
  if (typeof value.showGarment === 'boolean') out.showGarment = value.showGarment;
  if (['recolor','overlay'].includes(value.photoMode)) out.photoMode = value.photoMode;
  return out;
}
