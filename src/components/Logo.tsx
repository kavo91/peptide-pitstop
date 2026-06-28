/**
 * Brand mark + wordmark lockup.
 *
 * The "Apex Line" mark — a clean race-orange brake-disc ring (drilled vent
 * holes + inner hub ring) cut by the cyan lean/apex slash. The wordmark reads
 * "Peptide Pitstop" in the display face (globals.css maps .logo-word-pitstop to
 * the display font under [data-design="pitstop"]).
 */

export function LogoMark({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 74 74"
      fill="none"
      role="img"
      aria-label="Peptide Pitstop"
      className={`logo-mark-pitstop shrink-0 ${className}`}
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
      {/* The pitstop wordmark renders in the display face (see globals.css). */}
      <span className={`logo-word-pitstop font-semibold tracking-tight ${textClass}`}>Peptide Pitstop</span>
    </span>
  );
}
