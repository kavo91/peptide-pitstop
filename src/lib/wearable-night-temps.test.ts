import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({ findUnique: vi.fn(), decryptField: vi.fn() }));

vi.mock("@/lib/db", () => ({ prisma: { wearableDaily: { findUnique: m.findUnique } } }));
vi.mock("@/lib/crypto/fieldEncryption", () => ({ decryptField: m.decryptField }));

import { getEightSleepNightTemps } from "./wearable";

const RAW = { sessions: [{ timeseries: { tempBedC: [["2027-10-26T12:00:00.000Z", 28]], tempRoomC: [] } }] };

beforeEach(() => {
  vi.clearAllMocks();
  m.decryptField.mockImplementation((s: string) => s);
});

describe("getEightSleepNightTemps", () => {
  it("reads ONE eight_sleep row by its local-midnight day key and returns only the series", async () => {
    m.findUnique.mockResolvedValue({ raw: JSON.stringify(RAW) });
    const out = await getEightSleepNightTemps("owner", "2027-10-27");
    expect(m.findUnique).toHaveBeenCalledWith({
      where: { userId_date_source: { userId: "owner", date: new Date(2027, 9, 27), source: "eight_sleep" } },
      select: { raw: true },
    });
    expect(out).toEqual({ bed: [{ t: Date.parse("2027-10-26T12:00:00.000Z"), v: 28 }], room: [] });
  });

  it("is null when the night or its raw is missing", async () => {
    m.findUnique.mockResolvedValueOnce(null);
    expect(await getEightSleepNightTemps("owner", "2027-10-27")).toBeNull();
    m.findUnique.mockResolvedValueOnce({ raw: null });
    expect(await getEightSleepNightTemps("owner", "2027-10-27")).toBeNull();
    expect(m.decryptField).not.toHaveBeenCalled();
  });

  it("is null (and does not throw) when raw cannot be decrypted or parsed", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    m.findUnique.mockResolvedValue({ raw: "enc:v1:bad" });
    m.decryptField.mockImplementationOnce(() => {
      throw new Error("bad tag");
    });
    expect(await getEightSleepNightTemps("owner", "2027-10-27")).toBeNull();
    m.decryptField.mockImplementationOnce(() => "{not json");
    expect(await getEightSleepNightTemps("owner", "2027-10-27")).toBeNull();
    expect(err).toHaveBeenCalledTimes(2);
    err.mockRestore();
  });
});
