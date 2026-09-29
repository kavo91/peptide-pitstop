import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/owner";
import { openDocumentStream } from "@/lib/documents";

/**
 * GET /api/documents/{id}
 *
 * Streams a stored report PDF to its owner. Session cookie → 401 when absent;
 * the row is looked up by `{ id, userId }` so another user's id is a 404, never
 * a leak. Served inline with a filename derived from the row's `kind` (the
 * client filename was never kept) and `private, no-store` — health data must
 * not land in a shared cache.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const doc = await prisma.document.findFirst({ where: { id, userId: user.id } });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let opened: { stream: ReadableStream; size: number };
  try {
    opened = await openDocumentStream(doc.filePath);
  } catch (e) {
    console.error("GET /api/documents: file missing or outside the store", e);
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Derived from the kind, never from anything a client supplied: the value goes
  // into a response header, and the store's own `kind` values are the only inputs.
  const kind = typeof doc.kind === "string" ? doc.kind : "";
  const filename = /^[a-z_]{1,40}$/.test(kind) ? `${kind.replace(/_/g, "-")}.pdf` : "report.pdf";

  return new NextResponse(opened.stream, {
    status: 200,
    headers: {
      // The store only ever holds validated PDFs — never trust a row's `mime` for the header.
      "Content-Type": "application/pdf",
      "Content-Length": String(opened.size),
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
