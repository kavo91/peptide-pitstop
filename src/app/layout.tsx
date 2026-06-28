import type { Metadata, Viewport } from "next";
import { Inter, Teko, Rajdhani, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { BottomNav } from "@/components/BottomNav";
import { SideNav } from "@/components/SideNav";
import { MobileHeader } from "@/components/MobileHeader";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { getCurrentUser } from "@/lib/auth/owner";
import { getTodayDoseStatus, type TodayDoseStatus } from "@/lib/today";

// Peptide Pitstop typefaces — self-hosted by next/font (downloaded at build,
// served from this origin), so there is NO runtime call to Google Fonts and no
// third-party phone-home. globals.css maps --font-* to these CSS variables.
//
// Font licensing: Inter, Teko, Rajdhani, and IBM Plex Mono are each licensed
// under the SIL Open Font License 1.1. See NOTICE.md at the repo root for the
// per-font copyright holders and the full licence reference.
const fontSans = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--ff-inter", display: "swap", preload: false });
const fontDisplay = Teko({ subsets: ["latin"], weight: ["600", "700"], variable: "--ff-teko", display: "swap", preload: false });
const fontLabel = Rajdhani({ subsets: ["latin"], weight: ["600", "700"], variable: "--ff-rajdhani", display: "swap", preload: false });
const fontMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--ff-plex-mono", display: "swap", preload: false });
const fontVariables = `${fontSans.variable} ${fontDisplay.variable} ${fontLabel.variable} ${fontMono.variable}`;

// Runtime environment label (e.g. "DEV") — set ONLY on non-prod deployments so
// dev is visually distinct (amber favicon + a DEV badge in the header). Read at
// server start so the SAME image differs per deployment (a NEXT_PUBLIC_ var would
// be baked at build time and couldn't differ between dev and prod).
const ENV_LABEL = process.env.ENV_LABEL?.trim() || null;

export function generateMetadata(): Metadata {
  const brand = "Peptide Pitstop";
  return {
    title: ENV_LABEL ? `${brand} · ${ENV_LABEL}` : brand,
    description: "Self-hosted peptide dose tracking, reconstitution math, and prescriptions.",
    manifest: "/manifest.webmanifest",
    // Peptide Pitstop's brake-disc favicon.
    icons: {
      icon: [
        { url: "/icons/icon-pitstop.svg", type: "image/svg+xml" },
        { url: "/icons/favicon-32.png", type: "image/png", sizes: "32x32" },
      ],
      shortcut: "/icons/icon-pitstop.svg",
      // iOS home-screen ignores SVG apple-touch-icons — must be a PNG.
      apple: [{ url: "/icons/apple-touch-icon-pitstop.png", sizes: "180x180" }],
    },
    appleWebApp: { capable: true, statusBarStyle: "default", title: ENV_LABEL ? `Peptides ${ENV_LABEL}` : "Peptides" },
  };
}

export const viewport: Viewport = {
  // Single dark-canvas themeColor — matches the new dark default on iOS.
  // The OS-keyed array is removed because the app default is now "dark",
  // and a light/dark pair would show the wrong chrome colour on iOS.
  themeColor: "#0B0F14",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/**
 * No-flash theme script — inlined into <head> so it runs synchronously
 * before first paint. Content is a hardcoded constant string with no
 * user-supplied data, so inline injection is safe here.
 *
 * Reads pt-theme from localStorage (default "dark") and stamps data-theme
 * on <html>. "system" resolves to the OS preference at load time.
 */
const noFlashScript = `
(function() {
  try {
    var stored = localStorage.getItem('pt-theme');
    var theme = stored === 'light' || stored === 'dark' || stored === 'system'
      ? stored
      : 'dark';
    if (theme === 'system') {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
    }
    document.documentElement.dataset.theme = theme;
  } catch (_) {
    // localStorage blocked (private browsing) — default to dark.
    document.documentElement.dataset.theme = 'dark';
  }
})();
`.trim();

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Today dose-status for the header chip. Skipped when no user is signed in.
  let doseStatus: TodayDoseStatus | undefined;
  const user = await getCurrentUser();
  if (user) doseStatus = await getTodayDoseStatus(user.id);
  return (
    // suppressHydrationWarning: the inline script above sets data-theme before
    // React hydrates, so server-rendered <html> (no attribute) differs from the
    // client-hydrated one. This is the documented App Router pattern for
    // no-flash theme — it suppresses the hydration warning for <html> only.
    <html lang="en" data-design="pitstop" className={fontVariables} suppressHydrationWarning>
      <head>
        {/* Content is a hardcoded constant — no user data, safe to inline. */}
        <script dangerouslySetInnerHTML={{ __html: noFlashScript }} />
        {/* Typefaces are self-hosted via next/font (see imports) — no runtime
            Google Fonts request. globals.css maps --font-* to the --ff-* variables. */}
      </head>
      <body className="flex min-h-screen flex-col font-sans antialiased lg:flex-row">
        <ServiceWorkerRegistration />
        <SideNav envLabel={ENV_LABEL} brand="Peptide Pitstop" doseStatus={doseStatus} />
        {/* Content column: fills the space beside the desktop sidebar; on mobile
            it is the whole viewport with the bottom nav pinned underneath.
            min-w-0 lets wide children (charts, tables) shrink instead of overflow.
            On true ultra-wide (≥1900px) cap the column wide enough to hold the
            multi-column page layouts (dashboard/settings two-up, 3-up grids) while
            staying adjacent to the sidebar and not over-stretching on 3440px+;
            laptops (≤1728) and mobile are unaffected by the arbitrary bp. */}
        <div className="flex min-w-0 flex-1 flex-col min-[1900px]:max-w-[1800px]">
          <MobileHeader envLabel={ENV_LABEL} doseStatus={doseStatus} />
          <div className="flex-1">{children}</div>
          <BottomNav />
        </div>
      </body>
    </html>
  );
}
