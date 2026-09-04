import { describe, expect, it } from "vitest";
import { buildWaveform, localTimeKey, parseEcgReport, parseRecordedAt, symptomsLabel, type PdfPoint, type PdfTextItem } from "./ecg-parse-core";

/**
 * Every fixture here is SYNTHETIC. A real Garmin ECG export is personal health
 * data and is never committed; what is reproduced is the report's LAYOUT —
 * column positions, row spacing and wording — because the layout is what the
 * parser reads. The subject in these fixtures does not exist.
 */

const UNITS_PER_MM = 72 / 25.4;
const UNITS_PER_SEC = 25 * UNITS_PER_MM;
const UNITS_PER_MV = 10 * UNITS_PER_MM;

/** One text item, sized the way a PDF viewer would size it. */
function item(str: string, x: number, y: number, height = 10): PdfTextItem {
  return { str, x, y, width: str.length * height * 0.5, height };
}

/** Consecutive items that belong to ONE cell — laid out with word-sized gaps. */
function words(strs: string[], x: number, y: number, height = 10): PdfTextItem[] {
  const out: PdfTextItem[] = [];
  let cursor = x;
  for (const s of strs) {
    const it = item(s, cursor, y, height);
    out.push(it);
    cursor = it.x + it.width + 2; // a word space, far below the column threshold
  }
  return out;
}

interface LayoutOverrides {
  result?: string;
  heartRate?: string;
  symptoms?: string;
  /** Symptoms printed over two lines, the way a long list wraps. */
  symptomsWrapped?: [string, string];
  recordedAt?: string;
  summary?: string;
  /** Summary printed over two lines, the way Garmin's longer findings wrap. */
  summaryWrapped?: [string, string];
  meta?: string;
  lead?: string;
  recordedOn?: string;
  omit?: ("summary" | "meta" | "lead" | "recordedOn" | "axis" | "symptomsLabel")[];
}

/**
 * The Garmin ECG page as the extractor sees it: values sit ABOVE their labels
 * in the same column, and the identifying block sits far to the right on the
 * SAME rows as the title and the recording time.
 */
function layout(o: LayoutOverrides = {}): PdfTextItem[] {
  const omit = new Set(o.omit ?? []);
  const items: PdfTextItem[] = [];

  // Value row, then its label row — the order the real export emits them in.
  items.push(...words((o.result ?? "Sinus Rhythm").split(" "), 30, 526.2, 12));
  items.push(item("Result", 30, 515.2, 7));
  items.push(...words((o.heartRate ?? "61 bpm").split(" "), 224.4, 526.2, 12));
  items.push(...words(["Average", "Heart", "Rate"], 224.4, 515.2, 7));
  if (o.symptomsWrapped) {
    // The upper line sits one line-height above the lower one, same column.
    items.push(...words(o.symptomsWrapped[0].split(" "), 418.8, 540.2, 12));
    items.push(...words(o.symptomsWrapped[1].split(" "), 418.8, 526.2, 12));
  } else {
    items.push(...words((o.symptoms ?? "--").split(" "), 418.8, 526.2, 12));
  }
  if (!omit.has("symptomsLabel")) items.push(...words(["Symptoms", "Reported"], 418.8, 515.2, 7));

  if (!omit.has("summary")) {
    if (o.summaryWrapped) {
      items.push(...words(o.summaryWrapped[0].split(" "), 30, 499.3, 12));
      items.push(...words(o.summaryWrapped[1].split(" "), 30, 485.3, 12));
    } else {
      items.push(...words((o.summary ?? "This ECG recording does not show signs of AFib.").split(" "), 30, 485.3, 12));
    }
    items.push(item("Summary", 30, 474.3, 7));
  }

  if (!omit.has("axis")) {
    for (let strip = 0; strip < 3; strip++) {
      const y = [364.3, 253.8, 143.3][strip]!;
      for (let s = 0; s < 10; s++) items.push(item(`${strip * 10 + s}s`, 39.4 + s * 70.8, y, 7));
    }
  }

  if (!omit.has("meta")) {
    items.push(
      ...words(
        (o.meta ??
          "25mm/s, 10mm/mV, 512Hz, fenix 9 Pro - inReach, 43 mm SW 6.38, Garmin ECG App: 1.1.4, Garmin Connect Web 5.28.0.26a, PDF Template 1.2.114, Garmin Connect Backend 25.16.0.")
          .split(" "),
        30,
        126.2,
        8,
      ),
    );
  }
  if (!omit.has("lead")) {
    items.push(...words((o.lead ?? "This waveform is similar to a Lead I ECG. For more information, see Instructions for Use.").split(" "), 30, 115.3, 8));
  }

  // Title row — the subject's NAME shares this row, far to the right.
  items.push(...words(["ECG", "Recording", "-", ...(o.result ?? "Sinus Rhythm").split(" ")], 66, 577, 14));
  items.push(...words(["Jordan", "Fixtureson"], 694.4, 575.3, 10));

  // Recording time — the date of birth, age and sex sit on the row beside it.
  items.push(...words((o.recordedAt ?? "12 June 2024 @ 9:17 AM").split(" "), 66, 562.7, 10.5));
  items.push(...words(["4", "March", "1979", "(45", "yr)", "•", "Female"], 656, 564.9, 7));

  items.push(...words(["Report", "downloaded", "from", "Garmin", "Connect", "on", "13", "June", "2024"], 30, 32.5, 7));
  if (!omit.has("recordedOn")) {
    items.push(...words((o.recordedOn ?? "Recorded on fenix 9 Pro - inReach, 43 mm 6.38").split(" "), 30, 23, 7));
  }
  return items;
}

