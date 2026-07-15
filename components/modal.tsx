"use client";

import { useEffect, useRef } from "react";

export function Modal({
  onClose,
  children,
  maxWidth = "max-w-sm",
}: {
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4 dark:bg-neutral-950/60 backdrop-blur-md"
      style={{ animation: "modal-backdrop-in 150ms ease-out" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        style={{ animation: "modal-panel-in 150ms ease-out" }}
        className={`scrollbar-thin w-full ${maxWidth} max-h-[90vh] overflow-y-auto rounded-lg border border-neutral-200/60 dark:border-neutral-800/60 bg-white dark:bg-neutral-900 p-5 shadow-xl`}
      >
        {children}
      </div>
    </div>
  );
}
