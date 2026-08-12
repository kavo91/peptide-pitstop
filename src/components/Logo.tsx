/**
 * Brand mark + wordmark lockup.
 *
 * Two marks are rendered and ONE is shown via CSS keyed off the
 * `data-design` attribute on <html> (set server-side from the DESIGN env var):
 *
 *  - "current" (default): the plasma-curve motif — a pharmacokinetic
 *    concentration curve with a dose point at the peak, on a self-contained
 *    dark tile. The wordmark reads "Peptide Tracker".
 *  - "pitstop": the "Apex Line" mark — a clean race-orange brake-disc ring
 *    (drilled vent holes + inner hub ring) cut by the cyan lean/apex slash.
 *    The wordmark reads "Peptide Pitstop" in the display face.
 *
 * Both variants are always in the DOM so the swap is purely a CSS display
 * toggle — hydration-safe and independent of any client-side env read. In the
 * default design the pitstop variants carry Tailwind `hidden` (display:none),
 * so they are visually inert and the output is unchanged.
 */

export function LogoMark({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    <>
      {/* Current design — plasma-curve tile. */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 512 512"
        role="img"
        aria-label="Peptide Tracker"
        className={`logo-mark-current shrink-0 ${className}`}
      >
        <defs>
          <radialGradient id="ptlogo-bg" cx="50%" cy="36%" r="80%">
            <stop offset="0" stopColor="#16212B" />
            <stop offset="1" stopColor="#0B0F14" />
          </radialGradient>
        </defs>
        <rect width="512" height="512" rx="112" fill="url(#ptlogo-bg)" />
        <rect x="7" y="7" width="498" height="498" rx="105" fill="none" stroke="#2DE2C8" strokeOpacity="0.16" strokeWidth="3" />
        <line x1="100" y1="374" x2="412" y2="374" stroke="#2DE2C8" strokeOpacity="0.28" strokeWidth="6" strokeLinecap="round" />
        <g fill="none" strokeLinecap="round">
          <path d="M100 356 C 156 356 178 214 238 200 C 300 186 330 306 412 318" stroke="#22D3EE" strokeOpacity="0.18" strokeWidth="42" />
          <path d="M100 356 C 156 356 178 214 238 200 C 300 186 330 306 412 318" stroke="#22D3EE" strokeWidth="18" />
        </g>
        <circle cx="238" cy="200" r="40" fill="#2DE2C8" opacity="0.20" />
        <circle cx="238" cy="200" r="22" fill="#0B0F14" stroke="#2DE2C8" strokeWidth="14" />
      </svg>

      {/* Pitstop — "Apex Line" mark: a clean race-orange brake-disc ring cut by
          the cyan lean/apex slash. The aero-blade chevron, wind-tunnel speed-lines
          and lime leading-edge notch were removed; the disc is re-centred in a
          square viewBox so it fills the mark and sits centred. width=height=size
          is unchanged, so the lockup layout never shifts.
          Hidden unless data-design="pitstop" un-hides it (see globals.css). */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 74 74"
        fill="none"
        role="img"
        aria-label="Peptide Pitstop"
        className={`logo-mark-pitstop hidden shrink-0 ${className}`}
      >
        <defs>
          <linearGradient id="ptlogo-apexline" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#FF7A3D" />
            <stop offset="1" stopColor="#FF5B14" />
          </linearGradient>
        </defs>
        {/* brake disc outer ring — centred & enlarged to fill the mark */}
        <circle cx="37" cy="37" r="31" stroke="url(#ptlogo-apexline)" strokeWidth="5" />
        {/* inner hub ring */}
        <circle cx="37" cy="37" r="14" stroke="rgba(242,243,245,0.30)" strokeWidth="3" />
        {/* drilled vent holes */}
        <g fill="#FF5B14">
          <circle cx="37" cy="13" r="2" /><circle cx="54" cy="20" r="2" /><circle cx="61" cy="37" r="2" />
          <circle cx="54" cy="54" r="2" /><circle cx="37" cy="61" r="2" /><circle cx="20" cy="54" r="2" />
          <circle cx="13" cy="37" r="2" /><circle cx="20" cy="20" r="2" />
        </g>
        {/* lean-angle / apex slash through the disc (the racing line) */}
        <path d="M16 59 L58 15" stroke="#F2F3F5" strokeWidth="6" strokeLinecap="round" />
        <path d="M16 59 L58 15" stroke="#00E5FF" strokeWidth="2.6" strokeLinecap="round" />
      </svg>
    </>
  );
}

export function LogoLockup({
  markSize = 40,
  textClass = "text-xl",
  className = "",
}: {
  markSize?: number;
  textClass?: string;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark size={markSize} />
      {/* Both wordmarks present; CSS shows one per data-design (see globals.css).
          The pitstop wordmark renders in the display face. */}
      <span className={`logo-word-current font-semibold tracking-tight ${textClass}`}>Peptide Tracker</span>
      <span className={`logo-word-pitstop hidden font-semibold tracking-tight ${textClass}`}>Peptide Pitstop</span>
    </span>
  );
}
