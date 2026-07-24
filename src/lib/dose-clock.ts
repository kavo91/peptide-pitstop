/**
 * Pick the authoritative instant for a dose write.
 *
 * "Log now" uses the server clock so elapsed-time, half-life and titration
 * ordering do not depend on a handset clock. A manually selected/historical
 * time remains the user's explicit instant. Dates are stored by Prisma as an
 * absolute UTC instant; display timezone is a separate DoseLog.tz concern.
 */
export function doseTakenAt(
  inputTakenAtISO: string | undefined,
  useServerTime: boolean,
  serverNow = new Date(),
): Date {
  if (useServerTime || !inputTakenAtISO) return serverNow;
  return new Date(inputTakenAtISO);
}
