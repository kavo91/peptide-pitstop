/**
 * Device-type helpers shared across the syringe / pen / pump surfaces.
 * Pure, no I/O. `Syringe.deviceType` is a plain TEXT column with no CHECK
 * constraint, so any stored/legacy value must be coerced through here rather
 * than trusted verbatim.
 */

/** How a device is presented + dosed. syringe = draw to a barrel mark, pen = dial a dose, pump = fixed-volume nasal spray actuation. */
export type DeviceType = "syringe" | "pen" | "pump";

/** Coerce an arbitrary stored/DB string into a known DeviceType. Unknown/missing values default to "syringe" (matches the column's own default). */
export function coerceDeviceType(s: string | null | undefined): DeviceType {
  if (s === "pen") return "pen";
  if (s === "pump") return "pump";
  return "syringe";
}

/** True when the device is a nasal pump — fixed metered-spray-volume dosing. */
export function isPump(d: DeviceType | string | null | undefined): boolean {
  return d === "pump";
}
