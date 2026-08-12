import { NextResponse } from "next/server";
import { brandName, activeDesign } from "@/lib/design";

/**
 * Dynamic PWA manifest, served at /manifest.webmanifest.
 *
 * Implemented as a Route Handler (not the app/manifest.ts metadata convention)
 * because Next PRERENDERS the metadata manifest at BUILD time — when DESIGN and
 * ENV_LABEL are unset — so it always emitted the "current" name/icons even on a
 * DESIGN=pitstop deploy. A route handler with `force-dynamic` is evaluated per
 * request, so brandName()/activeDesign() and ENV_LABEL are read at RUNTIME and
 * the SAME built image serves the correct manifest per deployment.
 */
export const dynamic = "force-dynamic";

const PITSTOP_ICONS = [
  { src: "/icons/icon-pitstop.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
  { src: "/icons/icon-pitstop-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icons/icon-pitstop-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "/icons/icon-pitstop-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
];

// Dev gets the DEV-bannered brake-disc so the installed/home-screen icon is
// distinguishable from prod.
const PITSTOP_DEV_ICONS = [
  { src: "/icons/icon-pitstop-dev.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
  { src: "/icons/icon-pitstop-dev-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icons/icon-pitstop-dev-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "/icons/icon-pitstop-dev-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
];

const CURRENT_ICONS = [
  { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
  { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
];

export async function GET() {
  const pitstop = activeDesign() === "pitstop";
  const isDev = Boolean((process.env.ENV_LABEL || "").trim());
  const icons = pitstop ? (isDev ? PITSTOP_DEV_ICONS : PITSTOP_ICONS) : CURRENT_ICONS;
  return NextResponse.json(
    {
      name: brandName(),
      short_name: "Peptides",
      description: "Self-hosted peptide dose tracking and reconstitution math.",
      start_url: "/",
      display: "standalone",
      background_color: "#0B0F14",
      theme_color: "#0B0F14",
      orientation: "portrait",
      icons,
    },
    { headers: { "Content-Type": "application/manifest+json" } },
  );
}
