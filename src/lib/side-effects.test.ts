import { describe, it, expect } from "vitest";
import {
  serializeSideEffects,
  deserializeSideEffects,
  formatSideEffects,
  formatSideEffectEntry,
  serializeSymptomList,
  resolveSymptomList,
  DEFAULT_SYMPTOMS,
  type SideEffectEntry,
} from "./side-effects";

describe("deserializeSideEffects — back-compat read path", () => {
  it("(a) parses the new object array shape", () => {
    const raw = JSON.stringify([
      { symptom: "Nausea", severity: "moderate" },
      { symptom: "Headache", severity: null },
    ]);
    expect(deserializeSideEffects(raw)).toEqual([
      { symptom: "Nausea", severity: "moderate" },
      { symptom: "Headache", severity: null },
    ]);
  });

  it("(b) maps a legacy JSON string[] to entries with null severity", () => {
    const raw = JSON.stringify(["Headache", "Nausea"]);
    expect(deserializeSideEffects(raw)).toEqual([
      { symptom: "Headache", severity: null },
      { symptom: "Nausea", severity: null },
    ]);
  });

  it("(c) maps a legacy bare plaintext string to a single entry", () => {
    expect(deserializeSideEffects("mild nausea after dinner")).toEqual([
      { symptom: "mild nausea after dinner", severity: null },
    ]);
  });

  it("treats a JSON-encoded scalar string as a single entry", () => {
    // JSON.parse('"Headache"') === "Headache"
    expect(deserializeSideEffects(JSON.stringify("Headache"))).toEqual([
      { symptom: "Headache", severity: null },
    ]);
  });

  it("returns [] for null, undefined, empty and whitespace", () => {
    expect(deserializeSideEffects(null)).toEqual([]);
    expect(deserializeSideEffects(undefined)).toEqual([]);
    expect(deserializeSideEffects("")).toEqual([]);
    expect(deserializeSideEffects("   ")).toEqual([]);
  });

  it("never throws on malformed input → []", () => {
    expect(deserializeSideEffects("{not json")).toEqual([{ symptom: "{not json", severity: null }]);
    // A JSON object (not array/string) is an unrecognised shape → [].
    expect(deserializeSideEffects('{"foo":"bar"}')).toEqual([]);
    // An array of junk drops unusable items.
    expect(deserializeSideEffects('[1, true, null, {"severity":"mild"}, {"symptom":""}]')).toEqual([]);
    // An out-of-range severity is coerced to null, symptom kept.
    expect(deserializeSideEffects('[{"symptom":"Nausea","severity":"extreme"}]')).toEqual([
      { symptom: "Nausea", severity: null },
    ]);
  });
});

describe("serializeSideEffects + round-trip", () => {
  it("serializes the object shape and round-trips through deserialize", () => {
    const entries: SideEffectEntry[] = [
      { symptom: "Nausea", severity: "severe" },
      { symptom: "Fatigue", severity: null },
    ];
    const json = serializeSideEffects(entries);
    expect(json).toBe(JSON.stringify(entries));
    expect(deserializeSideEffects(json)).toEqual(entries);
  });

  it("returns null for empty / all-blank input and trims symptoms", () => {
    expect(serializeSideEffects(null)).toBeNull();
    expect(serializeSideEffects([])).toBeNull();
    expect(serializeSideEffects([{ symptom: "   ", severity: "mild" }])).toBeNull();
    expect(serializeSideEffects([{ symptom: "  Nausea  ", severity: null }])).toBe(
      JSON.stringify([{ symptom: "Nausea", severity: null }]),
    );
  });
});

describe("formatSideEffects / formatSideEffectEntry", () => {
  it("renders severity in parentheses when present, bare otherwise", () => {
    expect(formatSideEffectEntry({ symptom: "Nausea", severity: "moderate" })).toBe("Nausea (moderate)");
    expect(formatSideEffectEntry({ symptom: "Headache", severity: null })).toBe("Headache");
  });

  it("comma-joins entries over all stored shapes", () => {
    const raw = JSON.stringify([
      { symptom: "Nausea", severity: "moderate" },
      { symptom: "Headache", severity: null },
    ]);
    expect(formatSideEffects(raw)).toBe("Nausea (moderate), Headache");
    expect(formatSideEffects(JSON.stringify(["Headache", "Nausea"]))).toBe("Headache, Nausea");
    expect(formatSideEffects("legacy plaintext note")).toBe("legacy plaintext note");
    expect(formatSideEffects(null)).toBe("");
    expect(formatSideEffects("")).toBe("");
  });
});

describe("symptom list override", () => {
  it("resolves the curated default when no override is set", () => {
    expect(resolveSymptomList(null)).toBe(DEFAULT_SYMPTOMS);
    expect(resolveSymptomList("")).toBe(DEFAULT_SYMPTOMS);
    expect(resolveSymptomList("not json")).toBe(DEFAULT_SYMPTOMS);
    expect(resolveSymptomList("[]")).toBe(DEFAULT_SYMPTOMS);
  });

  it("resolves a stored override list", () => {
    expect(resolveSymptomList(JSON.stringify(["Cramps", "Bloating"]))).toEqual(["Cramps", "Bloating"]);
  });

  it("serializes free text, de-dupes case-insensitively, and clears on blank", () => {
    expect(serializeSymptomList("Nausea, headache\nFatigue")).toBe(
      JSON.stringify(["Nausea", "headache", "Fatigue"]),
    );
    expect(serializeSymptomList("Nausea, nausea, NAUSEA")).toBe(JSON.stringify(["Nausea"]));
    expect(serializeSymptomList("")).toBeNull();
    expect(serializeSymptomList("   \n  ")).toBeNull();
    expect(serializeSymptomList(null)).toBeNull();
  });
});
