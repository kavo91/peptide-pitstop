/**
 * Page heading — renders the title in the Teko display face, UPPERCASE, split
 * into two parts joined by a race-orange "/" (e.g. DASH/BOARD). A large faded
 * "race number" sits behind the title as a non-interactive ghost numeral.
 *
 * Server-safe: pure presentational, no hooks, no client APIs.
 */
import type { ReactNode } from "react";

interface PitstopHeadingProps {
  /** Plain title — used when no explicit split is given. */
  title: string;
  /** Race number for the ghost numeral (zero-padded to 2 digits). */
  index: number;
  /** h1 classes — preserves each page's existing heading spacing/scale. */
  className?: string;
  /**
   * Optional two-part split for the heading, e.g. ["DASH","BOARD"] →
   * DASH/BOARD. When omitted, the title renders uppercase with a leading
   * orange "/" accent.
   */
  split?: readonly [string, string];
}

export function PitstopHeading({ title, index, className, split }: PitstopHeadingProps) {
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
