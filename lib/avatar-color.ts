const PALETTE = [
  { bg: "#eef2ff", fg: "#4338ca" }, // indigo
  { bg: "#ecfdf5", fg: "#047857" }, // emerald
  { bg: "#fff7ed", fg: "#c2410c" }, // orange
  { bg: "#fdf4ff", fg: "#a21caf" }, // fuchsia
  { bg: "#f0f9ff", fg: "#0369a1" }, // sky
  { bg: "#fefce8", fg: "#a16207" }, // yellow
  { bg: "#fef2f2", fg: "#b91c1c" }, // red
  { bg: "#f0fdfa", fg: "#0f766e" }, // teal
];

export function colorForName(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

export function initialsForName(name: string) {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}
