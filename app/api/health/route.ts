import { NextResponse } from "next/server";
import fs from "fs";

export const dynamic = "force-dynamic";

export async function GET() {
  // Só existe dentro da imagem Docker (ver Dockerfile) — em dev local o
  // arquivo não existe, e tudo bem, cai no null.
  let builtAt: string | null = null;
  try {
    builtAt = fs.readFileSync("/app/BUILD_TIME.txt", "utf8").trim();
  } catch {
    builtAt = null;
  }

  return NextResponse.json({ ok: true, builtAt });
}
