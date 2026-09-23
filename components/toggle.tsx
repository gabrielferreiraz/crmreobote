"use client";

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  description?: string;
}

export function Toggle({ checked, onChange, disabled = false, label, description }: ToggleProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        {label && <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{label}</p>}
        {description && <p className="text-xs text-neutral-500 dark:text-neutral-400">{description}</p>}
      </div>
      <button
        onClick={() => onChange(!checked)}
        disabled={disabled}
        role="switch"
        aria-checked={checked}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
          checked
            ? "bg-emerald-600 focus-visible:outline-emerald-600 dark:bg-emerald-500 dark:focus-visible:outline-emerald-500"
            : "bg-neutral-300 focus-visible:outline-neutral-400 dark:bg-neutral-600 dark:focus-visible:outline-neutral-500"
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}
