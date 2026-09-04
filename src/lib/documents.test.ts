import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, statSync, existsSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// DOCUMENTS_DIR is read at module load — pin it to a temp dir BEFORE importing.
const STORE = vi.hoisted(() => {
  const { mkdtempSync } = require("node:fs") as typeof import("node:fs");
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const path = require("node:path") as typeof import("node:path");
  const dir = mkdtempSync(path.join(tmpdir(), "pt-docs-"));
  process.env.DOCUMENTS_DIR = dir;
  return dir;
});

import {
  DOCUMENTS_DIR,
  MAX_DOCUMENT_BYTES,
  DocumentValidationError,
  dbFileFromDatabaseUrl,
  validatePdfBuffer,
  resolveInsideStore,
  saveDocumentFile,
  readDocumentFile,
  deleteDocumentFile,
  openDocumentStream,
} from "./documents";

const pdf = (extra = "") => Buffer.from(`%PDF-1.4\n% synthetic ${extra}\n%%EOF`);

describe("documents store — configuration", () => {
  it("honours DOCUMENTS_DIR", () => {
    expect(DOCUMENTS_DIR).toBe(path.resolve(STORE));
  });

  it("derives the DB file from DATABASE_URL like the container entrypoint (strip file:, drop ?query)", () => {
    expect(dbFileFromDatabaseUrl("file:/data/peptides.db")).toBe("/data/peptides.db");
    expect(dbFileFromDatabaseUrl("file:/data/peptides.db?connection_limit=1")).toBe("/data/peptides.db");
    expect(dbFileFromDatabaseUrl("file:./prisma/peptides.db")).toBe(path.resolve("./prisma/peptides.db"));
  });
});

describe("validatePdfBuffer", () => {
  it("accepts a %PDF- prefix within the size limit", () => {
    expect(() => validatePdfBuffer(pdf())).not.toThrow();
  });
  it("refuses a .txt renamed to .pdf (no magic bytes)", () => {
    expect(() => validatePdfBuffer(Buffer.from("hello world, definitely not a pdf"))).toThrow(DocumentValidationError);
    expect(() => validatePdfBuffer(Buffer.from("hello world, definitely not a pdf"))).toThrow(/not a PDF/);
  });
  it("refuses an empty file", () => {
    expect(() => validatePdfBuffer(Buffer.alloc(0))).toThrow(/empty/);
  });
  it("refuses > 10 MB even with a valid header", () => {
    const big = Buffer.alloc(MAX_DOCUMENT_BYTES + 1, 0x20);
    big.write("%PDF-1.4", 0, "latin1");
    expect(() => validatePdfBuffer(big)).toThrow(/10 MB/);
    const atLimit = Buffer.alloc(MAX_DOCUMENT_BYTES, 0x20);
    atLimit.write("%PDF-1.4", 0, "latin1");
    expect(() => validatePdfBuffer(atLimit)).not.toThrow();
  });
});

describe("resolveInsideStore — traversal guard", () => {
  it("accepts paths inside the store", () => {
    expect(resolveInsideStore(path.join(STORE, "u1", "a.pdf"))).toBe(path.join(STORE, "u1", "a.pdf"));
  });
  it("rejects ../ escapes, siblings and absolute paths elsewhere", () => {
    expect(() => resolveInsideStore(path.join(STORE, "..", "etc", "passwd"))).toThrow(DocumentValidationError);
    expect(() => resolveInsideStore(STORE + "-sibling/a.pdf")).toThrow(DocumentValidationError);
    expect(() => resolveInsideStore("/etc/passwd")).toThrow(DocumentValidationError);
    expect(() => resolveInsideStore(path.join(STORE, "u1", "..", "..", "x.pdf"))).toThrow(DocumentValidationError);
  });
});

describe("save / read / stream / delete round trip", () => {
  it("stores under <store>/<userId>/<id>.pdf with 0600, reads back byte-identical, deletes idempotently", async () => {
    const buf = pdf("round-trip");
    const { id, filePath } = await saveDocumentFile("user_abc123", buf, "pdf");
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(filePath).toBe(path.join(STORE, "user_abc123", `${id}.pdf`));
    expect(statSync(filePath).mode & 0o777).toBe(0o600);
    expect(statSync(path.dirname(filePath)).mode & 0o777).toBe(0o700);

    const back = await readDocumentFile(filePath);
    expect(back.equals(buf)).toBe(true);

    const opened = await openDocumentStream(filePath);
    expect(opened.size).toBe(buf.length);
    const chunks: Uint8Array[] = [];
    const reader = opened.stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value as Uint8Array);
    }
    expect(Buffer.concat(chunks).equals(buf)).toBe(true);

    await deleteDocumentFile(filePath);
    expect(existsSync(filePath)).toBe(false);
    await expect(deleteDocumentFile(filePath)).resolves.toBeUndefined(); // ENOENT tolerated
  });

  it("never uses a client filename and refuses a non-PDF body before touching disk", async () => {
    await expect(saveDocumentFile("user_abc123", Buffer.from("plain text"), "pdf")).rejects.toThrow(DocumentValidationError);
  });

  it("refuses a user id that could traverse", async () => {
    await expect(saveDocumentFile("../evil", pdf(), "pdf")).rejects.toThrow(DocumentValidationError);
  });

  it("read and stream refuse paths outside the store even when the file exists", async () => {
    const outside = mkdtempSync(path.join(tmpdir(), "pt-outside-"));
    const f = path.join(outside, "x.pdf");
    writeFileSync(f, pdf());
    await expect(readDocumentFile(f)).rejects.toThrow(DocumentValidationError);
    await expect(openDocumentStream(f)).rejects.toThrow(DocumentValidationError);
    await expect(deleteDocumentFile(f)).rejects.toThrow(DocumentValidationError);
    expect(existsSync(f)).toBe(true);
    rmSync(outside, { recursive: true, force: true });
  });

  it("read and stream refuse a symlink inside the store that points outside it (defence in depth)", async () => {
    const outside = mkdtempSync(path.join(tmpdir(), "pt-outside-"));
    const secret = path.join(outside, "app.env");
    writeFileSync(secret, "PT_FIELD_KEY=not-for-serving\n");
    const dir = path.join(STORE, "u_symlink");
    mkdirSync(dir, { recursive: true });
    const link = path.join(dir, "l1symlink.pdf");
    symlinkSync(secret, link);
    expect(resolveInsideStore(link)).toBe(link); // lexically inside — the guard below is what refuses it
    await expect(readDocumentFile(link)).rejects.toThrow(DocumentValidationError);
    await expect(openDocumentStream(link)).rejects.toThrow(DocumentValidationError);
    // A symlink to a file INSIDE the store is refused too: the store serves regular files only.
    const real = path.join(dir, "real.pdf");
    writeFileSync(real, pdf("real"));
    const inner = path.join(dir, "inner-link.pdf");
    symlinkSync(real, inner);
    await expect(readDocumentFile(inner)).rejects.toThrow(DocumentValidationError);
    expect((await readDocumentFile(real)).equals(pdf("real"))).toBe(true);
    rmSync(outside, { recursive: true, force: true });
  });

  it("openDocumentStream rejects a missing file", async () => {
    await expect(openDocumentStream(path.join(STORE, "u", "missing.pdf"))).rejects.toThrow();
  });
});

beforeAll(() => {
  expect(existsSync(STORE)).toBe(true);
});
afterAll(() => {
  rmSync(STORE, { recursive: true, force: true });
});
