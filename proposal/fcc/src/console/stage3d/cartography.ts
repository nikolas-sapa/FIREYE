/** World-anchored texture pitch. Only water/land-cover marks use it, never a map grid. */
export function patternLod(metersPerPixel: number, cellM: number) {
  const minimum = 25 * 2 ** Math.max(0, Math.ceil(Math.log2(Math.max(1, cellM) / 25)));
  const level = Math.max(0, Math.log2(Math.max(minimum, metersPerPixel * 12) / minimum));
  const fraction = level - Math.floor(level);
  return { spacing: minimum * 2 ** Math.floor(level), blend: fraction * fraction * (3 - 2 * fraction) };
}

/** Geographic tiles have 180° of longitude at level zero and 32 sample intervals. */
export function terrainMaxLevel(cellM: number, latitude: number) {
  const width = Math.PI * 6378137 * Math.cos(latitude * Math.PI / 180);
  return Math.max(0, Math.ceil(Math.log2(width / (32 * Math.max(1, cellM)))));
}

/** Positive SSE stop sentinel, not DEM accuracy. Zero makes Cesium's imagery log2 cast select z0. */
export function terrainRefinementError(level: number, maximumLevel: number, estimated: number) {
  return level >= maximumLevel ? 0.001 : estimated;
}

export function scaleDistance(metersPerPixel: number, targetPx = 100) {
  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) return 0;
  const target = metersPerPixel * targetPx;
  const power = 10 ** Math.floor(Math.log10(target));
  const n = target / power;
  return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * power;
}

export const formatMeters = (m: number) => m >= 1000 ? `${+(m / 1000).toFixed(2)} KM` : `${Math.round(m)} M`;

export const CARTOGRAPHY_SOURCE = `
uniform vec4 surfaceColor;
uniform vec4 detailColor;
uniform vec4 indexColor;
uniform vec4 contextColor;
uniform vec4 waterColor;
uniform vec3 originEC;
uniform vec3 eastEC;
uniform vec3 northEC;
uniform vec2 halfExtent;
uniform float patternSpacing;
uniform float patternBlend;
uniform float contourSpacing;
uniform float contours;
uniform float lightBlend;
uniform float streamed;
uniform sampler2D relief;

float mapLine(float v, float interval, float width) {
    float footprint = max(fwidth(v), 0.0001);
    float distanceM = abs(fract(v / interval + 0.5) - 0.5) * interval;
    float halfWidth = czm_pixelRatio * width * 0.5;
    float line = 1.0 - smoothstep(max(0.0, halfWidth - 0.5), halfWidth + 0.5, distanceM / footprint);
    return line * (1.0 - smoothstep(0.12, 0.42, footprint / interval));
}

float mapHash(vec2 p) {
    return fract(sin(dot(mod(p, 4096.0), vec2(127.1, 311.7))) * 43758.5453);
}

float woodland(vec2 p, float interval) {
    vec2 cell = floor(p / interval);
    vec2 offset = vec2(mapHash(cell), mapHash(cell + 19.0));
    vec2 d = p - (cell + 0.15 + offset * 0.7) * interval;
    float footprint = max(length(fwidth(p)), 0.01);
    float dotMark = 1.0 - smoothstep(0.25, 0.95, length(d) / footprint);
    return dotMark * step(0.45, mapHash(cell + 71.0));
}

czm_material czm_getMaterial(czm_materialInput inputData) {
    czm_material material = czm_getDefaultMaterial(inputData);
    // Subtract in eye space before rotation: no large ECEF float subtraction or tile-local UVs.
    vec3 delta = -inputData.positionToEyeEC - originEC;
    vec2 p = vec2(dot(eastEC, delta), dot(northEC, delta));
    vec2 edge = halfExtent - abs(p);
    float coverage = smoothstep(0.0, 220.0, min(edge.x, edge.y));
    vec2 uv = clamp(p / (2.0 * halfExtent) + 0.5, 0.0, 1.0);
    vec3 field = texture(relief, uv).rgb;
    float land = 1.0 - field.g;
    float shade = field.r;
    float timber = smoothstep(0.56, 0.62, field.b) * (1.0 - smoothstep(0.76, 0.82, field.b));
    float urban = smoothstep(0.82, 0.86, field.b) * (1.0 - smoothstep(0.91, 0.95, field.b));
    float agriculture = smoothstep(0.96, 1.0, field.b);
    float waterHatch = mix(
      mapLine(dot(p, vec2(0.707107)), patternSpacing, 0.65),
      mapLine(dot(p, vec2(0.707107)), patternSpacing * 2.0, 0.65), patternBlend);
    float woods = mix(woodland(p, patternSpacing), woodland(p, patternSpacing * 2.0), patternBlend);
    float fieldHatch = mapLine(dot(p, vec2(-0.5, 0.866025)), patternSpacing * 2.0, 0.55);
    float shore = 1.0 - smoothstep(0.15, 0.85, abs(field.g - 0.5) / max(fwidth(field.g), 0.0001));
    float contour = mapLine(inputData.height, contourSpacing, 0.55);
    float indexContour = mapLine(inputData.height, contourSpacing * 5.0, 0.7);
    // Cartographic illumination, not simulated solar exposure. Night must remain readable.
    float reliefTone = mix(shade, 1.0 - shade, lightBlend);
    vec3 base = mix(surfaceColor.rgb, detailColor.rgb, reliefTone * 0.10 + urban * 0.055);
    base = mix(base, waterColor.rgb, field.g * 0.85);
    base = mix(base, detailColor.rgb, waterHatch * field.g * 0.15);
    base = mix(base, detailColor.rgb, woods * timber * land * 0.13);
    base = mix(base, detailColor.rgb, fieldHatch * agriculture * land * 0.08);
    base = mix(base, detailColor.rgb, contour * contours * land * 0.055);
    base = mix(base, indexColor.rgb, indexContour * contours * land * 0.12);
    base = mix(base, indexColor.rgb, shore * 0.30);
    material.diffuse = mix(contextColor.rgb, base, coverage);
    // Streamed geography stays continuous. The local DEM contributes only a quiet relief wash.
    material.alpha = mix(1.0, coverage * (0.08 + contour * contours * land * 0.05), streamed);
    return material;
}
`;

/** Streamed tiles already supply land/water styling. Keep this pass sampler-free so Cesium can
 * use all of the device's imagery texture slots, including multi-image terrain leaf tiles. */
export const CONTEXT_CONTOURS_SOURCE = CARTOGRAPHY_SOURCE
  .replace('uniform sampler2D relief;', '')
  .replace('texture(relief, uv).rgb', 'vec3(0.5, 0.0, 0.0)')
  .replace('material.diffuse = mix(contextColor.rgb, base, coverage);', 'material.diffuse = indexColor.rgb;')
  .replace('material.alpha = mix(1.0, coverage * (0.08 + contour * contours * land * 0.05), streamed);',
    'material.alpha = coverage * contours * step(0.002, fwidth(inputData.height)) * max(contour * 0.06, indexContour * 0.12);');
