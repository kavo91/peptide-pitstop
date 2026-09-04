import { describe, it, expect } from "vitest";
import { hasActiveProtocolConflict, peptidesWithActiveProtocol } from "./protocol-uniqueness";

describe("hasActiveProtocolConflict", () => {
  it("blocks a second ACTIVE protocol for the same peptide", () => {
    expect(hasActiveProtocolConflict([{ id: "a", status: "active" }], { status: "active" })).toBe(true);
  });

  it("allows the first protocol for a peptide", () => {
    expect(hasActiveProtocolConflict([], { status: "active" })).toBe(false);
  });

  it("does NOT count the protocol being edited as its own conflict", () => {
    expect(hasActiveProtocolConflict([{ id: "a", status: "active" }], { id: "a", status: "active" })).toBe(false);
  });

  // THE REGRESSION. The app's own advice is "close the protocol, start a new
  // one" (changing a titration scheduleRule re-times every step and orphans
  // logged doses). That leaves a COMPLETED row behind forever — which the old
  // status-blind count treated as a conflict, so the peptide's live protocol
  // could never be edited again. Seen with a peptide that has exactly this
  // shape: one completed course plus one active one.
  it("ignores COMPLETED history when editing the live protocol", () => {
    const existing = [
      { id: "old", status: "completed" },
      { id: "live", status: "active" },
    ];
    expect(hasActiveProtocolConflict(existing, { id: "live", status: "active" })).toBe(false);
  });

  it("ignores completed history when creating a replacement protocol", () => {
    expect(hasActiveProtocolConflict([{ id: "old", status: "completed" }], { status: "active" })).toBe(false);
  });

  it("ignores paused protocols — a paused course is not being dosed", () => {
    expect(hasActiveProtocolConflict([{ id: "p", status: "paused" }], { status: "active" })).toBe(false);
  });

  it("allows saving a NON-active protocol even when an active one exists", () => {
    const existing = [{ id: "live", status: "active" }];
    expect(hasActiveProtocolConflict(existing, { id: "old", status: "completed" })).toBe(false);
    expect(hasActiveProtocolConflict(existing, { id: "old", status: "paused" })).toBe(false);
  });

  it("blocks REACTIVATING an old protocol while another is active", () => {
    // The invariant that actually matters: two active protocols for one peptide
    // would both generate doses, and /today would show the peptide twice.
    const existing = [{ id: "live", status: "active" }];
    expect(hasActiveProtocolConflict(existing, { id: "old", status: "active" })).toBe(true);
  });

  it("blocks when several actives somehow exist already", () => {
    const existing = [{ id: "a", status: "active" }, { id: "b", status: "active" }];
    expect(hasActiveProtocolConflict(existing, { status: "active" })).toBe(true);
  });
});

describe("peptidesWithActiveProtocol", () => {
  it("returns only peptides whose protocol is active", () => {
    const rows = [
      { peptideId: "p1", status: "active" },
      { peptideId: "p2", status: "completed" },
      { peptideId: "p3", status: "paused" },
    ];
    const set = peptidesWithActiveProtocol(rows);
    expect([...set]).toEqual(["p1"]);
  });

  it("frees a peptide whose only protocol is finished, so it can be re-run", () => {
    const set = peptidesWithActiveProtocol([{ peptideId: "mots", status: "completed" }]);
    expect(set.has("mots")).toBe(false);
  });

  it("keeps a peptide taken when it has both a finished and a live protocol", () => {
    const set = peptidesWithActiveProtocol([
      { peptideId: "mots", status: "completed" },
      { peptideId: "mots", status: "active" },
    ]);
    expect(set.has("mots")).toBe(true);
  });

  it("handles an empty list", () => {
    expect(peptidesWithActiveProtocol([]).size).toBe(0);
  });
});
