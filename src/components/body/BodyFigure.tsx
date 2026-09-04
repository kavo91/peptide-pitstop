"use client";
/**
 * Body figure — a rendered anatomy (public/body/figure/*) lit from the scan.
 *
 * Assets, generated once and split into layers (see NOTICE.md):
 *   base.png     greyscale luminance of the figure (the "beauty" layer)
 *   fat/lean/bone.png  greyscale tissue masks
 *   regions.png  id map: 1 head, 2 left arm (viewer's left), 3 right arm, 4 trunk, 5 left leg, 6 right leg
 *   meta.json    region ids + centroids
 *
 * Levels: per region, each tissue layer is tinted with the plate trio
 * (`--fig-fat` sliding to `--fig-fat-hi` as the region's % fat rises, `--fig-lean`,
 * `--fig-bone`) and drawn additively at the brightness `layerStrengths` gives.
 * Change: layers dim and each region is tinted by its tier (muted / warn /
 * accent); regions beyond the practical LSC pulse once when the view opens.
 *
 * All colour comes from tokens read off the element, so packs and themes need
 * no branching; the plate is dark in every theme (the art is lit for dark).
 * Labels are HTML over the canvas; the region table is the keyboard path.
 */
import { useEffect, useRef, useState } from "react";
import type { ChangeTier, Region } from "@/lib/body-comp-core";
import { fatHueT, layerStrengths, type BodyFigureModel, type FigureCell, type LayerStrengths } from "@/lib/body-figure-core";
import { BODY_COPY } from "@/lib/bodycomp-copy";
import { signed } from "./format";

export type FigureMode = "levels" | "change";

interface Props {
  model: BodyFigureModel;
  mode: FigureMode;
  active: Region | null;
  onActivate: (region: Region | null, pin?: boolean) => void;
  className?: string;
  /** Where the layer files live (default `/body/figure`). */
  assetBase?: string;
}

interface FigureMeta { width: number; height: number; regions: Record<string, { id: number; cx: number; cy: number }> }
type Rgb = [number, number, number];
type Tissue = "fat" | "lean" | "bone";
const TISSUES: Tissue[] = ["fat", "lean", "bone"];
const TIER_TOKEN: Record<ChangeTier, string> = { within_noise: "--muted", indeterminate: "--warn", exceeds_lsc: "--accent" };

interface Engine {
  W: number; H: number;
  meta: FigureMeta;
  base: HTMLImageElement;
  regData: Uint8ClampedArray;
  /** Untinted per-region alpha cells, per tissue. */
  cells: Record<string, Record<Tissue, HTMLCanvasElement>>;
  regionMask: Record<string, HTMLCanvasElement>;
  tokens: Record<string, Rgb>;
  tintCache: Map<string, Record<string, { fat: HTMLCanvasElement; lean: HTMLCanvasElement; bone: HTMLCanvasElement; s: LayerStrengths }>>;
  tierTint: Record<ChangeTier, Record<string, HTMLCanvasElement>>;
}

const cnv = (w: number, h: number) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
const ctx2d = (c: HTMLCanvasElement) => c.getContext("2d", { willReadFrequently: true })!;
const loadImg = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(`figure asset failed: ${src}`)); i.src = src; });
const readTok = (el: Element, name: string): Rgb => { const v = getComputedStyle(el).getPropertyValue(name).trim().split(/\s+/).map(Number); return [v[0] || 0, v[1] || 0, v[2] || 0]; };
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as Rgb;
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function tintCell(cell: HTMLCanvasElement, rgb: Rgb, W: number, H: number): HTMLCanvasElement {
  const c = cnv(W, H); const x = c.getContext("2d")!;
  x.drawImage(cell, 0, 0); x.globalCompositeOperation = "source-in"; x.fillStyle = `rgb(${rgb.join(",")})`; x.fillRect(0, 0, W, H);
  return c;
}

async function buildEngine(host: HTMLElement, assetBase: string): Promise<Engine> {
  const meta = (await (await fetch(`${assetBase}/meta.json`)).json()) as FigureMeta;
  const [base, fat, lean, bone, regions] = await Promise.all(["base", "fat", "lean", "bone", "regions"].map((k) => loadImg(`${assetBase}/${k}.png`)));
  const W = meta.width, H = meta.height;
  const rc = ctx2d(cnv(W, H)); rc.drawImage(regions, 0, 0); const regData = rc.getImageData(0, 0, W, H).data;
  const regionMask: Record<string, HTMLCanvasElement> = {};
  for (const [name, r] of Object.entries(meta.regions)) {
    const c = cnv(W, H); const x = ctx2d(c); const d = x.createImageData(W, H);
    for (let i = 0; i < W * H; i++) d.data[i * 4 + 3] = regData[i * 4] === r.id ? 255 : 0;
    x.putImageData(d, 0, 0); regionMask[name] = c;
  }
  const alphaCell = (img: HTMLImageElement, name: string) => {
    const c = cnv(W, H); const x = ctx2d(c); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, W, H);
    for (let i = 0; i < d.data.length; i += 4) { d.data[i + 3] = d.data[i]; d.data[i] = d.data[i + 1] = d.data[i + 2] = 255; }
    x.putImageData(d, 0, 0); x.globalCompositeOperation = "destination-in"; x.drawImage(regionMask[name], 0, 0); return c;
  };
  const cells: Engine["cells"] = {};
  for (const name of Object.keys(regionMask)) cells[name] = { fat: alphaCell(fat, name), lean: alphaCell(lean, name), bone: alphaCell(bone, name) };
  const engine: Engine = { W, H, meta, base, regData, cells, regionMask, tokens: {}, tintCache: new Map(), tierTint: { within_noise: {}, indeterminate: {}, exceeds_lsc: {} } };
  retint(engine, host);
  return engine;
}

