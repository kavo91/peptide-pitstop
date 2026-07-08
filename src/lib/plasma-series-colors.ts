export interface PlasmaColorInput {
  peptideId: string;
  peptideName: string;
  stackIds?: string[];
}

export interface PlasmaColorAssignment {
  peptideId: string;
  peptideName: string;
  stackKey: string;
  color: string;
}

const FAMILY_HUES = [18, 208, 138, 288, 52, 338, 172, 102, 242, 0, 74, 316] as const;

function stableHash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function normalizeStackIds(stackIds?: string[]): string[] {
  return [...new Set((stackIds ?? []).filter(Boolean))].sort();
}

function variantForIndex(index: number, size: number): { hueOffset: number; lightness: number; saturation: number } {
  if (size <= 1) return { hueOffset: 0, lightness: 58, saturation: 82 };
  if (size === 2) {
    return index === 0
      ? { hueOffset: -14, lightness: 64, saturation: 84 }
      : { hueOffset: 14, lightness: 48, saturation: 88 };
  }
  if (size === 3) {
    return [
      { hueOffset: -18, lightness: 66, saturation: 82 },
      { hueOffset: 0, lightness: 52, saturation: 88 },
      { hueOffset: 18, lightness: 42, saturation: 86 },
    ][index] ?? { hueOffset: 0, lightness: 58, saturation: 82 };
  }
  return [
    { hueOffset: -24, lightness: 68, saturation: 82 },
    { hueOffset: -8, lightness: 56, saturation: 88 },
    { hueOffset: 10, lightness: 46, saturation: 88 },
    { hueOffset: 26, lightness: 38, saturation: 84 },
  ][index] ?? { hueOffset: (index % 2 === 0 ? -1 : 1) * (10 + index * 3), lightness: Math.max(34, 62 - index * 6), saturation: 84 };
}

function toColor(hue: number, saturation: number, lightness: number): string {
  const h = ((hue % 360) + 360) % 360;
  return `hsl(${h} ${saturation}% ${lightness}%)`;
}

export function assignPlasmaSeriesColors(input: PlasmaColorInput[]): PlasmaColorAssignment[] {
  const families = new Map<string, PlasmaColorInput[]>();
  for (const peptide of [...input].sort((a, b) => a.peptideName.localeCompare(b.peptideName) || a.peptideId.localeCompare(b.peptideId))) {
    const stackIds = normalizeStackIds(peptide.stackIds);
    const stackKey = stackIds[0] ? `stack:${stackIds[0]}` : `solo:${peptide.peptideId}`;
    const arr = families.get(stackKey) ?? [];
    arr.push({ ...peptide, stackIds });
    families.set(stackKey, arr);
  }

  const orderedFamilies = [...families.entries()].sort((a, b) => {
    const size = b[1].length - a[1].length;
    if (size !== 0) return size;
    return a[0].localeCompare(b[0]);
  });

  const familyHue = new Map<string, number>();
  orderedFamilies.forEach(([key], index) => {
    const base = FAMILY_HUES[index % FAMILY_HUES.length];
    const cycle = Math.floor(index / FAMILY_HUES.length);
    const jitter = cycle === 0 ? 0 : ((stableHash(key) % 21) - 10);
    familyHue.set(key, base + jitter);
  });

  const out: PlasmaColorAssignment[] = [];
  for (const [stackKey, peptides] of orderedFamilies) {
    const baseHue = familyHue.get(stackKey) ?? FAMILY_HUES[0];
    const sortedPeptides = [...peptides].sort((a, b) => a.peptideName.localeCompare(b.peptideName) || a.peptideId.localeCompare(b.peptideId));
    sortedPeptides.forEach((peptide, index) => {
      const variant = variantForIndex(index, sortedPeptides.length);
      out.push({
        peptideId: peptide.peptideId,
        peptideName: peptide.peptideName,
        stackKey,
        color: toColor(baseHue + variant.hueOffset, variant.saturation, variant.lightness),
      });
    });
  }

  return out.sort((a, b) => a.peptideName.localeCompare(b.peptideName) || a.peptideId.localeCompare(b.peptideId));
}
