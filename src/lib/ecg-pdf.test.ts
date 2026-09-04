import { describe, expect, it } from "vitest";
import PDFDocument from "pdfkit";
import { extractEcgPdf } from "./ecg-pdf";
import { parseEcgReport } from "./ecg-parse-core";

/**
 * End-to-end over a real PDF — built here, never a real one. A Garmin ECG
 * export is personal health data and is not committed to this repo, so these
 * tests reproduce the report's SHAPE: values above their labels in the same
 * column, an identifying block on the right of the same rows, a footer of
 * versions, and three ten-second strips drawn as vector polylines.
 */

const WIDTH = 792;
const HEIGHT = 612;
const UNITS_PER_MM = 72 / 25.4;
const UNITS_PER_SEC = 25 * UNITS_PER_MM;
const UNITS_PER_MV = 10 * UNITS_PER_MM;

/** Left edge every strip starts from, and its width in PDF units. */
const STRIP_X0 = 33;
const STRIP_W = 10 * UNITS_PER_SEC;

async function build(draw: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  const doc = new PDFDocument({ size: [WIDTH, HEIGHT], margin: 0 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve) => doc.on("end", () => resolve()));
  draw(doc);
  doc.end();
  await done;
  return Buffer.concat(chunks);
}

/** One flat strip with a spike, drawn top-down the way pdfkit places things. */
function drawStrip(doc: PDFKit.PDFDocument, topDownY: number, spikeMv: number, spikeAt: number, points = 250): void {
  doc.save().lineWidth(0.4).strokeColor("#000");
  for (let i = 0; i < points; i++) {
    const x = STRIP_X0 + (i * STRIP_W) / (points - 1);
    // pdfkit's y grows downward, so a POSITIVE deflection is a smaller y here.
    const y = topDownY - (i === spikeAt ? spikeMv : 0) * UNITS_PER_MV;
    if (i === 0) doc.moveTo(x, y);
    else doc.lineTo(x, y);
  }
  doc.stroke().restore();
}

async function syntheticReport(): Promise<Buffer> {
  return build((doc) => {
    doc.font("Helvetica");

    // Title row — the subject's name sits far to the right of it.
    doc.fontSize(14).text("ECG Recording - Sinus Rhythm", 66, 22, { lineBreak: false });
    doc.fontSize(10).text("Jordan Fixtureson", 640, 24, { lineBreak: false });
    // Recording time row — date of birth, age and sex beside it.
    doc.fontSize(10).text("12 June 2024 @ 9:17 AM", 66, 40, { lineBreak: false });
    doc.fontSize(7).text("4 March 1979 (45 yr) - Female", 640, 42, { lineBreak: false });

    // Values, then the labels underneath them, in three columns.
    doc.fontSize(12);
    doc.text("Sinus Rhythm", 30, 78, { lineBreak: false });
    doc.text("61 bpm", 224, 78, { lineBreak: false });
    doc.text("--", 419, 78, { lineBreak: false });
    doc.fontSize(7);
    doc.text("Result", 30, 95, { lineBreak: false });
    doc.text("Average Heart Rate", 224, 95, { lineBreak: false });
    doc.text("Symptoms Reported", 419, 95, { lineBreak: false });

    doc.fontSize(12).text("This ECG recording does not show signs of AFib.", 30, 116, { lineBreak: false });
    doc.fontSize(7).text("Summary", 30, 133, { lineBreak: false });

    // Three strips, each with its own second axis under it.
    const stripTops = [250, 360, 470];
    stripTops.forEach((top, strip) => {
      drawStrip(doc, top, strip === 0 ? 1 : strip === 1 ? 0.5 : -0.25, strip === 0 ? 100 : strip === 1 ? 50 : 150);
      doc.fontSize(7);
      for (let s = 0; s < 10; s++) {
        doc.text(`${strip * 10 + s}s`, STRIP_X0 + 6 + (s * STRIP_W) / 10, top + 22, { lineBreak: false });
      }
    });

    doc.fontSize(8).text(
      "25mm/s, 10mm/mV, 512Hz, fenix 9 Pro - inReach, 43 mm SW 6.38, Garmin ECG App: 1.1.4, Garmin Connect Web 5.28.0.26a, PDF Template 1.2.114, Garmin Connect Backend 25.16.0.",
      30, 552, { lineBreak: false },
    );
    doc.fontSize(8).text("This waveform is similar to a Lead I ECG. For more information, see Instructions for Use.", 30, 566, { lineBreak: false });
    doc.fontSize(7).text("Report downloaded from Garmin Connect on 13 June 2024", 30, 585, { lineBreak: false });
    doc.fontSize(7).text("Recorded on fenix 9 Pro - inReach, 43 mm 6.38", 30, 596, { lineBreak: false });
  });
}

