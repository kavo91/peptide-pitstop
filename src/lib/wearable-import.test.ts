import { describe, it, expect, vi } from "vitest";
import { localMidnight, buildWearableUpsertArgs, importEightSleepDays, importWellnessDays } from "./wearable-import";
import { normaliseGarminDay } from "./wearable-normalise";
import sample from "./__fixtures__/garmin-sample.json";
import eightSample from "./__fixtures__/eight-sleep-sample.json";

const id = (s: string | null | undefined) => (s == null ? null : `ENC(${s})`);

describe("localMidnight", () => {
  it("parses YYYY-MM-DD to local midnight", () => {
    const d = localMidnight("2026-06-20");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(5); // June (0-based)
    expect(d!.getDate()).toBe(20);
    expect(d!.getHours()).toBe(0);
    expect(d!.getMinutes()).toBe(0);
  });

  it("returns null for malformed dates", () => {
    expect(localMidnight("")).toBeNull();
    expect(localMidnight("not-a-date")).toBeNull();
    expect(localMidnight("2026-13-40")).toBeNull();
    expect(localMidnight(undefined as never)).toBeNull();
  });
});

describe("buildWearableUpsertArgs", () => {
  it("targets the composite unique key, sets source=garmin and encrypts raw", () => {
    const day = normaliseGarminDay(sample);
    const args = buildWearableUpsertArgs("user-1", day, id);

    expect(args.where).toEqual({
      userId_date_source: {
        userId: "user-1",
        date: localMidnight("2026-06-20"),
        source: "garmin",
      },
    });
    expect(args.create.userId).toBe("user-1");
    expect(args.create.source).toBe("garmin");
    expect(args.create.restingHr).toBe(52);
    expect(args.create.weightKg).toBeCloseTo(81.7, 5);
    // raw is JSON-stringified then run through the encrypt fn
    expect(args.create.raw).toBe(`ENC(${JSON.stringify(sample)})`);
    // update carries the same metrics and bumps syncedAt
    expect(args.update.restingHr).toBe(52);
    expect(args.update.syncedAt).toBeInstanceOf(Date);
  });

  it("stores activities as PLAINTEXT JSON + activityCount, NOT encrypted", () => {
    const encrypt = vi.fn(id);
    const day = normaliseGarminDay({
      date: "2026-06-20",
      activities: [
        { activityType: { typeKey: "running" }, duration: 1830, distance: 5000 },
        { activityType: { typeKey: "strength_training" }, duration: 2700 },
      ],
    });
    const args = buildWearableUpsertArgs("user-1", day, encrypt);

    // activitiesJson is the verbatim JSON of the normalised activities (no ENC wrapper)
    expect(args.create.activitiesJson).toBe(JSON.stringify(day.activities));
    expect(args.create.activitiesJson).not.toContain("ENC(");
    expect(args.create.activityCount).toBe(2);
    expect(args.update.activitiesJson).toBe(JSON.stringify(day.activities));
    expect(args.update.activityCount).toBe(2);

    // encrypt is called ONCE — for `raw` only, never for the activities
    expect(encrypt).toHaveBeenCalledTimes(1);
    expect(encrypt).toHaveBeenCalledWith(JSON.stringify(day.raw));
  });

  it("encodes an empty activities array as '[]' with count 0", () => {
    const day = normaliseGarminDay({ date: "2026-06-20" });
    const args = buildWearableUpsertArgs("user-1", day, id);
    expect(args.create.activitiesJson).toBe("[]");
    expect(args.create.activityCount).toBe(0);
  });
});

describe("importWellnessDays", () => {
  it("normalises + upserts each valid day and returns the count", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const client = { wearableDaily: { upsert } };
    const second = { ...sample, date: "2026-06-19" };

    const res = await importWellnessDays(client, "user-1", [sample, second], id);

    expect(res).toEqual({ upserted: 2 });
    expect(upsert).toHaveBeenCalledTimes(2);
    const firstCall = upsert.mock.calls[0][0];
    expect(firstCall.where.userId_date_source.userId).toBe("user-1");
    expect(firstCall.where.userId_date_source.source).toBe("garmin");
  });

  it("skips malformed days (missing/invalid date) without throwing", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const client = { wearableDaily: { upsert } };

    const res = await importWellnessDays(
      client,
      "user-1",
      [sample, { steps: 10 }, { date: "garbage" }, null, "nope"],
      id,
    );

    expect(res).toEqual({ upserted: 1 });
    expect(upsert).toHaveBeenCalledTimes(1);
  });
});


