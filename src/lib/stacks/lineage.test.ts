import { describe, expect, it } from "vitest";
import { courseTips, supersededIds, courseGroupIds } from "./lineage";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const P = (id: string, courseId: string | null, status: string, start: string | null) => ({
  id,
  courseId,
  status,
  startDate: start ? d(start) : null,
});

describe("stack course lineage", () => {
  it("a never-revised stack is all tips — including a fully completed legacy stack", () => {
    const legacy = [P("a", null, "completed", "2026-07-07"), P("b", null, "completed", "2026-07-07")];
    expect(courseTips(legacy)).toEqual(legacy);
    expect(supersededIds(legacy).size).toBe(0);
  });

  it("after a revision the active successor is the tip; the completed predecessor is superseded", () => {
    const rows = [
      P("a", null, "active", "2026-08-01"),
      P("b-old", null, "completed", "2026-08-01"),
      P("b-new", "b-old", "active", "2026-08-28"),
    ];
    expect(courseTips(rows).map((p) => p.id)).toEqual(["a", "b-new"]);
    expect([...supersededIds(rows)]).toEqual(["b-old"]);
  });

  it("an all-completed revised course tips at the latest startDate", () => {
    const rows = [P("b-old", null, "completed", "2026-08-01"), P("b-new", "b-old", "completed", "2026-08-28")];
    expect(courseTips(rows).map((p) => p.id)).toEqual(["b-new"]);
  });

  it("a paused successor still outranks its completed predecessor", () => {
    const rows = [P("b-old", null, "completed", "2026-08-01"), P("b-new", "b-old", "paused", "2026-08-28")];
    expect(courseTips(rows).map((p) => p.id)).toEqual(["b-new"]);
  });

  it("courseGroupIds spans the whole lineage for same-day dedup", () => {
    const rows = [
      P("a", null, "active", "2026-08-01"),
      P("b-old", null, "completed", "2026-08-01"),
      P("b-new", "b-old", "active", "2026-08-28"),
    ];
    expect(courseGroupIds(rows, rows[2]).sort()).toEqual(["b-new", "b-old"]);
    expect(courseGroupIds(rows, rows[0])).toEqual(["a"]);
  });
});
