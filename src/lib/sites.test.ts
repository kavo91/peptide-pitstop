import { describe, it, expect } from "vitest";
import { SITE_OPTIONS, SITE_CODES, suggestNextSite, zoneView, recencyRank } from "./sites";

describe("SITE_OPTIONS", () => {
  it("has exactly 10 entries", () => {
    expect(SITE_OPTIONS).toHaveLength(10);
  });
  it("every entry has a code and label", () => {
    for (const opt of SITE_OPTIONS) {
      expect(typeof opt.code).toBe("string");
      expect(opt.code.length).toBeGreaterThan(0);
      expect(typeof opt.label).toBe("string");
      expect(opt.label.length).toBeGreaterThan(0);
    }
  });
  it("SITE_CODES matches SITE_OPTIONS codes in order", () => {
    expect(SITE_CODES).toEqual(SITE_OPTIONS.map((o) => o.code));
  });
});

describe("suggestNextSite", () => {
  it("returns first site when history is empty", () => {
    expect(suggestNextSite([])).toBe("abdomen_L");
  });

  it("returns the site not used most recently (LRU)", () => {
    // Used abdomen_L most recently — should suggest abdomen_R
    expect(suggestNextSite(["abdomen_L"])).toBe("abdomen_R");
  });

  it("round-robins through sites in code order when all have equal (zero) usage", () => {
    // All sites unused → picks first
    expect(suggestNextSite([])).toBe("abdomen_L");
  });

  it("with full rotation history returns site least recently used", () => {
    // Order: abdomen_L (oldest), abdomen_R, thigh_L, ... → LRU is abdomen_L
    const recent = ["thigh_L", "thigh_R", "glute_L", "glute_R", "delt_L", "delt_R", "ventro_L", "ventro_R", "abdomen_R"];
    expect(suggestNextSite(recent)).toBe("abdomen_L");
  });

  it("ignores unrecognised legacy free-text site strings", () => {
    // "left arm" is not a known code; should be treated as if no history
    expect(suggestNextSite(["left arm", "right arm"])).toBe("abdomen_L");
  });

  it("treats recent history as most-recently-used = index 0", () => {
    // recentSites[0] = most recent, recentSites[last] = oldest
    // abdomen_R used most recently, abdomen_L second — LRU among known = abdomen_L second most recent → third in list
    // With just two: abdomen_R used, abdomen_L used before it → thigh_L never used → return thigh_L
    expect(suggestNextSite(["abdomen_R", "abdomen_L"])).toBe("thigh_L");
  });
});

// ── append after existing tests in sites.test.ts ──────────────────────────

describe("zoneView", () => {
  it("maps every SITE_CODE to exactly one view", () => {
    const views = SITE_CODES.map(zoneView);
    for (const v of views) {
      expect(["front", "back"]).toContain(v);
    }
  });

  it("all 10 codes covered — no code missing, no duplicate mapping", () => {
    expect(SITE_CODES).toHaveLength(10);
    // Every code maps to something
    SITE_CODES.forEach((c) => expect(() => zoneView(c)).not.toThrow());
  });

  // Front view: abdomen_L, abdomen_R, delt_L, delt_R, thigh_L, thigh_R, ventro_L, ventro_R
  it.each([
    ["abdomen_L"],
    ["abdomen_R"],
    ["delt_L"],
    ["delt_R"],
    ["thigh_L"],
    ["thigh_R"],
    ["ventro_L"],
    ["ventro_R"],
  ])("zoneView(%s) === 'front'", (code) => {
    expect(zoneView(code)).toBe("front");
  });

  // Back view: glute_L, glute_R
  it.each([["glute_L"], ["glute_R"]])(
    "zoneView(%s) === 'back'",
    (code) => {
      expect(zoneView(code)).toBe("back");
    }
  );
});

describe("recencyRank", () => {
  it("returns empty map for empty history", () => {
    const m = recencyRank([]);
    expect(m.size).toBe(0);
  });

  it("most recent code has rank 0", () => {
    const m = recencyRank(["abdomen_L", "thigh_R"]);
    expect(m.get("abdomen_L")).toBe(0);
    expect(m.get("thigh_R")).toBe(1);
  });

  it("only first occurrence is ranked (most recent wins)", () => {
    const m = recencyRank(["abdomen_L", "abdomen_R", "abdomen_L"]);
    // abdomen_L appears at index 0 and 2 — only index 0 counts
    expect(m.get("abdomen_L")).toBe(0);
    expect(m.get("abdomen_R")).toBe(1);
  });

  it("unknown codes are included in rank (not filtered)", () => {
    // recencyRank is a raw index map — caller filters by SITE_CODES
    const m = recencyRank(["old_text", "abdomen_L"]);
    expect(m.get("old_text")).toBe(0);
    expect(m.get("abdomen_L")).toBe(1);
  });
});
