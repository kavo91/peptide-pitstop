import { describe, it, expect } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  it("emits a header row then data rows, CRLF-terminated", () => {
    const csv = toCsv(["a", "b"], [
      [1, 2],
      [3, 4],
    ]);
    expect(csv).toBe("a,b\r\n1,2\r\n3,4\r\n");
  });

  it("renders null and undefined as empty fields", () => {
    expect(toCsv(["a", "b", "c"], [[null, undefined, "x"]])).toBe("a,b,c\r\n,,x\r\n");
  });

  it("quotes fields containing a comma", () => {
    expect(toCsv(["a"], [["x,y"]])).toBe("a\r\n\"x,y\"\r\n");
  });

  it("quotes fields containing a double-quote and doubles the quote", () => {
    expect(toCsv(["a"], [['he said "hi"']])).toBe("a\r\n\"he said \"\"hi\"\"\"\r\n");
  });

  it("quotes fields containing CR or LF", () => {
    expect(toCsv(["a"], [["line1\nline2"]])).toBe("a\r\n\"line1\nline2\"\r\n");
    expect(toCsv(["a"], [["line1\r\nline2"]])).toBe("a\r\n\"line1\r\nline2\"\r\n");
  });

  it("does not quote plain fields", () => {
    expect(toCsv(["a", "b"], [["plain", "also-plain"]])).toBe("a,b\r\nplain,also-plain\r\n");
  });

  it("stringifies numbers (including 0) without quoting", () => {
    expect(toCsv(["n"], [[0]])).toBe("n\r\n0\r\n");
  });

  it("handles a header-only export (no data rows)", () => {
    expect(toCsv(["a", "b"], [])).toBe("a,b\r\n");
  });

  it("quotes a field that is exactly a quote character", () => {
    expect(toCsv(["a"], [['"']])).toBe("a\r\n\"\"\"\"\r\n");
  });
});
