import { describe, expect, it } from "vitest";
import PDFDocument from "pdfkit";
import { extractPdfText } from "./pdf-text";

async function build(draw: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve) => doc.on("end", () => resolve()));
  draw(doc);
  doc.end();
  await done;
  return Buffer.concat(chunks);
}

describe("extractPdfText (pdf.js legacy build, in-process)", () => {
  it("returns rows top→bottom with a blank line between pages", async () => {
    const buf = await build((doc) => {
      doc.font("Helvetica").fontSize(10);
      doc.text("First page", 40, 40, { lineBreak: false });
      ["L Arm", "200.00", "1000.0"].forEach((s, i) => doc.text(s, 40 + i * 70, 60, { lineBreak: false }));
      doc.addPage();
      doc.text("Second page", 40, 40, { lineBreak: false });
    });
    expect(await extractPdfText(buf)).toBe("First page\nL Arm 200.00 1000.0\n\nSecond page");
  });

  it("returns an empty string for a PDF without a text layer (vector only)", async () => {
    const buf = await build((doc) => { doc.rect(50, 50, 200, 100).stroke(); doc.addPage(); doc.circle(100, 100, 40).fill("#888"); });
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    await expect(extractPdfText(buf)).resolves.toBe("");
  });

  it("rejects (does not hang) on bytes that are not a PDF", async () => {
    await expect(extractPdfText(Buffer.from("This is plain text pretending to be a PDF.\n"))).rejects.toBeDefined();
  });

  it("stays correct when many extractions of the same bytes run concurrently", async () => {
    const buf = await build((doc) => { doc.font("Helvetica").fontSize(10); doc.text("Sex: Male", 40, 40, { lineBreak: false }); });
    const out = await Promise.all(Array.from({ length: 12 }, () => extractPdfText(Buffer.from(buf))));
    expect(out.every((t) => t === "Sex: Male")).toBe(true);
  }, 30_000);
});
