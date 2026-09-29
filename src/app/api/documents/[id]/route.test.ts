import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  findFirst: vi.fn(),
  currentUser: vi.fn(),
  openDocumentStream: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: { document: { findFirst: m.findFirst } } }));
vi.mock("@/lib/auth/owner", () => ({ getCurrentUser: m.currentUser }));
vi.mock("@/lib/documents", () => ({ openDocumentStream: m.openDocumentStream }));

import { GET } from "./route";

const call = (id: string) => GET(new Request(`http://localhost/api/documents/${id}`) as never, { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  m.currentUser.mockResolvedValue({ id: "owner" });
  m.openDocumentStream.mockResolvedValue({ stream: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("%PDF-1.4")); c.close(); } }), size: 8 });
});

describe("GET /api/documents/[id]", () => {
  it("401 without a session, before any lookup", async () => {
    m.currentUser.mockResolvedValueOnce(null);
    const res = await call("doc1");
    expect(res.status).toBe(401);
    expect(m.findFirst).not.toHaveBeenCalled();
  });

  it("looks the row up by { id, userId } — a second user's session gets 404, never the file", async () => {
    m.currentUser.mockResolvedValueOnce({ id: "someone-else" });
    m.findFirst.mockResolvedValueOnce(null); // the ownership-scoped query finds nothing for the other user
    const res = await call("doc1");
    expect(res.status).toBe(404);
    expect(m.findFirst.mock.calls[0][0].where).toEqual({ id: "doc1", userId: "someone-else" });
    expect(m.openDocumentStream).not.toHaveBeenCalled();
  });

  it("streams the owner's PDF inline, private and uncached", async () => {
    m.findFirst.mockResolvedValueOnce({ id: "doc1", userId: "owner", kind: "dexa_report", filePath: "/store/owner/doc1.pdf", mime: "application/pdf" });
    const res = await call("doc1");
    expect(res.status).toBe(200);
    expect(m.findFirst.mock.calls[0][0].where).toEqual({ id: "doc1", userId: "owner" });
    expect(m.openDocumentStream).toHaveBeenCalledWith("/store/owner/doc1.pdf");
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe('inline; filename="dexa-report.pdf"');
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-length")).toBe("8");
    expect(await res.text()).toBe("%PDF-1.4");
  });

  it("always serves application/pdf — a row whose mime says text/html cannot make the store serve HTML on the app origin", async () => {
    m.findFirst.mockResolvedValueOnce({ id: "doc1", userId: "owner", filePath: "/store/owner/doc1.pdf", mime: "text/html" });
    const res = await call("doc1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("404 when the row exists but the file is gone or outside the store", async () => {
    m.findFirst.mockResolvedValueOnce({ id: "doc1", userId: "owner", filePath: "/store/owner/doc1.pdf", mime: null });
    m.openDocumentStream.mockRejectedValueOnce(new Error("ENOENT"));
    const res = await call("doc1");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/documents/[id] — download filename", () => {
  it("names the file after the row's kind, so an ECG report is not offered as a DEXA one", async () => {
    m.findFirst.mockResolvedValueOnce({ id: "doc9", userId: "owner", kind: "ecg_report", filePath: "/store/owner/doc9.pdf", mime: "application/pdf" });
    const res = await call("doc9");
    expect(res.headers.get("content-disposition")).toBe('inline; filename="ecg-report.pdf"');
  });

  it("falls back to a fixed name for a kind that is not a plain slug — nothing reaches the header unchecked", async () => {
    m.findFirst.mockResolvedValueOnce({ id: "doc9", userId: "owner", kind: 'x"; attachment; filename="evil', filePath: "/store/owner/doc9.pdf", mime: "application/pdf" });
    const res = await call("doc9");
    expect(res.headers.get("content-disposition")).toBe('inline; filename="report.pdf"');
  });
});