/**
 * One synthetic strip: a flat baseline with a single spike of a known height,
 * drawn at a known place on the page. `holeAt` drops a run of samples, the way
 * the real export does when it lifts the pen.
 */
function strip(opts: {
  pageY: number;
  points?: number;
  spikeAtIndex?: number;
  spikeMv?: number;
  startX?: number;
  holeAt?: [number, number];
}): PdfPoint[] {
  const n = opts.points ?? 201;
  const startX = opts.startX ?? 33;
  const step = (10 * UNITS_PER_SEC) / (n - 1); // exactly ten seconds wide
  const pts: PdfPoint[] = [];
  for (let i = 0; i < n; i++) {
    if (opts.holeAt && i >= opts.holeAt[0] && i <= opts.holeAt[1]) continue;
    const mv = i === opts.spikeAtIndex ? (opts.spikeMv ?? 1) : 0;
    pts.push({ x: startX + i * step, y: opts.pageY + mv * UNITS_PER_MV });
  }
  return pts;
}

const THREE_STRIPS = [
  strip({ pageY: 402, spikeAtIndex: 100, spikeMv: 1 }),
  strip({ pageY: 292, spikeAtIndex: 50, spikeMv: 0.5 }),
  strip({ pageY: 181, spikeAtIndex: 150, spikeMv: -0.25 }),
];

describe("parseRecordedAt", () => {
  it("reads the printed recording time", () => {
    expect(parseRecordedAt("12 June 2024 @ 9:17 AM")).toEqual({ year: 2024, month: 6, day: 12, hour: 9, minute: 17 });
  });

  it("maps midnight and noon the way a 12-hour clock means them", () => {
    expect(parseRecordedAt("1 January 2026 @ 12:00 AM")?.hour).toBe(0);
    expect(parseRecordedAt("1 January 2026 @ 12:30 PM")?.hour).toBe(12);
    expect(parseRecordedAt("1 January 2026 @ 11:59 PM")?.hour).toBe(23);
  });

  it("accepts a 24-hour export with no meridiem", () => {
    expect(parseRecordedAt("12 June 2024 @ 09:17")).toEqual({ year: 2024, month: 6, day: 12, hour: 9, minute: 17 });
  });

  it("rejects a date with no time — a date of birth and a download date are not recording times", () => {
    expect(parseRecordedAt("4 March 1979")).toBeNull();
    expect(parseRecordedAt("4 March 1979 (45 yr) • Female")).toBeNull();
    expect(parseRecordedAt("Report downloaded from Garmin Connect on 13 June 2024")).toBeNull();
  });

  it("rejects a month that is not a month, and an impossible clock", () => {
    expect(parseRecordedAt("12 Junio 2024 @ 9:17 AM")).toBeNull();
    expect(parseRecordedAt("12 June 2024 @ 25:17 AM")).toBeNull();
    expect(parseRecordedAt("12 June 2024 @ 9:75 AM")).toBeNull();
  });
});

