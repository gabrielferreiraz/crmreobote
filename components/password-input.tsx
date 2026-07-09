"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

export function PasswordInput({
  value,
  onChange,
  required,
  minLength,
}: {
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  minLength?: number;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        type={visible ? "text" : "password"}
        required={required}
        minLength={minLength}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="field-input pr-9"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        tabIndex={-1}
        className="absolute top-1/2 right-2 -translate-y-1/2 text-neutral-400 dark:text-neutral-500 hover:text-neutral-600 dark:hover:text-neutral-400"
        aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
      >
        {visible ? (
          <EyeOff className="h-4 w-4" strokeWidth={2} />
        ) : (
          <Eye className="h-4 w-4" strokeWidth={2} />
        )}
      </button>
    </div>
  );
}
