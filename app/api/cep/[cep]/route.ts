import { NextResponse } from "next/server";
import { fetchCepAddress, onlyCepDigits } from "@/lib/cep";
import { requireSession } from "@/lib/require-session";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: RouteContext<"/api/cep/[cep]">) {
  const { organizationId } = await requireSession();
  if (!organizationId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { cep } = await ctx.params;
  const digits = onlyCepDigits(cep);
  if (digits.length !== 8) return NextResponse.json({ error: "CEP inválido" }, { status: 400 });

  try {
    const address = await fetchCepAddress(digits);
    if (!address) return NextResponse.json({ error: "CEP não encontrado" }, { status: 404 });
    return NextResponse.json(address);
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === "AbortError";
    return NextResponse.json(
      { error: aborted ? "Consulta de CEP demorou demais" : "Não foi possível consultar o CEP" },
      { status: 502 },
    );
  }
}