/** Re-read the tokens (theme or pack changed) and drop every tinted cell. */
function retint(engine: Engine, host: HTMLElement) {
  engine.tokens = Object.fromEntries(["--fig-fat", "--fig-fat-hi", "--fig-lean", "--fig-bone", "--muted", "--warn", "--accent"].map((n) => [n, readTok(host, n)]));
  engine.tintCache.clear();
  for (const tier of Object.keys(TIER_TOKEN) as ChangeTier[]) engine.tierTint[tier] = Object.fromEntries(Object.keys(engine.regionMask).map((n) => [n, tintCell(engine.regionMask[n], engine.tokens[TIER_TOKEN[tier]], engine.W, engine.H)]));
}

function tintedFor(engine: Engine, model: BodyFigureModel) {
  const key = model.scanId;
  const hit = engine.tintCache.get(key); if (hit) return hit;
  const out: Record<string, { fat: HTMLCanvasElement; lean: HTMLCanvasElement; bone: HTMLCanvasElement; s: LayerStrengths }> = {};
  for (const c of model.regions) {
    const cell = engine.cells[c.region]; if (!cell) continue;
    out[c.region] = {
      fat: tintCell(cell.fat, mix(engine.tokens["--fig-fat"], engine.tokens["--fig-fat-hi"], fatHueT(c.pctFat)), engine.W, engine.H),
      lean: tintCell(cell.lean, engine.tokens["--fig-lean"], engine.W, engine.H),
      bone: tintCell(cell.bone, engine.tokens["--fig-bone"], engine.W, engine.H),
      s: layerStrengths(c),
    };
  }
  engine.tintCache.set(key, out);
  return out;
}

