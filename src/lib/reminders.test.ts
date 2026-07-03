import { describe, it, expect } from "vitest";
import {
  buildReminderEvents,
  reminderMoment,
  REMINDER_GRACE_MINUTES,
  UNTIMED_REMINDER_TIME,
  NAG_TIME,
  type SlotReminderCandidate,
} from "./reminders";

// ─── helpers ───────────────────────────────────────────────────────────────

/** Build a due-dose candidate (shape mirrors lib/today's DueDose). */
function cand(
  time: string | null,
  overrides: Partial<SlotReminderCandidate> = {},
): SlotReminderCandidate {
  return {
    protocolId: "proto-1",
    peptideName: "GHK-Cu",
    time,
    alreadyLoggedToday: false,
    ...overrides,
  };
}

/** Local Date on 2026-06-21 at "HH:MM". */
const at = (hhmm: string) => new Date(`2026-06-21T${hhmm}:00+10:00`);

const LOOKAHEAD = 30;

// ─── reminderMoment ──────────────────────────────────────────────────────────

describe("reminderMoment", () => {
  it("anchors a timed slot at its own local time on the given day", () => {
    expect(reminderMoment(at("06:00"), "20:00").getTime()).toBe(at("20:00").getTime());
  });

  it("anchors an untimed dose at the default reminder time", () => {
    const [h, m] = UNTIMED_REMINDER_TIME.split(":").map(Number);
    const moment = reminderMoment(at("13:37"), null);
    expect(moment.getHours()).toBe(h);
    expect(moment.getMinutes()).toBe(m);
    expect(moment.getDate()).toBe(21); // same local day
  });
});

// ─── slot events: window membership ──────────────────────────────────────────

describe("buildReminderEvents — slot windows", () => {
  it("emits a slot event inside the window with the right key/tag/body", () => {
    const events = buildReminderEvents([cand("20:00")], at("19:45"), LOOKAHEAD);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      key: "proto-1@20:00",
      tag: "peptide-proto-1",
      url: "/today",
    });
    expect(events[0].title).toContain("GHK-Cu");
    expect(events[0].body).toContain("20:00");
  });

  it("includes the exact window bounds (now−grace and now+lookahead inclusive)", () => {
    const c = cand("20:00");
    const afterGrace = new Date(at("20:00").getTime() + REMINDER_GRACE_MINUTES * 60_000);
    expect(buildReminderEvents([c], afterGrace, LOOKAHEAD)).toHaveLength(1);
    const beforeLookahead = at("19:30");
    expect(buildReminderEvents([c], beforeLookahead, LOOKAHEAD)).toHaveLength(1);
  });

  it("a 20:00 slot must NOT remind at 06:00 (the old midnight-row bug class)", () => {
    expect(buildReminderEvents([cand("20:00")], at("06:00"), LOOKAHEAD)).toHaveLength(0);
  });

  it("an untimed dose reminds around the default time, not at midnight", () => {
    const c = cand(null);
    const events = buildReminderEvents([c], at("07:45"), LOOKAHEAD);
    expect(events).toHaveLength(1);
    expect(events[0].key).toBe("proto-1@untimed");
    expect(events[0].body).toContain("not logged yet");
    expect(buildReminderEvents([c], at("00:05"), LOOKAHEAD)).toHaveLength(0);
    expect(buildReminderEvents([c], at("12:00"), LOOKAHEAD)).toHaveLength(0);
  });

  it("a dose already logged today never reminds", () => {
    expect(
      buildReminderEvents([cand("20:00", { alreadyLoggedToday: true })], at("20:00"), LOOKAHEAD),
    ).toHaveLength(0);
  });
});

// ─── multi-time schedules ────────────────────────────────────────────────────

describe("buildReminderEvents — multi-time schedules", () => {
  const morning = cand("08:00");
  const evening = cand("20:00");

  it("each slot of a multi-time protocol gets its own event in its own window", () => {
    const am = buildReminderEvents([morning, evening], at("08:00"), LOOKAHEAD);
    expect(am.map((e) => e.key)).toEqual(["proto-1@08:00"]);

    const pm = buildReminderEvents([morning, evening], at("20:00"), LOOKAHEAD);
    expect(pm.map((e) => e.key)).toEqual(["proto-1@20:00"]);
  });

  it("overlapping windows emit BOTH slot events (distinct keys, shared tag)", () => {
    const a = cand("19:50");
    const b = cand("20:10");
    const events = buildReminderEvents([a, b], at("20:00"), LOOKAHEAD);
    expect(events.map((e) => e.key).sort()).toEqual(["proto-1@19:50", "proto-1@20:10"]);
    // Same collapse tag → the later push replaces the earlier on the phone.
    expect(new Set(events.map((e) => e.tag)).size).toBe(1);
  });

  it("duplicate (protocol, slot) candidates dedupe to one event", () => {
    const events = buildReminderEvents([cand("20:00"), cand("20:00")], at("20:00"), LOOKAHEAD);
    expect(events).toHaveLength(1);
  });
});

// ─── the 18:00 nag ───────────────────────────────────────────────────────────

