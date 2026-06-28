import type { Config } from "tailwindcss";

/**
 * Bespoke signature theme, Apple-HIG-conformant. Colours are driven by CSS
 * variables (see globals.css) so light/dark is a token swap, not a rebuild.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--bg) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        // Signature accent — neon teal — reserved for fills/buttons only.
        accent: "rgb(var(--accent) / <alpha-value>)",
        // Secondary cyan accent (fills only — neon cyan).
        accent2: "rgb(var(--accent-2) / <alpha-value>)",
        // Darkened secondary cyan for TEXT on light backgrounds — passes WCAG AA.
        accent2Strong: "rgb(var(--accent-2-strong) / <alpha-value>)",
        // Darkened accent for text/links/icons — passes WCAG AA in light mode.
        accentStrong: "rgb(var(--accent-strong) / <alpha-value>)",
        // Text colour for use ON accent-filled surfaces.
        onAccent: "rgb(var(--on-accent) / <alpha-value>)",
        // Low-contrast hairline border (use at low alpha: ring-line/15, border-line/10).
        line: "rgb(var(--line) / <alpha-value>)",
        // Semantic dose states (reserved, never decorative).
        ok: "rgb(var(--ok) / <alpha-value>)",
        warn: "rgb(var(--warn) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
      },
      // Driven by CSS vars so a design pack can retune corner radii without a
      // rebuild. Fallbacks keep the default design byte-identical (16/10) when
      // the vars are undefined (i.e. DESIGN unset).
      borderRadius: { card: "var(--radius-card, 16px)", control: "var(--radius-control, 10px)" },
      fontFamily: {
        sans: [
          "-apple-system", "BlinkMacSystemFont", "SF Pro Text",
          "Inter", "Segoe UI", "system-ui", "sans-serif",
        ],
        mono: [
          "ui-monospace", "SF Mono", "JetBrains Mono", "Menlo", "monospace",
        ],
      },
      fontVariantNumeric: { tabular: "tabular-nums" },
    },
  },
  plugins: [],
};

export default config;
