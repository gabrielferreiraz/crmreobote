import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// iOS aplica a própria máscara/arredondamento em cima do apple-touch-icon,
// então esse fica sólido, sem transparência e sem border-radius nosso.
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#4f46e5",
        }}
      >
        <span style={{ fontSize: 100, fontWeight: 700, color: "white", fontFamily: "system-ui, sans-serif" }}>C</span>
      </div>
    ),
    { ...size },
  );
}
