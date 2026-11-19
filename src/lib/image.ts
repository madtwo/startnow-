const MAX_FILE_BYTES = 15_000_000;
const MAX_DATA_URL = 900_000;

export async function fileToImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('这不是图片');
  if (file.size > MAX_FILE_BYTES) throw new Error('图片太大了，换一张 15MB 以内的');
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 50_000_000) throw new Error('图片像素太多了，换一张小一点的');
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
    let url = canvas.toDataURL('image/jpeg', 0.72);
    if (url.length > MAX_DATA_URL) url = canvas.toDataURL('image/jpeg', 0.5);
    if (url.length > MAX_DATA_URL) throw new Error('图片压缩后还是太大，换一张试试');
    return url;
  } finally {
    bitmap.close?.();
  }
}
