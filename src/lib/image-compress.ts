/**
 * Browser-side screenshot compression: downscale to ≤1920px on the long side and re-encode as WebP
 * (JPEG if the browser can't encode WebP), stepping quality down until the file is under the limit.
 * Keeps uploads well below Vercel's 4.5 MB request limit and saves storage.
 */
export const MAX_DIMENSION = 1920;
export const TARGET_BYTES = 3.5 * 1024 * 1024;

export type Compressed = { blob: Blob; width: number; height: number };

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Not a readable image"));
    };
    img.src = url;
  });
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

export async function compressImage(file: Blob): Promise<Compressed> {
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(img, 0, 0, width, height);

  for (const type of ["image/webp", "image/jpeg"]) {
    for (const q of [0.82, 0.7, 0.55, 0.4]) {
      const blob = await toBlob(canvas, type, q);
      if (!blob || blob.type !== type) break; // encoder not supported: try the next type
      if (blob.size <= TARGET_BYTES) return { blob, width, height };
    }
  }
  throw new Error("Image is too large even after compression");
}
