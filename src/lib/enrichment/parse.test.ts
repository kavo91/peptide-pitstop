import { describe, it, expect } from "vitest";
import {
  parsePeptidePage,
  parseDose,
  stripHtml,
  decodeEntities,
  extractBenefitsAndSideEffects,
  extractTemplates,
  extractReferences,
  extractReconstitutionRatio,
  isBlendOrStack,
} from "./parse";

// ── Fixtures ─────────────────────────────────────────────────────────────────
// Two layouts the real site uses (verified June 2026): a GLP-1 page with
// Benefits/Side-Effects h3 split + two titration tables (Retatrutide-style), and
// a healing-peptide page with a single mixed "observations" list (BPC-157-style).

const RETA_LIKE = `
<html><head><title>Retatrutide Dosage Chart – 20 mg Vial Protocol | PeptideDosages.com</title></head>
<body>
<h1>Retatrutide (20 mg Vial) Dosage Protocol</h1>
<h2>Retatrutide Dosage Chart</h2>
<div class="dch-top"><div class="dch-text">
<p class="dch-lead">Retatrutide is dosed at 2&#8211;8 mg weekly by subcutaneous injection in educational protocols.</p>
</div></div>
<h2>Standard / Gradual Approach (2 mL = ~10.0 mg/mL)</h2>
<table><tr><th>Phase</th><th>Weekly Dose</th><th>Units</th></tr>
<tr><td>Weeks 1&#8211;4</td><td>2 mg (2000 mcg)</td><td>20 units</td></tr>
<tr><td>Weeks 13+</td><td>8 mg (8000 mcg)</td><td>80 units</td></tr></table>
<h3>Reconstitution Steps</h3>
<ol><li>Draw 2.0 mL bacteriostatic water.</li><li>Swirl gently; do not shake.</li></ol>
<h2>Advanced / Aggressive Protocol (2 mL = ~10.0 mg/mL)</h2>
<table><tr><th>Phase</th><th>Weekly Dose</th></tr>
<tr><td>Weeks 1&#8211;4</td><td>2 mg</td></tr>
<tr><td>Weeks 13+</td><td>12 mg (12000 mcg)</td></tr></table>
<h2>How This Works</h2>
<p>Retatrutide&#8217;s triple-agonist design activates GLP-1, GIP and glucagon receptors<sup><a href="#ref-7">[7]</a></sup>.</p>
<p>This raises metabolic rate and suppresses appetite.</p>
<h2>Clinical Benefits &amp; Side Effects</h2>
<h3>Benefits</h3>
<ul><li>Exceptional weight loss at 48 weeks<sup><a href="#ref-3">[3]</a></sup>.</li>
<li>Glycemic control improvements.</li></ul>
<h3>Side Effects</h3>
<ul><li>Nausea and vomiting during escalation<sup><a href="#ref-6">[6]</a></sup>.</li>
<li>No severe hypoglycemia reported.</li></ul>
<h2>References</h2>
<ol><li>The Lancet (2023) — Phase 2 trial. <a href="https://pubmed.ncbi.nlm.nih.gov/37385280/">View Source</a></li>
<li>Internal note only <a href="#ref-2">[2]</a></li></ol>
<footer>site footer</footer>
</body></html>`;

const BPC_LIKE = `
<html><head><title>BPC-157 Dosage Chart – 5 mg Vial Protocol | PeptideDosages.com</title></head>
<body>
<h1>BPC-157 (5 mg Vial) Dosage Protocol</h1>
<h2>BPC-157 Dosage Chart</h2>
<div class="dch-top"><div class="dch-text">
<p class="dch-lead">BPC-157 is dosed at 200 mcg&#8211;600 mcg daily via subcutaneous injection.</p>
</div></div>
<h2><i class="fas fa-syringe"></i> Standard / Gradual Approach (3 mL = ~1.67 mg/mL)</h2>
<table><tr><th>Week</th><th>Daily Dose (mcg)</th></tr>
<tr><td>Weeks 1&#8211;2</td><td>200 mcg (0.2 mg)</td></tr>
<tr><td>Weeks 5&#8211;8+</td><td>600 mcg (0.6 mg)</td></tr></table>
<h2>Potential Benefits &amp; Side Effects</h2>
<p>Observations from preclinical literature.</p>
<ul><li>Supports tissue repair in injury models (animal data).</li>
<li>Anti-inflammatory properties in preclinical settings.</li>
<li>Occasional mild injection-site reactions may occur.</li>
<li>Long-term human safety remains under investigation.</li></ul>
<h2>References</h2>
<ol><li>J Tissue Repair (2019). <a href="https://pubmed.ncbi.nlm.nih.gov/12345678/">View Source</a></li></ol>
</body></html>`;

describe("text helpers", () => {
  it("stripHtml drops sup ref markers, tags, and decodes entities", () => {
    expect(stripHtml("<p>Dose 8&#8211;12 mg<sup><a href='#r'>[7]</a></sup> daily</p>")).toBe("Dose 8–12 mg daily");
  });

  it("decodeEntities handles named, decimal, and hex entities", () => {
    expect(decodeEntities("a &amp; b &#8217;c&#x2019;d")).toBe("a & b ’c’d");
  });
});

