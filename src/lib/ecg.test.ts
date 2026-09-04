import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The read model's job: decrypt at read time, keep the big field out of the
 * list query, and never let one bad row take the page down.
 */
const m = vi.hoisted(() => {
  const findMany = vi.fn();
  const findFirst = vi.fn();
  const count = vi.fn();
  return { prisma: { ecgRecording: { findMany, findFirst, count } }, findMany, findFirst, count };
});

vi.mock("@/lib/db", () => ({ prisma: m.prisma }));
vi.mock("@/lib/crypto/fieldEncryption", () => ({
  encryptField: (v: string | null | undefined) => (v == null ? null : `ENC(${v})`),
  // A value that is not in the ENC(...) shape is treated as undecryptable, the
  // way a real key rotation would leave it.
  decryptField: (v: string | null | undefined) => {
    if (v == null) return null;
    const m2 = /^ENC\((.*)\)$/.exec(v);
    // Stands in for a rotated key / tag mismatch, which the real implementation
    // signals by THROWING rather than returning null.
    if (m2?.[1] === "BOOM") throw new Error("Unsupported state or unable to authenticate data");
    return m2 ? m2[1]! : null;
  },
}));

import { getEcgHistory, getEcgOverview, getLatestEcg } from "./ecg";

const WAVE = { drawnHz: 128, durationMs: 30000, points: 3, droppedStrips: 0, strips: [{ t0Ms: 0, dtMs: 8, uv: [0, 100, null] }] };

function row(over: Record<string, unknown> = {}) {
  return {
    id: "rec1",
    recordedAt: new Date("2024-06-11T23:17:00.000Z"),
    localDay: "2024-06-12",
    tz: "Australia/Brisbane",
    result: "ENC(Sinus Rhythm)",
    avgHeartRateBpm: "ENC(61)",
    symptoms: null,
    interpretation: "ENC(This ECG recording does not show signs of AFib.)",
    leadNote: "This waveform is similar to a Lead I ECG.",
    durationSec: 30,
    paperSpeedMmS: "25",
    gainMmMv: "10",
    sampleRateHz: 512,
    deviceModel: "fenix 9 Pro - inReach, 43 mm",
    deviceSoftware: "6.38",
    pdfTemplateVersion: "1.2.114",
    waveformPoints: 3,
    documentId: "doc1",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.findMany.mockResolvedValue([row()]);
  m.findFirst.mockResolvedValue({ ...row(), waveformJson: `ENC(${JSON.stringify(WAVE)})` });
  m.count.mockResolvedValue(1);
});

describe("getEcgHistory", () => {
  it("decrypts the clinical fields and turns the stored decimals into numbers", async () => {
    const [r] = await getEcgHistory("u1");
    expect(r!.result).toBe("Sinus Rhythm");
    expect(r!.avgHeartRateBpm).toBe(61);
    expect(r!.interpretation).toBe("This ECG recording does not show signs of AFib.");
    expect(r!.paperSpeedMmS).toBe(25);
    expect(r!.gainMmMv).toBe(10);
    expect(r!.hasWaveform).toBe(true);
  });

  it("never asks the database for the trace — a list of thirty would be megabytes", async () => {
    await getEcgHistory("u1", 30);
    const args = m.findMany.mock.calls[0][0];
    expect(args.select.waveformJson).toBeUndefined();
    expect(args.select.waveformPoints).toBe(true);
    expect(args.take).toBe(30);
    expect(args.where).toEqual({ userId: "u1" });
    expect(args.orderBy).toEqual({ recordedAt: "desc" });
  });

  it("says a row has no trace when none was stored", async () => {
    m.findMany.mockResolvedValueOnce([row({ waveformPoints: null })]);
    expect((await getEcgHistory("u1"))[0]!.hasWaveform).toBe(false);
  });

  it("shows a row it cannot decrypt as unreadable rather than crashing the page", async () => {
    m.findMany.mockResolvedValueOnce([row({ result: "not-encrypted-at-all", avgHeartRateBpm: "junk" })]);
    const [r] = await getEcgHistory("u1");
    expect(r!.result).toBe("Unreadable");
    expect(r!.avgHeartRateBpm).toBeNull();
  });

  it("survives a row whose decryption THROWS — one bad row must not take the page with it", async () => {
    // The real decryptField throws on a rotated key or a tag mismatch; it does
    // not return null. Every read here has to be able to take that.
    m.findMany.mockResolvedValueOnce([
      row({ result: "ENC(BOOM)", symptoms: "ENC(BOOM)", interpretation: "ENC(BOOM)", avgHeartRateBpm: "ENC(BOOM)" }),
      row({ id: "rec2" }),
    ]);
    const rows = await getEcgHistory("u1");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.result).toBe("Unreadable");
    expect(rows[0]!.symptoms).toBeNull();
    expect(rows[0]!.interpretation).toBeNull();
    expect(rows[0]!.avgHeartRateBpm).toBeNull();
    expect(rows[1]!.result).toBe("Sinus Rhythm");
  });
});

describe("getLatestEcg", () => {
  it("returns the newest recording with its trace", async () => {
    const r = await getLatestEcg("u1");
    expect(m.findFirst.mock.calls[0][0].orderBy).toEqual({ recordedAt: "desc" });
    expect(r!.waveform).toEqual(WAVE);
    expect(r!.waveform!.strips[0]!.uv[2]).toBeNull();
  });

  it("treats a trace it cannot parse as no trace", async () => {
    m.findFirst.mockResolvedValueOnce({ ...row(), waveformJson: "ENC({broken json)" });
    expect((await getLatestEcg("u1"))!.waveform).toBeNull();
  });

  it("treats a trace it cannot decrypt as no trace, not as a crash", async () => {
    m.findFirst.mockResolvedValueOnce({ ...row(), waveformJson: "ENC(BOOM)" });
    expect((await getLatestEcg("u1"))!.waveform).toBeNull();
  });

  it("treats an empty strip list as no trace", async () => {
    m.findFirst.mockResolvedValueOnce({ ...row(), waveformJson: `ENC(${JSON.stringify({ strips: [] })})` });
    expect((await getLatestEcg("u1"))!.waveform).toBeNull();
  });

  it("is null when nothing has been imported", async () => {
    m.findFirst.mockResolvedValueOnce(null);
    expect(await getLatestEcg("u1")).toBeNull();
  });
});

describe("getEcgOverview", () => {
  it("gathers the latest recording, the recent list and the total in one go", async () => {
    const o = await getEcgOverview("u1");
    expect(o.latest?.result).toBe("Sinus Rhythm");
    expect(o.history).toHaveLength(1);
    expect(o.total).toBe(1);
    expect(m.count).toHaveBeenCalledWith({ where: { userId: "u1" } });
  });
});