// ── Training columns ride the same upsert ──
import trainingSample from "./__fixtures__/garmin-training-sample.json";

describe("buildWearableUpsertArgs — training metrics", () => {
  it("maps every training field into create and update", () => {
    const day = normaliseGarminDay(trainingSample);
    const args = buildWearableUpsertArgs("u1", day, id);
    for (const part of [args.create, args.update] as Array<Record<string, unknown>>) {
      expect(part.trainingReadiness).toBe(61);
      expect(part.trainingReadinessLevel).toBe("MODERATE");
      expect(part.acuteLoad).toBe(420);
      expect(part.chronicLoad).toBe(300);
      expect(part.acwr).toBeCloseTo(1.4, 9);
      expect(part.acwrStatus).toBe("HIGH");
      expect(part.trainingStatus).toBe("PRODUCTIVE");
      expect(part.enduranceScore).toBe(5400);
      expect(part.hillScore).toBe(35);
      expect(part.fitnessAge).toBeCloseTo(34.5, 9);
      expect(part.ltHr).toBe(162);
      expect(part.ltSpeedMs).toBeCloseTo(3.5, 9);
      expect(part.floorsClimbed).toBe(12);
      expect(part.restingHr7d).toBe(57);
    }
  });

  it("leaves the training columns undefined for a day without training keys (update never nulls them)", () => {
    const args = buildWearableUpsertArgs("u1", normaliseGarminDay(sample), id);
    expect((args.update as Record<string, unknown>).trainingReadiness).toBeUndefined();
    expect((args.update as Record<string, unknown>).acwr).toBeUndefined();
  });
});

describe("importEightSleepDays", () => {
  const night = (presenceEnd: string, sleepDuration: number) => ({
    ...eightSample,
    presenceEnd,
    sleepDuration,
    presenceDuration: sleepDuration + 600,
  });

  it("upserts under source eight_sleep with the bed metrics, never a garmin key", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const res = await importEightSleepDays({ wearableDaily: { upsert } }, "user-1", [eightSample], id);
    expect(res).toEqual({ upserted: 1 });
    const args = upsert.mock.calls[0][0];
    expect(args.where.userId_date_source).toEqual({
      userId: "user-1",
      date: localMidnight("2026-06-20"),
      source: "eight_sleep",
    });
    expect(args.create.source).toBe("eight_sleep");
    expect(args.create.sleepHrAvg).toBe(58);
    expect(args.create.tossTurns).toBe(21);
    expect(args.create.bedTempC).toBe(30.3);
    expect(args.create.roomTempC).toBe(21.5);
    expect(args.create.restingHr).toBeUndefined();
    expect(args.create.raw).toBe(`ENC(${JSON.stringify(eightSample)})`);
  });

  it("skips processing nights and garbage entries", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const res = await importEightSleepDays(
      { wearableDaily: { upsert } },
      "user-1",
      [{ ...eightSample, processing: true }, null, 7, "x", { day: "nope" }],
      id,
    );
    expect(res).toEqual({ upserted: 0 });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("keeps the longest sleep when two trend days wake on the same date, whatever the order", async () => {
    for (const order of [
      [night("2026-06-19T20:00:00.000Z", 25000), night("2026-06-20T03:00:00.000Z", 1800)],
      [night("2026-06-20T03:00:00.000Z", 1800), night("2026-06-19T20:00:00.000Z", 25000)],
    ]) {
      const upsert = vi.fn().mockResolvedValue({});
      const res = await importEightSleepDays({ wearableDaily: { upsert } }, "user-1", order, id);
      expect(res).toEqual({ upserted: 1 });
      expect(upsert.mock.calls[0][0].create.sleepSeconds).toBe(25000);
    }
  });

  it("returns 0 for a non-array", async () => {
    const upsert = vi.fn();
    expect(await importEightSleepDays({ wearableDaily: { upsert } }, "u", "x" as never, id)).toEqual({ upserted: 0 });
  });
});