describe(`buildReminderEvents — ${NAG_TIME} nag`, () => {
  it("nags once for every unlogged dose whose moment has passed", () => {
    const dueDoses = [
      cand(null, { protocolId: "p-bpc", peptideName: "BPC-157" }),
      cand("09:00", { protocolId: "p-ta1", peptideName: "Thymosin Alpha-1" }),
    ];
    const events = buildReminderEvents(dueDoses, at("18:00"), LOOKAHEAD);
    const nag = events.find((e) => e.key === "nag");
    expect(nag).toBeDefined();
    expect(nag!.title).toContain("2 doses");
    expect(nag!.body).toContain("BPC-157");
    expect(nag!.body).toContain("Thymosin Alpha-1 (09:00)");
    expect(nag!.tag).toBe("peptide-nag");
  });

  it("a FUTURE slot is excluded from the nag — it gets its own reminder later", () => {
    const dueDoses = [
      cand(null, { protocolId: "p-bpc", peptideName: "BPC-157" }),
      cand("20:00", { protocolId: "p-ghk", peptideName: "GHK-Cu" }),
    ];
    const events = buildReminderEvents(dueDoses, at("18:00"), LOOKAHEAD);
    const nag = events.find((e) => e.key === "nag");
    expect(nag).toBeDefined();
    expect(nag!.title).toContain("1 dose still pending");
    expect(nag!.body).not.toContain("GHK-Cu");
  });

  it("no nag when everything pending is already logged", () => {
    const dueDoses = [
      cand(null, { alreadyLoggedToday: true }),
      cand("09:00", { protocolId: "p2", alreadyLoggedToday: true }),
    ];
    expect(buildReminderEvents(dueDoses, at("18:00"), LOOKAHEAD)).toHaveLength(0);
  });

  it("no nag outside the nag window", () => {
    const events = buildReminderEvents([cand(null)], at("14:00"), LOOKAHEAD);
    expect(events.find((e) => e.key === "nag")).toBeUndefined();
  });

  it("a nag claimed BEFORE 18:00 excludes doses whose moment is still ahead of NOW", () => {
    // 17:31 tick: the 18:00 nag anchor is in-window, but an 18:00-slotted dose
    // is 29 minutes in the future — it must not be called "still pending"
    // (its own slot reminder covers it). With nothing pending, NO nag event is
    // emitted at all, so the once-per-day claim isn't wasted…
    const dose = cand("18:00");
    const early = buildReminderEvents([dose], at("17:31"), LOOKAHEAD);
    expect(early.find((e) => e.key === "nag")).toBeUndefined();
    expect(early.map((e) => e.key)).toEqual(["proto-1@18:00"]); // slot reminder only

    // …and a later tick (dose still unlogged, moment now past) nags correctly.
    const later = buildReminderEvents([dose], at("18:16"), LOOKAHEAD);
    const nag = later.find((e) => e.key === "nag");
    expect(nag).toBeDefined();
    expect(nag!.body).toContain("GHK-Cu (18:00)");
  });

  it("a multi-slot protocol counts once in the nag", () => {
    const dueDoses = [cand("08:00"), cand("12:00")];
    const events = buildReminderEvents(dueDoses, at("18:00"), LOOKAHEAD);
    const nag = events.find((e) => e.key === "nag");
    expect(nag!.title).toContain("1 dose still pending");
  });

  it("custom anchors: untimed doses follow opts.untimedTime, the nag follows opts.nagTime", () => {
    const c = cand(null);
    // Untimed anchor moved to 10:30 — reminds there, not at the 08:00 default.
    expect(buildReminderEvents([c], at("10:30"), LOOKAHEAD, { untimedTime: "10:30" })).toHaveLength(1);
    expect(buildReminderEvents([c], at("08:00"), LOOKAHEAD, { untimedTime: "10:30" })).toHaveLength(0);

    // Nag anchor moved to 21:00 — fires there (pending: untimed moment 10:30 has passed).
    const evening = buildReminderEvents([c], at("21:00"), LOOKAHEAD, { untimedTime: "10:30", nagTime: "21:00" });
    expect(evening.find((e) => e.key === "nag")).toBeDefined();
    expect(
      buildReminderEvents([c], at("18:00"), LOOKAHEAD, { untimedTime: "10:30", nagTime: "21:00" }).find((e) => e.key === "nag"),
    ).toBeUndefined();
  });

  it("nagTime: null disables the nag entirely", () => {
    const events = buildReminderEvents([cand(null)], at("18:00"), LOOKAHEAD, { nagTime: null });
    expect(events.find((e) => e.key === "nag")).toBeUndefined();
  });

  it("malformed anchor overrides fall back to the defaults", () => {
    const c = cand(null);
    // Bad untimed time → 08:00 default still anchors the reminder…
    expect(buildReminderEvents([c], at("08:00"), LOOKAHEAD, { untimedTime: "25:99" })).toHaveLength(1);
    // …and a bad nag time → 18:00 default still nags.
    const events = buildReminderEvents([c], at("18:00"), LOOKAHEAD, { nagTime: "nope" });
    expect(events.find((e) => e.key === "nag")).toBeDefined();
  });

  it("nag and an in-window slot event can coexist (distinct keys)", () => {
    // A 17:45 slot is inside the 18:00 nag window AND its own window.
    const dueDoses = [
      cand("17:45", { protocolId: "p-a", peptideName: "A" }),
      cand(null, { protocolId: "p-b", peptideName: "B" }),
    ];
    const events = buildReminderEvents(dueDoses, at("18:00"), LOOKAHEAD);
    expect(events.map((e) => e.key).sort()).toEqual(["nag", "p-a@17:45"]);
  });
});
