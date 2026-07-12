"use client";

import { useEffect, useRef, useState } from "react";
import { formatCurrency } from "@/lib/format";

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

const DURATION_MS = 900;

/** Sobe de 0 até o valor final uma vez, ao montar — dá um "tchan" nos números do resumo sem precisar de lib de animação. */
export function CountUpValue({ value, format = "number" }: { value: number; format?: "number" | "currency" }) {
  const [display, setDisplay] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    let frame: number;
    function tick(timestamp: number) {
      if (startRef.current === null) startRef.current = timestamp;
      const elapsed = timestamp - startRef.current;
      const progress = Math.min(elapsed / DURATION_MS, 1);
      setDisplay(Math.round(value * easeOutCubic(progress)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <>{format === "currency" ? formatCurrency(display) : display.toLocaleString("pt-BR")}</>;
}
