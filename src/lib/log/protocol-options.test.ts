import { describe, it, expect } from "vitest";
import { buildProtocolDoseOptions } from "./protocol-options";
import type { ProtocolForOptions } from "./protocol-options";

// A 2×/week schedule: Mon + Thu, untimed (legacy RRULE form).
const TWICE_WEEKLY = "FREQ=WEEKLY;BYDAY=MO,TH";
// A daily schedule (7×/week).
const DAILY = "FREQ=DAILY";

function baseProtocol(over: Partial<ProtocolForOptions>): ProtocolForOptions {
  return {
    id: "proto-1",
    peptideId: "pep-1",
    peptideName: "Test Peptide",
    doseBasis: "per_injection",
    targetDose: "250",
    doseInputUnit: "mcg",
    scheduleRule: DAILY,
    rebaseMode: "fixed_anchor",
    startDate: null,
    endDate: null,
    adherenceWindowMin: 120,
    steps: [],
    deliveredLogs: [],
    activePreparationId: "prep-1",
    ...over,
  };
}

const NOW = new Date(2026, 0, 7); // a Wednesday within the anchor window

describe("buildProtocolDoseOptions", () => {
  it("per_injection protocol passes the dose through unchanged", () => {
    const opts = buildProtocolDoseOptions(
      [baseProtocol({ doseBasis: "per_injection", targetDose: "250", scheduleRule: DAILY })],
      NOW,
    );
    expect(opts).toHaveLength(1);
    expect(opts[0].doseValue).toBe("250");
    expect(opts[0].doseUnit).toBe("mcg");
    expect(opts[0].protocolId).toBe("proto-1");
    expect(opts[0].peptideId).toBe("pep-1");
    expect(opts[0].preparationId).toBe("prep-1");
  });

  it("per_week 350 mcg/week at 2×/week → doseValue '175' (NOT 350) — §6 lock", () => {
    const opts = buildProtocolDoseOptions(
      [baseProtocol({ doseBasis: "per_week", targetDose: "350", scheduleRule: TWICE_WEEKLY })],
      NOW,
    );
    expect(opts[0].doseValue).toBe("175");
    expect(opts[0].doseValue).not.toBe("350");
    expect(opts[0].doseUnit).toBe("mcg");
  });

  it("per_week with UNRESOLVED frequency → doseValue '' (fail-safe, never raw weekly)", () => {
    const opts = buildProtocolDoseOptions(
      [baseProtocol({ doseBasis: "per_week", targetDose: "350", scheduleRule: null })],
      NOW,
    );
    expect(opts[0].doseValue).toBe("");
    expect(opts[0].doseValue).not.toBe("350");
  });

  it("active-phase step dose wins over targetDose", () => {
    // Titration: step 0 = 200 mcg for 14 days, step 1 = 400 mcg. With no delivered
    // doses and startDate today, the active phase is step 0 → 200, not targetDose 999.
    const opts = buildProtocolDoseOptions(
      [
        baseProtocol({
          doseBasis: "per_injection",
          targetDose: "999",
          scheduleRule: DAILY,
          startDate: NOW,
          steps: [
            { stepIndex: 0, dose: "200", doseInputUnit: "mcg", durationDays: 14 },
            { stepIndex: 1, dose: "400", doseInputUnit: "mcg", durationDays: null },
          ],
        }),
      ],
      NOW,
    );
    expect(opts[0].doseValue).toBe("200");
    expect(opts[0].doseValue).not.toBe("999");
  });

  it("emits one option per protocol, carrying peptide identity", () => {
    const opts = buildProtocolDoseOptions(
      [
        baseProtocol({ id: "a", peptideId: "p-a", peptideName: "Alpha" }),
        baseProtocol({ id: "b", peptideId: "p-b", peptideName: "Beta", activePreparationId: undefined }),
      ],
      NOW,
    );
    expect(opts.map((o) => o.protocolId)).toEqual(["a", "b"]);
    expect(opts[1].peptideName).toBe("Beta");
    expect(opts[1].preparationId).toBeUndefined();
  });
});
