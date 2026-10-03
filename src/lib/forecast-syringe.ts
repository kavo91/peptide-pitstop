/**
 * The device a forecast sizes one dose with — pure, no I/O.
 *
 * `Protocol.defaultSyringeId` is a bare column, so callers look the row up and
 * hand it here. The SAME conversion feeds the reorder tile (`reorder.ts`) and
 * the per-vial figures on /inventory (`inventory.ts`), so the two pages round a
 * dose to the same device step the logger draws with (`actions/doses.ts`) and
 * cannot print different counts for one vial (ruling R14). A pump is an
 * mL-graduated device: rounding it on a U-100 barrel is wrong.
 */
import type { Syringe } from "@/lib/dosing/types";

/** Fallback when a protocol names no device. U-100 is the app-wide default. */
export const DEFAULT_FORECAST_SYRINGE: Syringe = {
  name: "U-100 1mL",
  graduationType: "units",
  unitsPerMl: 100,
  capacityMl: 1,
  capacityUnits: 100,
  increment: 1,
};

/** The Prisma `Syringe` columns a forecast needs (Decimal fields arrive as objects). */
export interface SyringeRowLike {
  name: string;
  graduationType: string;
  unitsPerMl: number;
  capacityMl: { toString(): string } | number | string;
  capacityUnits: number;
  increment: { toString(): string } | number | string;
}

/** The protocol's real device, or the U-100 default when it names none. */
export function forecastSyringe(row: SyringeRowLike | null | undefined): Syringe {
  if (!row) return DEFAULT_FORECAST_SYRINGE;
  return {
    name: row.name,
    graduationType: row.graduationType as "units" | "ml",
    unitsPerMl: row.unitsPerMl,
    capacityMl: Number(row.capacityMl.toString()),
    capacityUnits: row.capacityUnits,
    increment: Number(row.increment.toString()),
  };
}