describe("parseDose", () => {
  it("takes the first number+unit pair", () => {
    expect(parseDose("8 mg (8000 mcg)")).toEqual({ value: 8, unit: "mg" });
    expect(parseDose("600 mcg (0.6 mg)")).toEqual({ value: 600, unit: "mcg" });
  });
  it("normalises µg/ug to mcg and iu", () => {
    expect(parseDose("250 ug")).toEqual({ value: 250, unit: "mcg" });
    expect(parseDose("5000 IU vial")).toEqual({ value: 5000, unit: "iu" });
  });
  it("returns null when no dose present", () => {
    expect(parseDose("1 vial per dose")).toBeNull();
  });
});

describe("benefits & side-effects extraction", () => {
  it("uses h3 Benefits/Side Effects split when present", () => {
    const { benefits, sideEffects } = extractBenefitsAndSideEffects(RETA_LIKE);
    expect(benefits).toHaveLength(2);
    expect(benefits[0]).toMatch(/weight loss/i);
    expect(sideEffects).toHaveLength(2);
    expect(sideEffects[0]).toMatch(/nausea/i);
  });

  it("routes safety caveats to sideEffects when a single mixed list has no split", () => {
    const { benefits, sideEffects } = extractBenefitsAndSideEffects(BPC_LIKE);
    expect(benefits.length).toBeGreaterThan(0);
    expect(sideEffects.length).toBeGreaterThan(0);
    expect(sideEffects.some((s) => /injection-site|under investigation/i.test(s))).toBe(true);
    // a clear benefit stays in benefits
    expect(benefits.some((b) => /tissue repair/i.test(b))).toBe(true);
  });
});

describe("template extraction (titration ramps)", () => {
  it("extracts both standard and aggressive templates with ramps and headline dose", () => {
    const templates = extractTemplates(RETA_LIKE);
    expect(templates).toHaveLength(2);

    const standard = templates[0];
    expect(standard.name).toBe("Standard / Gradual Approach");
    expect(standard.doseBasis).toBe("per_week");
    expect(standard.frequency).toMatch(/weekly/i);
    expect(standard.targetDose).toBe(8); // last/maintenance phase
    expect(standard.unit).toBe("mg");
    expect(standard.ramp).toBeTruthy();
    expect(standard.ramp?.[0].phase).toMatch(/Weeks 1/);
    expect(standard.ramp?.[0].dose).toBe(2);

    expect(templates[1].name).toBe("Advanced / Aggressive Protocol");
    expect(templates[1].targetDose).toBe(12);
  });

  it("infers per_injection + daily frequency for daily-dosed peptides", () => {
    const templates = extractTemplates(BPC_LIKE);
    expect(templates).toHaveLength(1);
    expect(templates[0].doseBasis).toBe("per_injection");
    expect(templates[0].frequency).toMatch(/daily/i);
    expect(templates[0].targetDose).toBe(600);
    expect(templates[0].unit).toBe("mcg");
  });
});

describe("references extraction", () => {
  it("keeps external URLs, strips 'View Source', drops in-page anchors", () => {
    const refs = extractReferences(RETA_LIKE);
    expect(refs).toHaveLength(2);
    expect(refs[0].url).toBe("https://pubmed.ncbi.nlm.nih.gov/37385280/");
    expect(refs[0].label).not.toMatch(/View Source/i);
    expect(refs[0].label).toMatch(/Lancet/);
    expect(refs[1].url).toBeNull(); // only an in-page #ref anchor
  });
});

describe("reconstitution ratio", () => {
  it("reads the mg/mL hint from a protocol heading", () => {
    expect(extractReconstitutionRatio(RETA_LIKE)).toBe("2 mL = ~10.0 mg/mL");
    expect(extractReconstitutionRatio(BPC_LIKE)).toBe("3 mL = ~1.67 mg/mL");
  });
});

describe("blend/stack detection", () => {
  it("flags blend URLs and blend titles", () => {
    expect(isBlendOrStack("<title>x</title>", "https://peptidedosages.com/peptide-blend-dosages/a-b-blend/")).toBe(
      true,
    );
    expect(isBlendOrStack("<title>BPC-157 + TB-500 Blend Dosage</title>", "https://x/single/")).toBe(true);
    expect(isBlendOrStack(RETA_LIKE, "https://peptidedosages.com/single-peptide-dosages/retatrutide/")).toBe(false);
  });
});

describe("parsePeptidePage (full)", () => {
  it("assembles all fields for a GLP-1-style page", () => {
    const r = parsePeptidePage(RETA_LIKE);
    expect(r.dosingReference).toMatch(/2–8 mg weekly/);
    expect(r.mechanism).toMatch(/triple-agonist/);
    expect(r.mechanism).not.toMatch(/\[7\]/); // sup markers stripped
    expect(r.reconstitution).toHaveLength(2);
    expect(r.reconstitutionRatio).toBe("2 mL = ~10.0 mg/mL");
    expect(r.templates).toHaveLength(2);
    expect(r.benefits.length).toBeGreaterThan(0);
    expect(r.sideEffects.length).toBeGreaterThan(0);
    expect(r.references.length).toBeGreaterThan(0);
  });
});