describe("parseEcgReport", () => {
  it("reads every printed field off a well-formed report", () => {
    const res = parseEcgReport({ items: layout(), traces: THREE_STRIPS });
    expect(res.ok).toBe(true);
    expect(res.missing).toEqual([]);
    expect(res.confidence).toBe(1);
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
    expect(r.deviceModel).toBe("fenix 9 Pro - inReach, 43 mm");
    expect(r.deviceSoftware).toBe("6.38");
    expect(r.ecgAppVersion).toBe("1.1.4");
    expect(r.connectWebVersion).toBe("5.28.0.26a");
    expect(r.pdfTemplateVersion).toBe("1.2.114");
    expect(r.backendVersion).toBe("25.16.0");
  });

  it("never lets the name, date of birth, age or sex out — they share rows with fields it does read", () => {
    const items = layout();
    const PII = ["Jordan", "Fixtureson", "1979", "Female"];
    // The fixture must actually carry the identifying block, or this asserts nothing.
    const onPage = items.map((i) => i.str).join(" ");
    for (const pii of PII) expect(onPage).toContain(pii);

    const res = parseEcgReport({ items, traces: THREE_STRIPS });
    const { waveform: _drop, ...fields } = res.report!;
    const printed = JSON.stringify(fields);
    for (const pii of PII) expect(printed).not.toContain(pii);
    expect(printed).not.toContain("45 yr");
  });

  it("takes the recording time from the document, never the download date", () => {
    const res = parseEcgReport({ items: layout(), traces: [] });
    // The page's other date is 13 June 2024 (when the PDF was downloaded).
    expect(res.report!.recordedAtLocal.day).toBe(12);
    expect(res.report!.recordedAtRaw).toBe("12 June 2024 @ 9:17 AM");
  });

  it("keeps the symptoms cell verbatim, printed \"--\" included", () => {
    // "--" is kept rather than folded to null: null has to keep meaning "the
    // column was never read", which is a different statement from "none".
    expect(parseEcgReport({ items: layout(), traces: [] }).report!.symptoms).toBe("--");
    const withSymptoms = parseEcgReport({ items: layout({ symptoms: "Rapid heartbeat" }), traces: [] });
    expect(withSymptoms.report!.symptoms).toBe("Rapid heartbeat");
    const unread = parseEcgReport({ items: layout({ omit: ["symptomsLabel"] }), traces: [] });
    expect(unread.report!.symptoms).toBeNull();
  });

  it("prints Garmin's finding verbatim, whatever it says", () => {
    const res = parseEcgReport({
      items: layout({ result: "Atrial Fibrillation", summary: "This ECG recording shows signs of AFib." }),
      traces: [],
    });
    expect(res.report!.result).toBe("Atrial Fibrillation");
    expect(res.report!.interpretation).toBe("This ECG recording shows signs of AFib.");
  });

  it("reads a value only from under its own label, so a column it cannot find is missing rather than guessed", () => {
    const res = parseEcgReport({ items: layout({ omit: ["symptomsLabel"] }), traces: THREE_STRIPS });
    expect(res.ok).toBe(true);
    expect(res.report!.symptoms).toBeNull();
    expect(res.missing).toContain("symptoms reported");
  });

  it("still imports when only the version lines are missing, and says what was not found", () => {
    const res = parseEcgReport({ items: layout({ omit: ["meta", "lead", "recordedOn"] }), traces: THREE_STRIPS });
    expect(res.ok).toBe(true);
    expect(res.report!.result).toBe("Sinus Rhythm");
    expect(res.missing).toEqual(expect.arrayContaining(["recording scale", "device", "PDF template version", "lead note"]));
    expect(res.confidence).toBeLessThan(1);
    // With no printed scale the trace still builds, at the ECG standard.
    expect(res.report!.waveform).not.toBeNull();
  });

  it("fails when the result is missing — a recording with no finding is not a report", () => {
    const noResultLabel = layout().filter((i) => i.str !== "Result");
    const res = parseEcgReport({ items: noResultLabel, traces: THREE_STRIPS });
    expect(res.ok).toBe(false);
    expect(res.report).toBeNull();
    expect(res.missing).toContain("result");
  });

  it("fails when the recording time is missing", () => {
    const res = parseEcgReport({ items: layout({ recordedAt: "sometime last week" }), traces: THREE_STRIPS });
    expect(res.ok).toBe(false);
    expect(res.missing).toContain("recording date and time");
  });

  it("says the PDF has no text layer rather than listing twenty missing fields", () => {
    const res = parseEcgReport({ items: [], traces: [] });
    expect(res.ok).toBe(false);
    expect(res.missing).toHaveLength(1);
    expect(res.missing[0]).toMatch(/text layer/);
  });

  it("takes the recording length from the printed axis, and falls back to the trace without one", () => {
    expect(parseEcgReport({ items: layout(), traces: THREE_STRIPS }).report!.durationSec).toBe(30);
    const noAxis = parseEcgReport({ items: layout({ omit: ["axis"] }), traces: THREE_STRIPS });
    expect(noAxis.report!.durationSec).toBe(30);
  });

  it("reads the device from the scale line when the footer line is absent", () => {
    const res = parseEcgReport({ items: layout({ omit: ["recordedOn"] }), traces: [] });
    expect(res.report!.deviceModel).toBe("fenix 9 Pro - inReach, 43 mm");
    expect(res.report!.deviceSoftware).toBe("6.38");
  });
});