export function BodyFigure({ model, mode, active, onActivate, className = "", assetBase = "/body/figure" }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const stateRef = useRef<{ from: ReturnType<typeof tintedFor> | null; to: ReturnType<typeof tintedFor> | null; e: number; raf: number; pulse: number | null; lastScan: string | null }>({ from: null, to: null, e: 1, raf: 0, pulse: null, lastScan: null });
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  // Build the engine once; rebuild tints when the theme or pack attribute changes on <html>.
  useEffect(() => {
    let alive = true;
    const host = hostRef.current!;
    const st = stateRef.current;
    buildEngine(host, assetBase).then((eng) => { if (!alive) return; engineRef.current = eng; setStatus("ready"); }).catch((e) => { console.warn("[BodyFigure]", e); if (alive) setStatus("error"); });
    const obs = new MutationObserver(() => { const eng = engineRef.current; if (!eng) return; retint(eng, host); stateRef.current.from = null; stateRef.current.to = null; stateRef.current.lastScan = null; setStatus((s) => (s === "ready" ? "ready" : s)); bump((b) => b + 1); });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-design"] });
    return () => { alive = false; obs.disconnect(); cancelAnimationFrame(st.raf); };
  }, [assetBase]);
  const [, bump] = useState(0);

  // Draw on every relevant change.
  useEffect(() => {
    const eng = engineRef.current, canvas = canvasRef.current;
    if (status !== "ready" || !eng || !canvas) return;
    const ctx = canvas.getContext("2d")!; const st = stateRef.current;
    const next = tintedFor(eng, model);
    const draw = (now: number) => {
      ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1; ctx.clearRect(0, 0, eng.W, eng.H);
      ctx.globalAlpha = 0.42; ctx.drawImage(eng.base, 0, 0);
      ctx.globalCompositeOperation = "lighter";
      const layerAlpha = mode === "change" ? 0.45 : 1;
      const stack = (t: ReturnType<typeof tintedFor>, alpha: number) => { for (const [name, cell] of Object.entries(t)) { const dim = active && active !== name ? 0.35 : 1; for (const k of TISSUES) { ctx.globalAlpha = cell.s[k] * alpha * dim; ctx.drawImage(cell[k], 0, 0); } } };
      if (st.from && st.e < 1) stack(st.from, layerAlpha * (1 - st.e));
      if (st.to) stack(st.to, layerAlpha * st.e);
      let more = false;
      if (mode === "change" && model.change) {
        ctx.globalCompositeOperation = "source-over";
        for (const c of model.regions) {
          if (!c.delta || !eng.tierTint[c.delta.tier][c.region]) continue;
          const dim = active && active !== c.region ? 0.4 : 1; let a = 0.42 * dim;
          if (st.pulse != null && c.delta.tier === "exceeds_lsc") { const p = Math.min(1, (now - st.pulse) / 900); a += 0.5 * (1 - p) * Math.sin(p * Math.PI); more = more || p < 1; }
          ctx.globalAlpha = a; ctx.drawImage(eng.tierTint[c.delta.tier][c.region], 0, 0);
        }
      }
      if (!more) st.pulse = null;
      return more;
    };
    const scanChanged = st.lastScan !== null && st.lastScan !== model.scanId;
    st.lastScan = model.scanId;
    cancelAnimationFrame(st.raf);
    if (scanChanged && st.to && !reducedMotion()) {
      st.from = st.to; st.to = next; st.e = 0; const t0 = performance.now();
      const step = (now: number) => { const t = Math.min(1, (now - t0) / 650); st.e = 1 - Math.pow(1 - t, 3); const more = draw(now); if (t < 1 || more) st.raf = requestAnimationFrame(step); };
      st.raf = requestAnimationFrame(step);
    } else {
      st.from = null; st.to = next; st.e = 1;
      const loop = (now: number) => { if (draw(now)) st.raf = requestAnimationFrame(loop); };
      st.raf = requestAnimationFrame(loop);
    }
  }, [status, model, mode, active]);

  // A one-off pulse on regions beyond the LSC when the change view opens.
  useEffect(() => { if (mode === "change" && !reducedMotion()) { stateRef.current.pulse = performance.now(); bump((b) => b + 1); } }, [mode]);

  const regionAt = (clientX: number, clientY: number): Region | null => {
    const eng = engineRef.current, canvas = canvasRef.current; if (!eng || !canvas) return null;
    const r = canvas.getBoundingClientRect(); const x = Math.floor((clientX - r.left) / r.width * eng.W), y = Math.floor((clientY - r.top) / r.height * eng.H);
    if (x < 0 || y < 0 || x >= eng.W || y >= eng.H) return null;
    const id = eng.regData[(y * eng.W + x) * 4];
    for (const [name, m] of Object.entries(eng.meta.regions)) if (m.id === id) return name as Region;
    return null;
  };
  const meta = engineRef.current?.meta;
  const labelFor = (c: FigureCell) => (mode === "change" ? (c.delta ? signed(c.delta.fatPts, 1) : "—") : c.pctFat.toFixed(1));

  return (
    <div
      ref={hostRef}
      className={`relative aspect-[3/4] w-full overflow-hidden rounded-[10px] bg-figPlate ${className}`}
      data-body-figure={model.scanId}
      data-paint={model.paint}
      data-mode={mode}
      data-status={status}
      onMouseMove={(e) => onActivate(regionAt(e.clientX, e.clientY))}
      onMouseLeave={() => onActivate(null)}
      onClick={(e) => onActivate(regionAt(e.clientX, e.clientY), true)}
      role="group"
      aria-label={mode === "change" ? BODY_COPY.figureAriaChange : BODY_COPY.figureAriaLevels}
    >
      <canvas ref={canvasRef} width={meta?.width ?? 512} height={meta?.height ?? 683} className="block h-full w-full" aria-hidden />
      {status === "ready" && meta && model.regions.map((c) => {
        const m = meta.regions[c.region]; if (!m) return null;
        const dim = active && active !== c.region;
        const tier = mode === "change" ? c.delta?.tier : undefined;
        const tone = tier === "exceeds_lsc" ? "text-accentStrong" : tier === "indeterminate" ? "text-warn" : tier === "within_noise" ? "text-muted" : "text-ink";
        return (
          <span
            key={c.region}
            data-region={c.region}
            data-fat={c.fatShare.toFixed(3)}
            className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-[11px] font-semibold leading-none tabular-nums transition-opacity duration-150 motion-reduce:transition-none ${tone} ${dim ? "opacity-35" : ""}`}
            style={{ left: `${(m.cx / meta.width) * 100}%`, top: `${(m.cy / meta.height) * 100}%`, textShadow: "0 0 4px rgb(var(--fig-plate)), 0 0 2px rgb(var(--fig-plate)), 0 1px 2px rgb(var(--fig-plate))" }}
          >
            {labelFor(c)}
          </span>
        );
      })}
      {status !== "ready" && (
        <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-muted" style={{ color: "rgb(138 153 162)" }}>
          {status === "loading" ? BODY_COPY.figureLoading : BODY_COPY.figureUnavailable}
        </p>
      )}
    </div>
  );
}
