/**
 * Page heading with a runtime design switch.
 *
 *  - "current" (default): renders EXACTLY what the page rendered before — a
 *    plain `<h1 className={className}>{title}</h1>`. No split, no ghost number,
 *    no visual change, so the default design stays byte-identical.
 *  - "pitstop": renders the title in the Teko display face, UPPERCASE, split
 *    into two parts joined by a race-orange "/" (e.g. DASH/BOARD). A large faded
 *    "race number" sits behind the title as a non-interactive ghost numeral.
 *
 * Server-safe: pure presentational, no hooks, no client APIs. Pass the design
 * in from the server page via activeDesign() so this never reads process.env.
 */
import type { ReactNode } from "react";

interface PitstopHeadingProps {
  /** Plain title — rendered verbatim for the current design. */
  title: string;
  /** Race number for the ghost numeral (zero-padded to 2 digits). */
  index: number;
  /** Active design pack — pass activeDesign() from the server page. */
  design: "pitstop" | "current";
  /** h1 classes — preserves each page's existing heading spacing/scale. */
  className?: string;
  /**
   * Optional two-part split for the pitstop heading, e.g. ["DASH","BOARD"] →
   * DASH/BOARD. When omitted, the pitstop title renders uppercase with a leading
   * orange "/" accent. Ignored entirely by the current design.
   */
  split?: readonly [string, string];
}

export function PitstopHeading({ title, index, design, className, split }: PitstopHeadingProps) {
  // Current design: byte-identical to the page's original plain heading.
  if (design !== "pitstop") {
    return <h1 className={className}>{title}</h1>;
  }

  const race = String(index).padStart(2, "0");
  const titleNode: ReactNode = split ? (
    <>
      {split[0]}
      <span className="pitstop-heading__slash">/</span>
      {split[1]}
    </>
  ) : (
    <>
      <span className="pitstop-heading__slash">/</span>
      {title.toUpperCase()}
    </>
  );

  return (
    <h1 className={className}>
      <span className="pitstop-heading">
        <span className="pitstop-heading__ghost" aria-hidden="true">
          {race}
        </span>
        <span className="pitstop-heading__title">{titleNode}</span>
      </span>
    </h1>
  );
}
