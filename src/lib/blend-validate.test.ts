import { describe, it, expect } from "vitest";
import { validateBlendComponents } from "./blend-validate";

const ok = [
  { componentPeptideId: "ghk", massMg: "50", source: "label", sortIndex: 0 },
  { componentPeptideId: "bpc", massMg: "10", source: "label", sortIndex: 1 },
];

describe("validateBlendComponents", () => {
  it("accepts a well-formed set", () => {
    const r = validateBlendComponents("klow", ok);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows.map((x) => x.massMg)).toEqual([50, 10]);
  });

  it("accepts an empty set — clearing a blend's components is legitimate", () => {
    const r = validateBlendComponents("klow", []);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows).toEqual([]);
  });

  it("rejects a blend containing itself", () => {
    const r = validateBlendComponents("klow", [{ componentPeptideId: "klow", massMg: "10", source: "label", sortIndex: 0 }]);
    expect(r).toEqual({ ok: false, error: "A blend cannot contain itself." });
  });

  it("rejects duplicate components", () => {
    const r = validateBlendComponents("klow", [ok[0], { ...ok[0], sortIndex: 1 }]);
    expect(r).toEqual({ ok: false, error: "Each component may appear only once." });
  });

  it("rejects a non-positive mass", () => {
    expect(validateBlendComponents("klow", [{ ...ok[0], massMg: "0" }]))
      .toEqual({ ok: false, error: "Every component needs a mass greater than zero." });
  });

  it("rejects a non-numeric mass", () => {
    expect(validateBlendComponents("klow", [{ ...ok[0], massMg: "abc" }]))
      .toEqual({ ok: false, error: "Every component needs a mass greater than zero." });
  });

  it("rejects an unknown source", () => {
    expect(validateBlendComponents("klow", [{ ...ok[0], source: "guess" }]))
      .toEqual({ ok: false, error: "Source must be label, coa or assumed." });
  });
});
