/**
 * Shared front-view silhouette geometry (180×320 viewBox) for the injection-site
 * BodyMap. Pure constants — no React, no I/O. (The DEXA body figure draws a
 * rendered anatomy from public/body/figure instead; see BodyFigure.tsx.)
 *
 * Mirror convention: the subject's LEFT is drawn on the VIEWER'S LEFT.
 */
export const SILHOUETTE_VIEWBOX = "0 0 180 320";
export const HEAD_ELLIPSE = { cx: 90, cy: 26, rx: 15, ry: 18 } as const;

// Anatomical fit-male silhouette — composed shapes, shared outline for
// front/back with view-specific muscle contour lines.
export const BODY_OUTLINE = [
  "M82,42 L98,42 L100,55 L80,55 Z", // neck
  // torso (traps → delts → lats → waist)
  "M80,53 C66,54 58,60 52,70 C40,74 33,82 34,92 C36,104 42,118 48,128 C53,138 57,148 58,156 L122,156 C123,148 127,138 132,128 C138,118 144,104 146,92 C147,82 140,74 128,70 C122,60 114,54 100,53 C93,52 87,52 80,53 Z",
  "M44,76 C36,96 34,128 40,158 C42,166 48,168 53,164 C56,150 54,118 54,92 C53,82 49,76 44,76 Z", // left arm
  "M136,76 C144,96 146,128 140,158 C138,166 132,168 127,164 C124,150 126,118 126,92 C127,82 131,76 136,76 Z", // right arm
  "M58,154 L122,154 C128,165 126,184 120,194 L60,194 C54,184 52,165 58,154 Z", // pelvis
  "M60,192 L89,192 C91,238 86,282 80,309 C77,316 66,316 63,309 C55,282 53,236 60,192 Z", // left leg
  "M91,192 L120,192 C127,236 125,282 117,309 C114,316 103,316 100,309 C94,282 89,238 91,192 Z", // right leg
];

export const FRONT_LINES = [
  "M90,58 L90,152", // center
  "M72,72 Q90,82 108,72", // pec line
  "M76,106 L104,106", "M76,122 L104,122", "M76,138 L104,138", // ab rows
  "M76,212 Q78,255 80,295", "M104,212 Q102,255 100,295", // quad lines
];

export const BACK_LINES = [
  "M90,58 L90,152", // spine
  "M74,76 Q90,68 106,76", // traps
  "M62,108 Q72,130 80,150", "M118,108 Q108,130 100,150", // lats
  "M64,180 Q90,196 116,180", // glute crease
  "M74,214 Q78,255 80,295", "M106,214 Q102,255 100,295", // hamstrings
];