describe("buildWaveform", () => {
  it("gives each printed strip its own time offset, in the order they were recorded", () => {
    const w = buildWaveform(THREE_STRIPS, 25, 10)!;
    expect(w.strips.map((s) => s.t0Ms)).toEqual([0, 10000, 20000]);
    expect(w.durationMs).toBe(30000);
    expect(w.points).toBe(603);
  });

  it("orders strips down the page, not by the order the PDF happened to draw them", () => {
    const shuffled = [THREE_STRIPS[1]!, THREE_STRIPS[2]!, THREE_STRIPS[0]!];
    const w = buildWaveform(shuffled, 25, 10)!;
    // Strip 0 carries a 1 mV spike, strip 1 half of one, strip 2 a downward quarter.
    expect(w.strips[0]!.uv[100]).toBe(1000);
    expect(w.strips[1]!.uv[50]).toBe(500);
    expect(w.strips[2]!.uv[150]).toBe(-250);
  });

  it("measures each strip against ITS OWN baseline — the three sit at different heights on the page", () => {
    const w = buildWaveform(THREE_STRIPS, 25, 10)!;
    for (const s of w.strips) {
      const flat = s.uv.filter((v, i) => v != null && i !== 100 && i !== 50 && i !== 150);
      expect(flat.every((v) => v === 0)).toBe(true);
    }
  });

  it("converts millimetres to millivolts at the gain the report states", () => {
    // The same geometry read at 20 mm/mV is half the voltage.
    const w = buildWaveform([THREE_STRIPS[0]!], 25, 20)!;
    expect(w.strips[0]!.uv[100]).toBe(500);
  });

  it("puts samples on the grid the export drew them at", () => {
    const w = buildWaveform(THREE_STRIPS, 25, 10)!;
    expect(w.strips[0]!.dtMs).toBeCloseTo(50, 3); // 201 points across ten seconds
    expect(w.drawnHz).toBe(20);
  });

  it("keeps a stretch the report did not draw as a hole, not a straight line across it", () => {
    const w = buildWaveform([strip({ pageY: 402, spikeAtIndex: 100, holeAt: [40, 49] })], 25, 10)!;
    const s = w.strips[0]!;
    expect(s.uv.length).toBe(201);
    expect(s.uv.slice(40, 50).every((v) => v === null)).toBe(true);
    expect(s.uv[39]).toBe(0);
    expect(s.uv[50]).toBe(0);
    expect(w.points).toBe(191);
  });

  it("keeps a late-starting strip late — the shared page margin is time zero", () => {
    const late = strip({ pageY: 402, startX: 33 + UNITS_PER_SEC / 2 });
    const w = buildWaveform([late, strip({ pageY: 292 })], 25, 10)!;
    expect(w.strips[0]!.t0Ms).toBe(500);
    expect(w.strips[1]!.t0Ms).toBe(10000);
  });

  it("has nothing to draw when the report carried no trace", () => {
    expect(buildWaveform([], 25, 10)).toBeNull();
    expect(buildWaveform([[{ x: 1, y: 1 }]], 25, 10)).toBeNull();
  });

  it("refuses a nonsensical scale rather than inventing a signal", () => {
    expect(buildWaveform(THREE_STRIPS, 0, 10)).toBeNull();
    expect(buildWaveform(THREE_STRIPS, 25, 0)).toBeNull();
  });
});

