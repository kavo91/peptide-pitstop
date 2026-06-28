import { describe, it, expect } from "vitest";
import { assessReorder } from "./reorder-core";

const today = new Date("2026-06-16T09:00:00");

describe("assessReorder", () => {
  it("ample stock → ok", () => {
    const r = assessReorder({ totalDoses: 60, dosesPerWeek: 3, leadTimeDays: 14, bufferDays: 3, today });
    expect(r.status).toBe("ok");
    expect(r.coverageDays).toBe(140); // 60/3*7
    expect(r.depletionDate).toBe("2026-11-03");
    expect(r.reorderByDate).toBe("2026-10-20"); // depletion − 14
    expect(r.leadTimeDays).toBe(14);
  });
  it("within lead+buffer → reorder_now", () => {
    const r = assessReorder({ totalDoses: 6, dosesPerWeek: 3, leadTimeDays: 14, bufferDays: 3, today });
    expect(r.coverageDays).toBe(14); // 6/3*7
    expect(r.status).toBe("reorder_now"); // 14 <= 14+3
  });
  it("coverage exactly at lead+buffer boundary → reorder_now (inclusive)", () => {
    const r = assessReorder({ totalDoses: 0, dosesPerWeek: 7, leadTimeDays: 14, bufferDays: 3, today });
    // 17 doses over 7/wk = 17 days; use a case that lands exactly on 17:
    const r2 = assessReorder({ totalDoses: 17, dosesPerWeek: 7, leadTimeDays: 14, bufferDays: 3, today });
    expect(r2.coverageDays).toBe(17);
    expect(r2.status).toBe("reorder_now"); // 17 <= 17
    expect(r.status).toBe("reorder_now"); // 0 days cover
  });
  it("null totalDoses → unknown", () => {
    const r = assessReorder({ totalDoses: null, dosesPerWeek: 3, leadTimeDays: 14, bufferDays: 3, today });
    expect(r.status).toBe("unknown");
    expect(r.coverageDays).toBeNull();
    expect(r.depletionDate).toBeNull();
    expect(r.reorderByDate).toBeNull();
    expect(r.leadTimeDays).toBe(14);
  });
  it("null or zero dosesPerWeek → unknown", () => {
    expect(assessReorder({ totalDoses: 10, dosesPerWeek: null, leadTimeDays: 14, bufferDays: 3, today }).status).toBe("unknown");
    expect(assessReorder({ totalDoses: 10, dosesPerWeek: 0, leadTimeDays: 14, bufferDays: 3, today }).status).toBe("unknown");
  });
});
