export interface MapInsets { top: number; right: number; bottom: number; left: number }

/** Overscan the original panel-free view without changing its scale, center, or camera pose. */
export function mapFraming(width: number, height: number, insets: MapInsets, fov: number, near: number) {
  const viewWidth = width - insets.left - insets.right, viewHeight = height - insets.top - insets.bottom;
  if (viewWidth <= 0 || viewHeight <= 0) return null;
  const focal = Math.max(viewWidth, viewHeight) / (2 * Math.tan(fov / 2));
  return {
    fov: 2 * Math.atan(Math.max(width, height) / (2 * focal)),
    xOffset: (insets.right - insets.left) * near / (2 * focal),
    yOffset: (insets.top - insets.bottom) * near / (2 * focal),
  };
}
