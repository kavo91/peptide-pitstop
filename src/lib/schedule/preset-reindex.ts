/**
 * Pure reindexer for the N×/week preset editor state when a schedule entry is
 * removed. The preset state is keyed by schedule-entry array index, so removing
 * an entry shifts every entry above it down by one — the preset flag/N/time keys
 * must shift with them, or a preset would dangle on the wrong entry (silently
 * overwriting its real schedule) and a stale invalid-time key could dead-lock Save.
 *
 * For a removal at `removedIdx`:
 *   - the removed index is dropped from all three collections;
 *   - every key STRICTLY GREATER THAN `removedIdx` shifts down by 1 (values preserved);
 *   - keys strictly less than `removedIdx` are unchanged.
 *
 * Pure: no I/O, no Set (caller converts its Set→array→Set around this).
 */
export interface PresetState {
  idx: number[];
  n: Record<number, number>;
  time: Record<number, string>;
}

export function reindexPresetState(removedIdx: number, state: PresetState): PresetState {
  const shift = (k: number) => (k > removedIdx ? k - 1 : k);

  const idx = state.idx.filter((k) => k !== removedIdx).map(shift);

  const remapRecord = <V>(rec: Record<number, V>): Record<number, V> => {
    const out: Record<number, V> = {};
    for (const key of Object.keys(rec)) {
      const k = Number(key);
      if (k === removedIdx) continue;
      out[shift(k)] = rec[k];
    }
    return out;
  };

  return {
    idx,
    n: remapRecord(state.n),
    time: remapRecord(state.time),
  };
}