describe("extractEcgPdf", () => {
  it("lifts the text layer and the three waveform polylines out of a real PDF", async () => {
    const content = await extractEcgPdf(await syntheticReport());
    expect(content.items.length).toBeGreaterThan(30);
    expect(content.traces).toHaveLength(3);
    for (const t of content.traces) expect(t.length).toBe(250);
  }, 30_000);

  it("returns the trace in page space, where a positive deflection has the larger y", async () => {
    const content = await extractEcgPdf(await syntheticReport());
    const first = content.traces[0]!;
    const flat = first[0]!.y;
    const peak = Math.max(...first.map((p) => p.y));
    expect(peak - flat).toBeCloseTo(UNITS_PER_MV, 1); // the 1 mV spike, upward
  }, 30_000);

  it("reads a PDF with no text layer as no items rather than throwing", async () => {
    const buf = await build((doc) => { doc.rect(50, 50, 200, 100).stroke(); });
    const content = await extractEcgPdf(buf);
    expect(content.items).toHaveLength(0);
    expect(parseEcgReport(content).ok).toBe(false);
  }, 30_000);

  it("rejects bytes that are not a PDF instead of hanging", async () => {
    await expect(extractEcgPdf(Buffer.from("not a pdf at all\n"))).rejects.toBeDefined();
  }, 30_000);
});

describe("extractEcgPdf + parseEcgReport", () => {
  it("imports the whole report from the file, with nothing to type", async () => {
    const res = parseEcgReport(await extractEcgPdf(await syntheticReport()));
    expect(res.ok).toBe(true);
    const r = res.report!;
    expect(r.result).toBe("Sinus Rhythm");
    expect(r.avgHeartRateBpm).toBe(61);
    expect(r.symptoms).toBe("--");
    expect(r.interpretation).toBe("This ECG recording does not show signs of AFib.");
    expect(r.leadNote).toBe("This waveform is similar to a Lead I ECG.");
    expect(r.recordedAtLocal).toEqual({ year: 2024, month: 6, day: 12, hour: 9, minute: 17 });
    expect(r.durationSec).toBe(30);
    expect(r.paperSpeedMmS).toBe(25);
    expect(r.gainMmMv).toBe(10);
    expect(r.sampleRateHz).toBe(512);
    expect(r.pdfTemplateVersion).toBe("1.2.114");
    expect(r.deviceModel).toBe("fenix 9 Pro - inReach, 43 mm");
    expect(r.deviceSoftware).toBe("6.38");
  }, 30_000);

  it("recovers the drawn trace: three strips, ten seconds apart, at the amplitudes drawn", async () => {
    const w = parseEcgReport(await extractEcgPdf(await syntheticReport())).report!.waveform!;
    expect(w.strips.map((s) => s.t0Ms)).toEqual([0, 10000, 20000]);
    expect(w.durationMs).toBe(30000);
    expect(w.strips[0]!.uv[100]).toBeCloseTo(1000, -1);
    expect(w.strips[1]!.uv[50]).toBeCloseTo(500, -1);
    expect(w.strips[2]!.uv[150]).toBeCloseTo(-250, -1);
  }, 30_000);

  it("keeps the identifying block out of the record even when it is on the page", async () => {
    const res = parseEcgReport(await extractEcgPdf(await syntheticReport()));
    const { waveform: _drop, ...fields } = res.report!;
    const printed = JSON.stringify(fields);
    for (const pii of ["Jordan", "Fixtureson", "1979", "Female"]) expect(printed).not.toContain(pii);
  }, 30_000);
});