describe("wrapped values and bounded lookup", () => {
  it("reads a summary printed over two lines WHOLE — the finding is on the first line", () => {
    const res = parseEcgReport({
      items: layout({
        summaryWrapped: [
          "This ECG recording shows signs of atrial fibrillation (AFib), an",
          "irregular heart rhythm. Talk to your doctor.",
        ],
      }),
      traces: THREE_STRIPS,
    });
    expect(res.report!.interpretation).toBe(
      "This ECG recording shows signs of atrial fibrillation (AFib), an irregular heart rhythm. Talk to your doctor.",
    );
  });

  it("reads a wrapped symptoms list whole", () => {
    const res = parseEcgReport({ items: layout({ symptomsWrapped: ["Rapid heartbeat,", "Shortness of breath"] }), traces: [] });
    expect(res.report!.symptoms).toBe("Rapid heartbeat, Shortness of breath");
  });

  it("does not climb out of its own block: the summary never swallows the Result heading above it", () => {
    const res = parseEcgReport({ items: layout(), traces: THREE_STRIPS });
    expect(res.report!.interpretation).toBe("This ECG recording does not show signs of AFib.");
    expect(res.report!.interpretation).not.toMatch(/Result/);
  });

  it("reports a value as missing rather than adopting whatever is far above it", () => {
    // The Summary VALUE row is removed but its heading stays: the next thing up
    // the page is a different block, and taking it would invent a finding.
    const items = layout().filter((i) => !/^(This|ECG|recording|does|not|show|signs|of|AFib\.)$/.test(i.str) || i.y !== 485.3);
    const res = parseEcgReport({ items, traces: THREE_STRIPS });
    expect(res.report!.interpretation).toBeNull();
    expect(res.missing).toContain("summary");
  });
});

describe("symptomsLabel", () => {
  it("separates 'the report said none' from 'the column was not read'", () => {
    expect(symptomsLabel("--")).toEqual({ text: "None reported", reported: false });
    expect(symptomsLabel(null)).toEqual({ text: "—", reported: false });
    expect(symptomsLabel("")).toEqual({ text: "—", reported: false });
    expect(symptomsLabel("Rapid heartbeat")).toEqual({ text: "Rapid heartbeat", reported: true });
  });
});

describe("localTimeKey", () => {
  it("is the printed wall clock, zero-padded and sortable", () => {
    expect(localTimeKey({ year: 2024, month: 6, day: 12, hour: 9, minute: 17 })).toBe("2024-06-12T09:17");
    expect(localTimeKey({ year: 2024, month: 11, day: 3, hour: 23, minute: 5 })).toBe("2024-11-03T23:05");
  });

  it("sorts in recording order as a plain string", () => {
    const keys = [
      localTimeKey({ year: 2024, month: 6, day: 12, hour: 9, minute: 17 }),
      localTimeKey({ year: 2024, month: 6, day: 2, hour: 22, minute: 0 }),
      localTimeKey({ year: 2023, month: 12, day: 31, hour: 23, minute: 59 }),
    ];
    expect([...keys].sort()).toEqual([keys[2], keys[1], keys[0]]);
  });
});

describe("buildWaveform reporting", () => {
  it("counts a strip it refused to read rather than dropping it in silence", () => {
    // A path whose x steps are wildly uneven cannot be put on a uniform grid.
    const ragged = [0, 1, 40, 41, 200, 900, 901, 902].map((x) => ({ x: 33 + x, y: 402 }));
    const w = buildWaveform([THREE_STRIPS[0]!, ragged], 25, 10)!;
    expect(w.strips).toHaveLength(1);
    expect(w.droppedStrips).toBe(1);
  });

  it("reports a dropped strip up through the parse, so a partial trace is never silent", () => {
    const ragged = [0, 1, 40, 41, 200, 900, 901, 902].map((x) => ({ x: 33 + x, y: 402 }));
    const res = parseEcgReport({ items: layout(), traces: [...THREE_STRIPS, ragged] });
    expect(res.report!.waveform!.droppedStrips).toBe(1);
    expect(res.missing.some((m) => /strips of the trace/.test(m))).toBe(true);
    expect(res.confidence).toBeLessThan(1);
  });

  it("says nothing was dropped when nothing was", () => {
    expect(buildWaveform(THREE_STRIPS, 25, 10)!.droppedStrips).toBe(0);
  });
});

describe("leadNote", () => {
  it("takes the lead sentence from the match, not from the start of whatever it was merged with", () => {
    const res = parseEcgReport({
      items: layout({ lead: "Some earlier sentence. This waveform is similar to a Lead I ECG. For more information, see Instructions for Use." }),
      traces: [],
    });
    expect(res.report!.leadNote).toBe("This waveform is similar to a Lead I ECG.");
  });
});
