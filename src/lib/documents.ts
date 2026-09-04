import "server-only";
/**
 * File store for uploaded reports (DEXA PDFs) under the data volume.
 *
 * Layout: `${DOCUMENTS_DIR}/${userId}/${id}.pdf`, files 0o600, directories
 * 0o700. `DOCUMENTS_DIR` defaults to a `documents/` folder beside the SQLite
 * file named in `DATABASE_URL` (derived the way `deploy/bundled/entrypoint.sh`
 * derives the DB path: strip the `file:` prefix), overridable with the
 * `DOCUMENTS_DIR` env var. Every read/delete re-checks that the path resolves
 * inside `DOCUMENTS_DIR` so a stored path can never escape the store.
 *
 * Validation here is on the bytes, never on a client filename: refuse > 10 MB,
 * refuse unless the first five bytes are `%PDF-`.
 */
import { promises as fs, createReadStream } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const PDF_MAGIC = "%PDF-";
const ALLOWED_EXT = new Set(["pdf"]);

export class DocumentValidationError extends Error {}

/** SQLite file path from `DATABASE_URL` (`file:` prefix and any `?query` stripped). */
export function dbFileFromDatabaseUrl(url = process.env.DATABASE_URL): string {
  const raw = (url ?? "file:./prisma/peptides.db").trim();
  const noScheme = raw.replace(/^file:/, "");
  const noQuery = noScheme.split("?")[0] ?? noScheme;
  return path.resolve(noQuery);
}

export const DOCUMENTS_DIR: string = path.resolve(
  process.env.DOCUMENTS_DIR?.trim() || path.join(path.dirname(dbFileFromDatabaseUrl()), "documents"),
);

/** Throws `DocumentValidationError` unless the bytes are a PDF within the size limit. */
export function validatePdfBuffer(buffer: Buffer): void {
  if (buffer.length === 0) throw new DocumentValidationError("The file is empty.");
  if (buffer.length > MAX_DOCUMENT_BYTES) throw new DocumentValidationError("The file is larger than 10 MB.");
  if (buffer.subarray(0, PDF_MAGIC.length).toString("latin1") !== PDF_MAGIC) {
    throw new DocumentValidationError("The file is not a PDF.");
  }
}

/** Absolute path, guaranteed to live inside `DOCUMENTS_DIR`; throws otherwise (traversal guard). */
export function resolveInsideStore(filePath: string): string {
  const abs = path.resolve(filePath);
  if (abs !== DOCUMENTS_DIR && !abs.startsWith(DOCUMENTS_DIR + path.sep)) {
    throw new DocumentValidationError("Path is outside the document store.");
  }
  return abs;
}

/**
 * Persist an uploaded file. Returns the generated id and the absolute path
 * (store the path on `Document.filePath`). The client filename is never used.
 */
export async function saveDocumentFile(userId: string, buffer: Buffer, ext: "pdf"): Promise<{ id: string; filePath: string }> {
  if (!ALLOWED_EXT.has(ext)) throw new DocumentValidationError("Unsupported file type.");
  if (!/^[A-Za-z0-9_-]+$/.test(userId)) throw new DocumentValidationError("Invalid user id.");
  if (ext === "pdf") validatePdfBuffer(buffer);
  const id = randomUUID().replace(/-/g, "");
  const dir = path.join(DOCUMENTS_DIR, userId);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const filePath = resolveInsideStore(path.join(dir, `${id}.${ext}`));
  await fs.writeFile(filePath, buffer, { mode: 0o600, flag: "wx" });
  return { id, filePath };
}

/**
 * Defence in depth for reads: `resolveInsideStore` is lexical, so a symlink
 * planted in the store (or a symlinked parent) could still point outside it.
 * Refuse anything but a regular file whose real path is inside the store.
 */
async function assertRegularFileInStore(abs: string): Promise<void> {
  const st = await fs.lstat(abs);
  if (st.isSymbolicLink() || !st.isFile()) throw new DocumentValidationError("Path is not a regular file in the document store.");
  const [real, realRoot] = await Promise.all([fs.realpath(abs), fs.realpath(DOCUMENTS_DIR)]);
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new DocumentValidationError("Path is outside the document store.");
}

/** Whole file as a Buffer (store files are ≤ 10 MB). */
export async function readDocumentFile(filePath: string): Promise<Buffer> {
  const abs = resolveInsideStore(filePath);
  await assertRegularFileInStore(abs);
  return fs.readFile(abs);
}

/** Web `ReadableStream` over the stored file, for streaming responses. Throws when the file is missing. */
export async function openDocumentStream(filePath: string): Promise<{ stream: ReadableStream; size: number }> {
  const abs = resolveInsideStore(filePath);
  await assertRegularFileInStore(abs);
  const stat = await fs.stat(abs);
  const stream = Readable.toWeb(createReadStream(abs)) as unknown as ReadableStream;
  return { stream, size: stat.size };
}

/** Remove a stored file; a missing file is not an error (the row may already be gone). */
export async function deleteDocumentFile(filePath: string): Promise<void> {
  const abs = resolveInsideStore(filePath);
  try {
    await fs.unlink(abs);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}
