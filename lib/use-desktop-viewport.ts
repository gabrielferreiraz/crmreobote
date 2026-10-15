"use client";

import { useSyncExternalStore } from "react";

const DESKTOP_QUERY = "(min-width: 1024px)";

function subscribe(onChange: () => void) {
  const media = window.matchMedia(DESKTOP_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function getSnapshot(): boolean | null {
  return window.matchMedia(DESKTOP_QUERY).matches;
}

function getServerSnapshot(): boolean | null {
  return null;
}

/**
 * Retorna null durante SSR/hidratacao e depois informa se a viewport esta no
 * breakpoint desktop do Tailwind (`lg`). Assim telas grandes montam somente
 * a arvore que o usuario realmente ve.
 */
export function useDesktopViewport(): boolean | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
