/**
 * Minimal RFC-4180 CSV serialiser — no dependencies.
 *
 * Escaping rules:
 *  - A field is wrapped in double-quotes only when it contains a comma, a
 *    double-quote, a carriage return, or a line feed.
 *  - Embedded double-quotes are escaped by doubling them ("" ).
 *  - `null` / `undefined` render as an empty field.
 *
 * Records (the header plus each data row) are joined and terminated with CRLF,
 * including a trailing CRLF after the final record (the conventional form for a
 * downloadable .csv that Excel/Sheets parse cleanly).
 */

const NEEDS_QUOTING = /[",\r\n]/;

function escapeField(value: string | number | null | undefined): string {
  if (value == null) return "";
  const s = String(value);
  return NEEDS_QUOTING.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(
  headers: string[],
  rows: (string | number | null | undefined)[][],
): string {
  const records = [headers, ...rows];
  return records.map((row) => row.map(escapeField).join(",")).join("\r\n") + "\r\n";
}
