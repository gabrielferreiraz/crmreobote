"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "./theme-provider";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggle } = useTheme();

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro"}
      className={`icon-btn ${className}`}
    >
      {theme === "dark" ? (
        <Sun className="h-3.5 w-3.5" strokeWidth={2} />
      ) : (
        <Moon className="h-3.5 w-3.5" strokeWidth={2} />
      )}
    </button>
  );
}
