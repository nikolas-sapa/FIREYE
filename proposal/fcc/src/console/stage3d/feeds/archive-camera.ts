/** A camera animation over real archive pixels, not generated observations or recorded footage. */
export function archiveCrop(width: number, height: number, aspect: number, seconds: number, seed = 0, center = { x: 0.5, y: 0.5 }) {
  const phase = seconds * Math.PI / 18 + seed * 1.7;
  const cropWidth = Math.min(width * (0.51 + Math.sin(phase * 0.7) * 0.035), height * aspect * 0.92);
  const cropHeight = cropWidth / aspect;
  const x = Math.max(0, Math.min(width - cropWidth, width * (center.x + Math.sin(phase) * 0.035) - cropWidth / 2));
  const y = Math.max(0, Math.min(height - cropHeight, height * (center.y + Math.cos(phase * 0.8) * 0.025) - cropHeight / 2));
  return { x, y, width: cropWidth, height: cropHeight };
}
