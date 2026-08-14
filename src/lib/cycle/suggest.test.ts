import { describe, it, expect } from "vitest";
import {
  parseCycleGuidance,
  suggestCycle,
  rampTerminalWeek,
  CURATED_CYCLE_GUIDANCE,
} from "./suggest";
import type { EnrichmentEntry } from "../peptide-enrichment";
import { allEnrichmentSeed } from "../peptide-enrichment";

/** Minimal EnrichmentEntry with only the fields the suggester reads. */
function entry(over: Partial<EnrichmentEntry>): EnrichmentEntry {
  return {
    name: "Test",
    benefits: [],
    sideEffects: [],
    dosingReference: null,
    reconstitution: [],
    reconstitutionRatio: null,
    mechanism: null,
    templates: [],
    references: [],
    source: "peptidedosages.com",
    sourceUrl: "https://peptidedosages.com/x",
    attribution: "peptidedosages.com",
    curatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("parseCycleGuidance — explicit published cycling", () => {
  it("reads an 'N–M week blocks' range and prefills the CONSERVATIVE low end", () => {
    const g = parseCycleGuidance("Doses are typically cycled in 4–8 week blocks.");
    expect(g).not.toBeNull();
    expect(g!.onWeeks).toBe(4);
    expect(g!.onWeeksMax).toBe(8);
    expect(g!.confidence).toBe("explicit");
    expect(g!.continuous).toBe(false);
  });

  it("accepts a plain hyphen and the word 'cycles' as well as 'blocks'", () => {
    expect(parseCycleGuidance("cycled in 6-12 week cycles")!.onWeeks).toBe(6);
  });

  it("reads an explicit 'N weeks on, M weeks off' pair", () => {
    const g = parseCycleGuidance("Run 8 weeks on, 4 weeks off.");
    expect(g!.onWeeks).toBe(8);
    expect(g!.offWeeks).toBe(4);
    expect(g!.confidence).toBe("explicit");
  });

  it("reads a single-value 'cycled for N weeks'", () => {
    const g = parseCycleGuidance("Typically cycled for 12 weeks before a break.");
    expect(g!.onWeeks).toBe(12);
    expect(g!.onWeeksMax).toBeNull();
  });

  it("flags continuous-use language and suggests NO stop", () => {
    const g = parseCycleGuidance("Well-tolerated with maintained benefits during continuous use up to 52 weeks.");
    expect(g!.continuous).toBe(true);
    expect(g!.onWeeks).toBeNull();
    expect(g!.onWeeksMax).toBe(52);
  });

  it("reads a day-denominated continuous course as weeks", () => {
    const g = parseCycleGuidance("a 14-day continuous course was well-tolerated");
    expect(g!.continuous).toBe(true);
    expect(g!.onWeeksMax).toBe(2);
  });

  it("does NOT fire on biochemical uses of the word 'cycle'", () => {
    // MOTS-c's mechanism text — "folate cycle" must never read as a dosing cycle.
    expect(
      parseCycleGuidance(
        "Its primary mechanism is AMPK activation through inhibition of the folate cycle, causing accumulation of AICAR.",
      ),
    ).toBeNull();
    expect(parseCycleGuidance("Restores testosterone in post-cycle scenarios.")).toBeNull();
    expect(parseCycleGuidance("supports the cell cycle and 8 week recovery")).toBeNull();
  });

  it("returns null for empty / absent text", () => {
    expect(parseCycleGuidance(null)).toBeNull();
    expect(parseCycleGuidance("")).toBeNull();
    expect(parseCycleGuidance("No dosing cadence published.")).toBeNull();
  });

  it("rejects implausible week counts rather than emitting nonsense", () => {
    expect(parseCycleGuidance("cycled in 0-8 week blocks")).toBeNull();
    expect(parseCycleGuidance("cycled for 500 weeks")).toBeNull();
  });

  it("ignores a reversed range instead of suggesting a negative window", () => {
    expect(parseCycleGuidance("cycled in 8–4 week blocks")).toBeNull();
  });
});

describe("rampTerminalWeek — implied course length from the titration ramp", () => {
  it("reads a CLOSED terminal phase as the implied course end", () => {
    expect(rampTerminalWeek(["Weeks 1–2", "Weeks 3–4", "Weeks 5–6", "Weeks 7–8"])).toEqual({
      week: 8,
      open: false,
    });
  });

  it("marks a trailing '+' phase as OPEN-ENDED", () => {
    expect(rampTerminalWeek(["Weeks 1–2", "Weeks 3–4", "Weeks 5–8+"])).toEqual({ week: 8, open: true });
    expect(rampTerminalWeek(["Weeks 1–4", "Weeks 13+"])).toEqual({ week: 13, open: true });
  });

  it("handles a single-week phase label", () => {
    expect(rampTerminalWeek(["Week 1", "Weeks 2–8"])).toEqual({ week: 8, open: false });
  });

  it("tolerates decorated labels", () => {
    expect(rampTerminalWeek(["Weeks 1–2 (Initial)", "Weeks 5–8 (Maintenance)"])).toEqual({
      week: 8,
      open: false,
    });
  });

  it("returns null when no phase parses", () => {
    expect(rampTerminalWeek([])).toBeNull();
    expect(rampTerminalWeek(["Loading", "Maintenance"])).toBeNull();
  });

  it("takes the LARGEST terminal week, not merely the last array element", () => {
    expect(rampTerminalWeek(["Weeks 9–12", "Weeks 1–2"])).toEqual({ week: 12, open: false });
  });
});

describe("suggestCycle — entry → prefillable suggestion", () => {
  it("prefers EXPLICIT published cycling over the ramp", () => {
    const e = entry({
      benefits: ["Doses are typically cycled in 4–8 week blocks."],
      templates: [
        {
          name: "T",
          doseBasis: "per_injection",
          targetDose: 1,
          unit: "mcg",
          frequency: "daily",
          ramp: [{ phase: "Weeks 1–12", dose: 1, unit: "mcg", doseLabel: "1 mcg" }],
        },
      ],
    });
    const s = suggestCycle(e);
    expect(s.onWeeks).toBe(4);
    expect(s.confidence).toBe("explicit");
    expect(s.quote).toContain("4–8 week blocks");
  });

  it("DERIVES a course length from a closed ramp when nothing explicit exists", () => {
    const e = entry({
      templates: [
        {
          name: "T",
          doseBasis: "per_injection",
          targetDose: 1,
          unit: "mcg",
          frequency: "daily",
          ramp: [
            { phase: "Weeks 1–2", dose: 1, unit: "mcg", doseLabel: "1 mcg" },
            { phase: "Weeks 7–8", dose: 2, unit: "mcg", doseLabel: "2 mcg" },
          ],
        },
      ],
    });
    const s = suggestCycle(e);
    expect(s.onWeeks).toBe(8);
    expect(s.confidence).toBe("derived");
    expect(s.basis).toMatch(/ramp/i);
  });

  it("suggests NO stop when the ramp is open-ended", () => {
    const e = entry({
      templates: [
        {
          name: "T",
          doseBasis: "per_injection",
          targetDose: 1,
          unit: "mcg",
          frequency: "daily",
          ramp: [{ phase: "Weeks 9–10+", dose: 1, unit: "mcg", doseLabel: "1 mcg" }],
        },
      ],
    });
    const s = suggestCycle(e);
    expect(s.onWeeks).toBeNull();
    expect(s.confidence).toBe("none");
    expect(s.basis).toMatch(/open-ended/i);
  });

  it("returns a none-confidence suggestion for an entry with nothing to go on", () => {
    const s = suggestCycle(entry({}));
    expect(s.onWeeks).toBeNull();
    expect(s.offWeeks).toBeNull();
    expect(s.confidence).toBe("none");
    expect(s.basis).toBeTruthy();
  });

  it("is safe on a missing entry", () => {
    const s = suggestCycle(undefined);
    expect(s.confidence).toBe("none");
    expect(s.onWeeks).toBeNull();
  });

  it("carries source attribution through for the UI chip", () => {
    const e = entry({ benefits: ["cycled in 4–8 week blocks"], sourceUrl: "https://peptidedosages.com/ghk-cu" });
    expect(suggestCycle(e).sourceUrl).toBe("https://peptidedosages.com/ghk-cu");
  });

  it("lets an operator-curated entry override the parsed literature", () => {
    const e = entry({ name: "Curated Test", benefits: ["cycled in 4–8 week blocks"] });
    const curated = { onWeeks: 6, offWeeks: 3, basis: "Operator note", quote: null };
    const s = suggestCycle(e, { curated });
    expect(s.onWeeks).toBe(6);
    expect(s.offWeeks).toBe(3);
    expect(s.confidence).toBe("curated");
    expect(s.basis).toBe("Operator note");
  });
});

describe("suggestCycle — against the real shipped enrichment seed", () => {
  const seed = allEnrichmentSeed();
  const byName = (n: string) => seed.find((e) => e.name === n);

  it("never throws on any shipped entry", () => {
    for (const e of seed) expect(() => suggestCycle(e)).not.toThrow();
  });

  it("only ever emits plausible week counts", () => {
    for (const e of seed) {
      const s = suggestCycle(e);
      if (s.onWeeks !== null) {
        expect(s.onWeeks).toBeGreaterThan(0);
        expect(s.onWeeks).toBeLessThanOrEqual(104);
      }
      if (s.offWeeks !== null) expect(s.offWeeks).toBeGreaterThan(0);
    }
  });

  it("reads GHK-Cu's published 4–8 week blocks", () => {
    const e = byName("GHK-Cu");
    expect(e).toBeDefined();
    const s = suggestCycle(e);
    expect(s.onWeeks).toBe(4);
    expect(s.onWeeksMax).toBe(8);
    expect(s.confidence).toBe("explicit");
  });

  it("does NOT mistake MOTS-c's folate cycle for a dosing cycle", () => {
    const s = suggestCycle(byName("MOTS-c"));
    // MOTS-c's ramp ends "Weeks 9–10+" — open-ended, so no stop is suggested,
    // and certainly not one derived from the mechanism sentence.
    expect(s.confidence).not.toBe("explicit");
    expect(s.onWeeks).toBeNull();
  });

  it("treats Tesamorelin as continuous rather than suggesting a stop", () => {
    const s = suggestCycle(byName("Tesamorelin"));
    expect(s.continuous).toBe(true);
    expect(s.onWeeks).toBeNull();
  });

  it("derives Sermorelin's 8-week course from its closed ramp", () => {
    const s = suggestCycle(byName("Sermorelin"));
    expect(s.onWeeks).toBe(8);
    expect(s.confidence).toBe("derived");
  });

  it("ships the curated override table empty (operator-populated, not invented)", () => {
    expect(Object.keys(CURATED_CYCLE_GUIDANCE)).toHaveLength(0);
  });
});
