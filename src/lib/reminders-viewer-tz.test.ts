/**
 * Reminder text must be honest about the clock the phone is showing.
 *
 * Reminder TIMING is home-anchored by design (the schedule grid is home-TZ), so
 * a 21:00 slot fires at 21:00 in the runtime zone — which on a UTC−4 phone is
 * 07:00. The body used to print the bare schedule time, so a push landing at
 * 07:00 insisted it was "Scheduled for 21:00". It now carries both.
 *
 * Runtime zone here is Australia/Brisbane (pinned in vitest.config).
 */
import { describe, it, expect } from "vitest";
import { buildReminderEvents, slotTimeLabel, type SlotReminderCandidate } from "./reminders";

const AT_2100 = new Date("2026-07-28T21:00:00"); // runtime-local 21:00
const SANTIAGO = "America/Santiago"; // UTC−4 in July → 14 h behind Brisbane

const dose = (over: Partial<SlotReminderCandidate> = {}): SlotReminderCandidate => ({
  protocolId: "p1", peptideName: "Peptide A", time: "21:00", alreadyLoggedToday: false, ...over,
});

describe("slotTimeLabel", () => {
  it("adds the device-local time when the zones differ", () => {
    expect(slotTimeLabel(AT_2100, "21:00", SANTIAGO)).toBe("21:00 (07:00 your time)");
  });

  it("leaves the bare time when the device is in the runtime zone", () => {
    expect(slotTimeLabel(AT_2100, "21:00", "Australia/Brisbane")).toBe("21:00");
  });

  it("leaves the bare time when no zone is known", () => {
    expect(slotTimeLabel(AT_2100, "21:00", null)).toBe("21:00");
    expect(slotTimeLabel(AT_2100, "21:00", undefined)).toBe("21:00");
  });

  it("ignores a junk zone rather than throwing", () => {
    expect(slotTimeLabel(AT_2100, "21:00", "Not/AZone")).toBe("21:00");
  });
});

describe("reminder bodies", () => {
  it("slot reminder states both clocks while travelling", () => {
    const [ev] = buildReminderEvents([dose()], AT_2100, 30, { viewerTz: SANTIAGO });
    expect(ev.body).toBe("Scheduled for 21:00 (07:00 your time).");
  });

  it("slot reminder is unchanged at home", () => {
    const [ev] = buildReminderEvents([dose()], AT_2100, 30, {});
    expect(ev.body).toBe("Scheduled for 21:00.");
  });

  it("nag labels use the device clock alone, not a nested double time", () => {
    // 08:00 runtime-local = 18:00 the previous day in Santiago. The dose's moment
    // has passed by the 18:00 nag, so it qualifies as still-pending.
    const evs = buildReminderEvents([dose({ time: "08:00" })], new Date("2026-07-28T18:00:00"), 30, {
      viewerTz: SANTIAGO,
      nagTime: "18:00",
    });
    const nag = evs.find((e) => e.key === "nag");
    expect(nag, "nag event expected").toBeDefined();
    expect(nag!.body).toBe("Peptide A (18:00 your time) — not logged yet today.");
    expect(nag!.body, "must not nest two clocks in one bracket").not.toContain("((");
  });

  it("nag labels stay bare at home", () => {
    const evs = buildReminderEvents([dose({ time: "08:00" })], new Date("2026-07-28T18:00:00"), 30, {
      nagTime: "18:00",
    });
    expect(evs.find((e) => e.key === "nag")!.body).toBe("Peptide A (08:00) — not logged yet today.");
  });

  it("untimed doses have no slot time, so nothing to convert", () => {
    const [ev] = buildReminderEvents([dose({ time: null })], new Date("2026-07-28T08:00:00"), 30, {
      viewerTz: SANTIAGO,
    });
    expect(ev.body).toBe("Daily dose — not logged yet today.");
  });

  it("timing is untouched — the event still fires on the home-anchored moment", () => {
    // 07:00 runtime-local is nowhere near the 21:00 slot: no event, zone or not.
    expect(buildReminderEvents([dose()], new Date("2026-07-28T07:00:00"), 30, { viewerTz: SANTIAGO })).toHaveLength(0);
  });
});
