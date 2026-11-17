export async function fileToImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('这不是图片');
  const bitmap = await createImageBitmap(file);
  const max = 900;
  const ratio = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * ratio));
  const h = Math.max(1, Math.round(bitmap.height * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('画布不可用');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  let url = canvas.toDataURL('image/jpeg', 0.72);
  if (url.length > 900_000) url = canvas.toDataURL('image/jpeg', 0.5);
  return url;
}
