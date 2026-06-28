import { NextResponse } from "next/server";

/**
 * PWA manifest, served at /manifest.webmanifest.
 *
 * Implemented as a Route Handler (not the app/manifest.ts metadata convention)
 * so the icon set and name are served consistently at request time.
 */
export const dynamic = "force-dynamic";

const PITSTOP_ICONS = [
  { src: "/icons/icon-pitstop.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
  { src: "/icons/icon-pitstop-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icons/icon-pitstop-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "/icons/icon-pitstop-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
];

export async function GET() {
  return NextResponse.json(
    {
      name: "Peptide Pitstop",
      short_name: "Peptides",
      description: "Self-hosted peptide dose tracking and reconstitution math.",
      start_url: "/",
      display: "standalone",
      background_color: "#0B0F14",
      theme_color: "#0B0F14",
      orientation: "portrait",
      icons: PITSTOP_ICONS,
    },
    { headers: { "Content-Type": "application/manifest+json" } },
  );
}
