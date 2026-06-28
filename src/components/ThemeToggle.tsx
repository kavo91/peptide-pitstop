"use client";

import { useEffect, useState } from "react";
import { Sun, Moon, Monitor, type LucideIcon } from "lucide-react";

type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "pt-theme";
const DEFAULT: Theme = "dark";

const OPTIONS: { value: Theme; label: string; icon: LucideIcon }[] = [
  { value: "light",  label: "Light",  icon: Sun     },
  { value: "dark",   label: "Dark",   icon: Moon    },
  { value: "system", label: "System", icon: Monitor },
];

function applyTheme(theme: Theme): void {
  // Resolve "system" to the concrete OS preference at click time.
  // The stored value stays "system" so reloads re-resolve via the layout script.
  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
  document.documentElement.dataset.theme = resolved;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(DEFAULT);

  // Initialise from localStorage on mount (avoids SSR mismatch).
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
      if (stored === "light" || stored === "dark" || stored === "system") {
        setTheme(stored);
      }
    } catch {
      // localStorage blocked — stay on default.
    }
  }, []);

  function select(next: Theme): void {
    setTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore write errors in private browsing.
    }
    applyTheme(next);
  }

  return (
    <div className="flex rounded-control bg-bg ring-1 ring-line/15 overflow-hidden">
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => select(value)}
          aria-pressed={theme === value}
          className={[
            "flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors",
            theme === value
              ? "bg-accent text-onAccent"
              : "text-muted hover:text-ink",
          ].join(" ")}
        >
          <Icon className="h-4 w-4" aria-hidden /> {label}
        </button>
      ))}
    </div>
  );
}
