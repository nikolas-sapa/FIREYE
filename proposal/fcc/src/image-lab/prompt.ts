import { color, THEMES } from '@ds';

/** Fixed data colors, independent of brand and daylight appearance. Not a risk probability scale. */
export const LAB_PALETTE = [
  { id: 'H', label: 'Priority inspection', hex: color.ember, pattern: 'solid outline',
    meaning: 'Visible woody debris or fuel accumulation with clear continuity or contact with a structure.' },
  { id: 'V', label: 'Potential vegetation fuel', hex: THEMES.fcc.amber, pattern: 'dashed outline',
    meaning: 'Visible grass, brush, shrubs, canopy, litter, or branches. Moisture and flammability unknown.' },
  { id: 'O', label: 'Object / anomaly', hex: color.violet, pattern: 'numbered outline',
    meaning: 'Potential combustible object or contextual mismatch. Material and contents may be unknown.' },
  { id: 'N', label: 'Visible non-fuel surface', hex: color.ice, pattern: 'thin outline',
    meaning: 'Clearly visible open water, rock, or paved surface. Not a guaranteed firebreak.' },
  { id: 'U', label: 'Unknown / obscured', hex: color.ink[300], pattern: 'diagonal hatch',
    meaning: 'Shadow, smoke, occlusion, or insufficient detail. Never interpret as low risk.' },
] as const;

export const PROMPT_VERSION = 'fcc-visible-fuels-v1';
export const GRID_PROMPT_VERSION = 'fcc-satellite-grid-v1';
export const DEFAULT_GRID_PROMPT = `Create a conservative visible-fuel review overlay on this single north-up Sentinel-2 satellite crop from a historical 2020 mosaic of Greece. This is one cell of a 2 by 2 experiment, not current incident imagery and not a validated fuel map or fire forecast.

Preserve the exact framing, viewpoint, orientation, aspect ratio and positions of all visible features. Return one square image of the supplied crop only. Keep source texture beneath restrained translucent fills (approximately 35% opacity), with thin boundaries tightly following visible areas. Use dashed boundaries for V and subtle diagonal hatching for U. No cropping, rotation, margins, collage, legend, caption, text labels, gradients, flames, invented smoke, wind arrows, or predicted paths. The application adds the grid, labels and legend outside your output.

Apply the SAME fixed categorical rules and target sRGB colors to every crop, never a per-tile relative heatmap:
${LAB_PALETTE.map(p => `${p.id} / ${p.hex} / ${p.label}: ${p.meaning}`).join('\n')}

At approximately 10 m native resolution, individual bushes, small woodpiles, understory and most material identities are unresolved. Do not manufacture higher-resolution details. Use V for recognizable vegetation cover without claiming a species or moisture level. Use H only if a large accumulation and its fuel continuity/contact are genuinely resolvable, not merely because a patch is brown or dense. Use O sparingly for clearly visible large contextual anomalies, never to guess tank contents. Water, clearly exposed rock or broad paved surfaces can be N, but are not guaranteed firebreaks. Use U with subtle diagonal hatching for cloud, deep shadow or insufficient evidence. Green is not safe; brown is not proof of dryness. Uncolored means unassessed.

Do not infer hidden conditions or vegetation beyond the crop boundary. Continue visible features cleanly to the image edge without fading, padding, framing, or smoothing away disagreements with adjacent cells. Do not add a repeated corner watermark. Preserve geographic layout rather than making the result look seamless.

If accompanying text is supported, give a short evidence-based report: approximate location within this crop, class, visible evidence, uncertainty, unresolved details, and any boundary features that a human should compare across neighboring cells. Identification confidence is not a calibrated probability. Say no clear candidates if appropriate.`;
export const DEFAULT_LAB_PROMPT = `Edit the supplied aerial/drone photograph into a conservative, evidence-based VISIBLE-FUEL REVIEW OVERLAY for a human wildfire analyst. This is an exploratory image-editing experiment, NOT a validated fuel map, probability map, or fire-spread prediction.

PRESERVE THE SOURCE
Keep the exact viewpoint, orientation, framing, aspect ratio, and positions of all objects. Preserve the source photograph beneath the overlay. Do not crop, rotate, warp, beautify, relight, remove objects, add vegetation, invent hidden ground detail, or draw a new scene. Do not add flames, smoke, wind arrows, predicted fire paths, distances, scale bars, or geographic coordinates. Aim for the source pixel dimensions where supported; never claim exact registration.

INSPECT ONLY WHAT IS VISIBLE
Look for grass, shrubs/brush, tree canopy, low branches, dead-looking branches, fallen timber, leaf litter, woodpiles, pallets, rubbish, and vegetation adjoining structures. Identify apparent ground-to-canopy or vegetation-to-structure continuity only when directly visible. A top-down canopy view cannot establish understory or ladder fuels.
Flag objects that seem out of place only with a visible contextual reason, such as dumped material or a blocked access track. An unusual object is not automatically combustible or hazardous. Do not infer container contents, plant species, fuel moisture, chemical composition, or ignition probability. Brown is not proof of dryness; green is not proof of safety. Shadow is not burned ground.

FIXED CATEGORICAL PALETTE
Use these exact sRGB colors as targets, not a continuous heatmap:
${LAB_PALETTE.map(p => `${p.id} — ${p.hex} — ${p.label}: ${p.meaning} Use ${p.pattern}.`).join('\n')}
H requires visible accumulated woody/dead-looking material AND clear fuel continuity or structure contact; do not mark all trees H. Mark other recognizable vegetation V without declaring it dry. Use O for uncertain material piles; do not promote them to H based on color alone. For overlapping classes, prioritize U when evidence is obscured, otherwise H, O, V, N.

RENDER ONE REVIEW IMAGE
Apply restrained semi-transparent fills, approximately 30–40% opacity, bounded tightly to visible candidate areas; preserve texture. Add thin class-colored outlines and short class-plus-number labels (H1, V1, O1, N1, U1). Use diagonal hatching for U and dashed boundaries for V so categories do not rely on color alone. Do not color every pixel. Leave unassessed regions unchanged; unchanged NEVER means safe. No glow, gradients, dramatic effects, or opaque whole-scene tint. If nothing is clearly identifiable, keep the photograph unchanged.
Put a small "AI HYPOTHESIS / HUMAN REVIEW" caption in a corner without covering evidence. Do not place a large legend or explanatory panel over the photograph; the application provides the legend.

ACCOMPANYING INFORMATION
If the endpoint supports accompanying text, provide a compact numbered list matching the image labels. For each: class, approximate image location, visible evidence, why inspection may be useful, identification confidence (low/medium/high, not calibrated probability), and unknowns. Separate observations from interpretations. Say "no clear candidates" when appropriate. Do not invent a text report if the endpoint returns image only.`;
