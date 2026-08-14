import { describe, it, expect } from "vitest";
import { cycleAlerts, bannerAlerts, cycleNotifications, type CycleProtocol } from "./alerts";

const d = (iso: string) => new Date(`${iso}T00:00:00`);
const ANCHOR = d("2026-07-05");

/** 8 weeks on from 5 Jul → last dose Sat 29 Aug. */
function proto(over: Partial<CycleProtocol> = {}): CycleProtocol {
  return {
    id: "p1",
    peptideName: "MOTS-c",
    anchor: ANCHOR,
    onWeeks: 8,
    offWeeks: null,
    status: "active",
    ...over,
  };
}

const at = (today: string, p: CycleProtocol = proto()) => cycleAlerts([p], d(today));

describe("cycleAlerts — the ON phase", () => {
  it("stays silent early in the cycle", () => {
    expect(at("2026-07-20")).toEqual([]);
  });

  it("warns once inside the 7-day window", () => {
    const [a] = at("2026-08-25"); // 5 days left
    expect(a.kind).toBe("ending_soon");
    expect(a.level).toBe("warn");
    expect(a.daysRemaining).toBe(5);
    expect(a.body).toContain("29 Aug");
  });

  it("treats exactly 7 days out as the first warning", () => {
    expect(at("2026-08-23")[0].kind).toBe("ending_soon");
    expect(at("2026-08-22")).toEqual([]); // 8 days — still quiet
  });

  it("escalates on the final dosing day", () => {
    const [a] = at("2026-08-29");
    expect(a.kind).toBe("last_dose");
    expect(a.level).toBe("action");
    expect(a.daysRemaining).toBe(1);
  });

  it("carries the protocol and peptide through for linking", () => {
    const [a] = at("2026-08-29");
    expect(a.protocolId).toBe("p1");
    expect(a.peptideName).toBe("MOTS-c");
  });
});

describe("cycleAlerts — after the planned stop", () => {
  it("raises an action the day after the last dose", () => {
    const [a] = at("2026-08-30");
    expect(a.kind).toBe("stop_now");
    expect(a.level).toBe("action");
    expect(a.body).toMatch(/complete/i);
  });

  it("keeps nagging while the protocol is still marked active", () => {
    const [a] = at("2026-10-01");
    expect(a.kind).toBe("stop_now");
    // De-escalated after the first week, but never silently dropped — an active
    // protocol past its planned stop is a real discrepancy.
    expect(a.level).toBe("warn");
  });

  it("goes quiet once the protocol is marked completed", () => {
    expect(at("2026-08-30", proto({ status: "completed" }))).toEqual([]);
  });

  it("goes quiet for a paused protocol", () => {
    expect(at("2026-08-30", proto({ status: "paused" }))).toEqual([]);
  });
});

describe("cycleAlerts — planned breaks and restarts", () => {
  const cycling = proto({ offWeeks: 4 });

  it("reports the break at info level", () => {
    const [a] = at("2026-09-05", cycling);
    expect(a.kind).toBe("off_cycle");
    expect(a.level).toBe("info");
    expect(a.body).toContain("27 Sep");
  });

  it("warns as the restart approaches", () => {
    const [a] = at("2026-09-24", cycling); // 3 days of break left
    expect(a.kind).toBe("restart_soon");
    expect(a.level).toBe("warn");
  });

  it("raises an action on the restart day", () => {
    const [a] = at("2026-09-27", cycling);
    expect(a.kind).toBe("restart_now");
    expect(a.level).toBe("action");
    expect(a.body).toMatch(/cycle 2/i);
  });

  it("does not treat the very first day of cycle 1 as a restart", () => {
    expect(at("2026-07-05", cycling)).toEqual([]);
  });
});

describe("cycleAlerts — protocols with no plan", () => {
  it("emits nothing for a protocol with no cycle length", () => {
    expect(at("2026-08-30", proto({ onWeeks: null }))).toEqual([]);
  });

  it("emits nothing for a protocol with no anchor", () => {
    expect(at("2026-08-30", proto({ anchor: null }))).toEqual([]);
  });

  it("handles an empty protocol list", () => {
    expect(cycleAlerts([], d("2026-08-30"))).toEqual([]);
  });
});

describe("cycleAlerts — ordering and multiple protocols", () => {
  it("puts the most urgent alert first", () => {
    const alerts = cycleAlerts(
      [
        proto({ id: "quiet", peptideName: "B", offWeeks: 4 }), // off_cycle → info
        proto({ id: "urgent", peptideName: "A", anchor: d("2026-07-06") }), // last dose 30 Aug
      ],
      d("2026-08-30"),
    );
    expect(alerts[0].protocolId).toBe("urgent");
    expect(alerts[0].level).toBe("action");
  });
});

describe("bannerAlerts — what the dashboard actually renders", () => {
  it("drops info-level noise", () => {
    const all = cycleAlerts([proto({ offWeeks: 4 })], d("2026-09-05"));
    expect(all).toHaveLength(1);
    expect(bannerAlerts(all)).toEqual([]);
  });

  it("keeps warnings and actions", () => {
    expect(bannerAlerts(at("2026-08-29"))).toHaveLength(1);
  });
});

describe("cycleNotifications — push events", () => {
  const events = (today: string, p: CycleProtocol = proto()) =>
    cycleNotifications(cycleAlerts([p], d(today)));

  it("fires on the final dosing day", () => {
    const [e] = events("2026-08-29");
    expect(e.key).toBe("cycle:p1:last_dose");
    expect(e.title).toContain("MOTS-c");
    expect(e.url).toBe("/protocols");
  });

  it("fires at 7 and 3 days out, but not on the days between", () => {
    expect(events("2026-08-23")).toHaveLength(1); // 7 days
    expect(events("2026-08-27")).toHaveLength(1); // 3 days
    expect(events("2026-08-26")).toHaveLength(0); // 4 days — banner only
    expect(events("2026-08-25")).toHaveLength(0); // 5 days
  });

  it("fires once when the cycle ends, then goes quiet", () => {
    expect(events("2026-08-30")).toHaveLength(1);
    expect(events("2026-08-31")).toHaveLength(0);
  });

  it("fires on the restart day but not through the whole break", () => {
    const cycling = proto({ offWeeks: 4 });
    expect(events("2026-09-27", cycling)).toHaveLength(1);
    expect(events("2026-09-05", cycling)).toHaveLength(0);
  });

  it("never carries a dose amount", () => {
    // Mirrors the reminders.ts safety rule: a raw stored dose in a push could be
    // a multi-x overdose for per_week protocols.
    for (const day of ["2026-08-23", "2026-08-29", "2026-08-30"]) {
      for (const e of events(day)) {
        expect(`${e.title} ${e.body}`).not.toMatch(/\b\d+\s*(mcg|mg|iu|units)\b/i);
      }
    }
  });

  it("gives every event a distinct, stable claim key", () => {
    const all = cycleNotifications(
      cycleAlerts([proto(), proto({ id: "p2", peptideName: "BPC-157" })], d("2026-08-29")),
    );
    const keys = all.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("cycle:p2:last_dose");
  });
});
