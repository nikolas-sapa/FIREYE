import { LAB_API, MAX_IMAGE_BYTES, type LabResult } from './protocol';

export interface PreparedImage {
  dataUrl: string;
  name: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
}

/** Re-encode locally to remove EXIF/GPS; no upload happens until explicit submission. */
export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPEG, PNG, or WebP image.');
  if (!file.size || file.size > MAX_IMAGE_BYTES) throw new Error('Choose an image up to 8 MiB.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 40000000) throw new Error('Choose an image with at most 40 megapixels.');
    const ratio = Math.min(1, 2560 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot prepare the image.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL(file.type, 0.92);
    if (dataUrl.length * 3 / 4 > MAX_IMAGE_BYTES) throw new Error('The prepared image is too large. Try a smaller image.');
    return { dataUrl, name: file.name, width: canvas.width, height: canvas.height,
      originalWidth: image.naturalWidth, originalHeight: image.naturalHeight };
  } finally { URL.revokeObjectURL(url); }
}

export async function labRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${LAB_API}${path}`, { ...init, cache: 'no-store' });
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('Local image-lab API unavailable. Run npm run dev or npm run preview on localhost; static hosting needs a secure backend.');
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (HTTP ${response.status}).`);
  return data as T;
}

export async function pollLab(jobId: string, signal: AbortSignal, onStatus: (result: LabResult) => void): Promise<LabResult> {
  const deadline = Date.now() + 10 * 60 * 1000;
  while (!signal.aborted) {
    const result = await labRequest<LabResult>(`/${encodeURIComponent(jobId)}`, { signal });
    onStatus(result);
    if (result.status === 'COMPLETED') return result;
    if (Date.now() > deadline) throw new Error('Still waiting after 10 minutes. Check this request again below; do not pay for a duplicate submission.');
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
      const timer = window.setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 2500);
      signal.addEventListener('abort', abort, { once: true });
    });
  }
  throw new DOMException('Aborted', 'AbortError');
}
