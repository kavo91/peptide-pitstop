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

  // A revision's startDate is user-supplied. If it is BACKDATED to on/before the
  // protocol it replaces, ordering by startDate inverts the lineage once both rows
  // are completed: the frozen predecessor would be selected as the operable tip and
  // the successor treated as superseded — the exact opposite of the truth. The
  // structural signal is reliable where the date is not: within one course only the
  // ORIGIN carries courseId === null, so any successor outranks it.
  it("a BACKDATED successor still outranks its predecessor once both are completed", () => {
    const rows = [
      P("b-old", null, "completed", "2026-08-28"),
      P("b-new", "b-old", "completed", "2026-08-01"),
    ];
    expect(courseTips(rows).map((p) => p.id)).toEqual(["b-new"]);
    expect([...supersededIds(rows)]).toEqual(["b-old"]);
  });

  it("a successor outranks the origin even with no startDate at all", () => {
    const rows = [P("b-old", null, "completed", "2026-08-01"), P("b-new", "b-old", "completed", null)];
    expect(courseTips(rows).map((p) => p.id)).toEqual(["b-new"]);
  });

  // KNOWN LIMITATION, pinned deliberately. reviseProtocol writes
  // `courseId: old.courseId ?? old.id`, so a course is FLAT: every successor
  // carries the ORIGIN's id, never its immediate predecessor's. The
  // successor-over-origin rule can therefore separate origin from successors but
  // cannot order two successors of the same origin — a 3+ chain still falls
  // through to startDate, and a backdated middle revision inverts among them.
  // reviseProtocol refuses to create that state going forward; ordering existing
  // ones would need a real predecessor pointer or a createdAt column. If this
  // test starts failing, the schema gained one and the fallback can be tightened.
  it("cannot order two successors of one origin — a 3+ chain still tips by date", () => {
    const rows = [
      P("origin", null, "completed", "2026-08-01"),
      P("rev1", "origin", "completed", "2026-08-20"),
      P("rev2", "origin", "completed", "2026-08-10"), // backdated middle revision
    ];
    // rev2 is the true latest revision, but both successors look alike here, so
    // the later startDate wins and rev1 is elected.
    expect(courseTips(rows).map((p) => p.id)).toEqual(["rev1"]);
    expect([...supersededIds(rows)].sort()).toEqual(["origin", "rev2"]);
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
