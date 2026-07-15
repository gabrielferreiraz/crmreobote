import { ImageResponse } from "next/og";

const BRAND_BG = "#4f46e5";

/**
 * Gera os PNGs de ícone do manifest (192, 512, 512 maskable) a partir do
 * mesmo desenho do app/icon.svg — sem precisar guardar vários PNGs no
 * repo. O "maskable" fica sem borda arredondada e sem respiro extra além
 * do safe-zone, porque o SO já aplica a própria máscara por cima.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size } = await params;
  const maskable = size.endsWith("-maskable");
  const px = Number(maskable ? size.replace("-maskable", "") : size) || 512;
  const glyphSize = maskable ? px * 0.42 : px * 0.55;
  const radius = maskable ? 0 : px * 0.22;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: BRAND_BG,
          borderRadius: radius,
        }}
      >
        <span
          style={{
            fontSize: glyphSize,
            fontWeight: 700,
            color: "white",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          C
        </span>
      </div>
    ),
    { width: px, height: px },
  );
}
