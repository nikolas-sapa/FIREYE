/** Shared public limits and endpoint allowlist. Never put credentials in this module. */
export const LAB_MODELS = [
  { value: 'google/nano-banana-2.1/edit', label: 'Nano Banana 2.1 · Google', resolution: true },
  { value: 'fal-ai/nano-banana-2/edit', label: 'Nano Banana 2 · Google', resolution: true },
  { value: 'fal-ai/nano-banana-pro/edit', label: 'Nano Banana Pro · Google', resolution: true },
  { value: 'fal-ai/nano-banana/edit', label: 'Nano Banana · Google', resolution: false },
] as const;

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_PROMPT_LENGTH = 16000;
export const LAB_API = `${import.meta.env?.BASE_URL ?? '/'}api/image-lab`;

export interface LabResult {
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED';
  requestId: string;
  queuePosition?: number;
  images?: { url: string; width?: number; height?: number }[];
  description?: string;
}
