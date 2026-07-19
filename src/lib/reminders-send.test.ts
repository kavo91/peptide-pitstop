/**
 * sendDueReminders — delivery loop (claim → send → record).
 *
 * The pure planner (buildReminderEvents) is covered in reminders.test.ts. This
 * file covers the DELIVERY side, which was previously untested and carried two
 * real bugs:
 *
 *   1. The channel was written at CLAIM time as `webPush ? "webpush" : "ha"`,
 *      so an event that actually fell back to HA was still filed as "webpush" —
 *      the ledger lied about which channel delivered.
 *   2. When NO channel delivered, the claim still stood and was never retried,
 *      so the reminder was lost forever (a silently missed dose reminder).
 *
 * The never-double-send guarantee must survive both fixes: a claim is released
 * ONLY when we are certain nothing went out (every channel cleanly reported
 * zero). If a channel throws mid-send, delivery is unknown and the claim STANDS.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  del: vi.fn(),
  findUnique: vi.fn(),
  getTodayDoses: vi.fn(),
  webPushAvailable: vi.fn(),
  sendWebPush: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: h.findUnique },
    reminderSend: { create: h.create, update: h.update, delete: h.del },
  },
}));
vi.mock("@/lib/push", () => ({
  webPushAvailable: h.webPushAvailable,
  sendWebPush: h.sendWebPush,
}));
vi.mock("@/lib/today", () => ({ getTodayDoses: h.getTodayDoses }));

import { sendDueReminders, reminderMoment } from "@/lib/reminders";

const DUE = [{ protocolId: "p1", peptideName: "Semax", time: "06:00", alreadyLoggedToday: false }];
// Use the slot's own moment as `now` so the event is exactly in-window in ANY timezone.
const NOW = reminderMoment(new Date("2026-07-14T00:00:00"), "06:00");

describe("sendDueReminders — channel ledger + claim release", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.findUnique.mockResolvedValue(null); // default reminder anchors
    h.getTodayDoses.mockResolvedValue(DUE);
    h.create.mockResolvedValue({ id: "claim1" });
    h.update.mockResolvedValue({});
    h.del.mockResolvedValue({});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    delete process.env.HA_WEBHOOK_URL;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.HA_WEBHOOK_URL;
  });

  it("claims as 'pending' — never guesses the channel up front", async () => {
    h.webPushAvailable.mockResolvedValue(true);
    h.sendWebPush.mockResolvedValue(1);

    await sendDueReminders("u1", NOW);

    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.create.mock.calls[0][0].data).toMatchObject({ channel: "pending" });
  });

  it("records 'webpush' when web push delivers, and keeps the claim", async () => {
    h.webPushAvailable.mockResolvedValue(true);
    h.sendWebPush.mockResolvedValue(1);

    const sent = await sendDueReminders("u1", NOW);

    expect(sent).toBe(1);
    expect(h.update).toHaveBeenCalledWith({ where: { id: "claim1" }, data: { channel: "webpush" } });
    expect(h.del).not.toHaveBeenCalled();
  });

  // THE LEDGER-LIE REGRESSION: web push accepted nothing, HA actually delivered.
  // The old code filed this as "webpush".
  it("records 'ha' when web push delivers zero and HA takes it", async () => {
    process.env.HA_WEBHOOK_URL = "http://ha.local/api/webhook/x";
    h.webPushAvailable.mockResolvedValue(true);
    h.sendWebPush.mockResolvedValue(0);

    const sent = await sendDueReminders("u1", NOW);

    expect(sent).toBe(1);
    expect(h.update).toHaveBeenCalledWith({ where: { id: "claim1" }, data: { channel: "ha" } });
    expect(h.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { channel: "webpush" } }),
    );
    expect(h.del).not.toHaveBeenCalled();
  });

  // THE LOST-REMINDER REGRESSION: nothing delivered, so the claim must be
  // released for the next 15-min tick to retry while still in-window.
  it("releases the claim when NO channel delivered (so the next tick retries)", async () => {
    h.webPushAvailable.mockResolvedValue(true);
    h.sendWebPush.mockResolvedValue(0); // accepted nothing; no HA configured

    const sent = await sendDueReminders("u1", NOW);

    expect(sent).toBe(0);
    expect(h.del).toHaveBeenCalledWith({ where: { id: "claim1" } });
    expect(h.update).not.toHaveBeenCalled();
  });

  // NEVER-DOUBLE-SEND: a throw means delivery is UNKNOWN — the claim must stand.
  it("keeps the claim when a channel throws (delivery unknown — never double-send)", async () => {
    h.webPushAvailable.mockResolvedValue(true);
    h.sendWebPush.mockRejectedValue(new Error("push service exploded"));

    const sent = await sendDueReminders("u1", NOW);

    expect(sent).toBe(0);
    expect(h.del).not.toHaveBeenCalled(); // claim STANDS
    expect(h.update).not.toHaveBeenCalled();
  });

  it("does not double-send: a duplicate claim (unique violation) skips dispatch", async () => {
    h.webPushAvailable.mockResolvedValue(true);
    h.sendWebPush.mockResolvedValue(1);
    h.create.mockRejectedValue(new Error("unique constraint"));

    const sent = await sendDueReminders("u1", NOW);

    expect(sent).toBe(0);
    expect(h.sendWebPush).not.toHaveBeenCalled();
    expect(h.del).not.toHaveBeenCalled();
  });
});
