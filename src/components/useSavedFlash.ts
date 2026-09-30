"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { SAVED_FLASH_MS, savedFlashKey, savedFlashRemaining, stampSavedFlash } from "@/lib/saved-flash";

/**
 * A transient "Saved" confirmation that survives the remount a successful save
 * causes.
 *
 * `updateProtocol` ends with `revalidatePath()`, which re-renders the page from
 * the values just saved — and BOTH editors are keyed on those very values
 * (`protocols/page.tsx` keys ProtocolEditor on `id:startDate:status`;
 * `protocols/gantt/page.tsx` keys GanttRowEditor on id + end date + cycle plan).
 * So a save that actually changes one of them changes the key, and React
 * unmounts the editor and mounts a fresh one. That remount lands while `save()`
 * is still awaiting, so `setSaved(true)` writes to a dead instance while the new
 * one renders "Save", so the label would never flip. (The anchor-held notice
 * in ProtocolEditor has the same problem on the same page.)
 *
 * A status change such as pausing a protocol is a key change too, so it also
 * remounts the editor. On the Gantt the same remount destroys the panel's plain
 * `open` state, which this flash survives.
 *
 * So the flash is stamped into sessionStorage and re-read on mount. Unlike the
 * anchor-held notice it is time-boxed: a sticky "Saved" would still be sitting there minutes
 * later under edits the user has since made and NOT saved, which is worse than
 * showing nothing. `src/lib/saved-flash.ts` holds the timing rules, tested.
 *
 * Seeded from an effect and never from `useState`'s initialiser: the server
 * renders "Save", so reading storage during the first client render would
 * diverge from it and trip a hydration mismatch.
 *
 * @param scope Distinguishes editors that share one protocol id (protocol card vs Gantt row).
 * @param id    The row being saved.
 */
export function useSavedFlash(scope: string, id: string) {
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = savedFlashKey(scope, id);

  const stopTimer = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  // sessionStorage throws outright in some privacy modes; the in-state copy is
  // then all we get, which still works whenever no remount intervenes.
  const forget = useCallback(() => {
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* storage blocked */
    }
  }, [key]);

  const expireIn = useCallback((ms: number) => {
    stopTimer();
    timer.current = setTimeout(() => {
      timer.current = null;
      setSaved(false);
      forget();
    }, ms);
  }, [forget, stopTimer]);

  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(key);
    } catch {
      /* storage blocked */
    }
    const left = savedFlashRemaining(raw, Date.now());
    if (left > 0) {
      setSaved(true);
      expireIn(left);
    } else if (raw !== null) {
      forget();
    }
    return stopTimer;
  }, [key, expireIn, forget, stopTimer]);

  /** Call on a successful save. Shows "Saved" here AND on the instance that replaces this one. */
  const flashSaved = useCallback(() => {
    setSaved(true);
    try {
      sessionStorage.setItem(key, stampSavedFlash(Date.now()));
    } catch {
      /* storage blocked */
    }
    expireIn(SAVED_FLASH_MS);
  }, [key, expireIn]);

  /** Call when the row is edited again, or when a new save starts. */
  const clearSaved = useCallback(() => {
    stopTimer();
    setSaved(false);
    forget();
  }, [forget, stopTimer]);

  return { saved, flashSaved, clearSaved };
}
