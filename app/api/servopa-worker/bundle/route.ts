import { buildServopaWorkerBundleZip } from "@/lib/servopa-tables/worker-bundle";
import { requireServopaWorkerRoute, servopaWorkerJson } from "@/lib/servopa-tables/worker-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Código atual do robô (lista fixa de arquivos de `worker/`), para instalar e se atualizar sozinho. */
export async function GET(req: Request) {
  const auth = await requireServopaWorkerRoute(req, "bundle");
  if (!auth.ok) return auth.response;

  try {
    const bundle = await buildServopaWorkerBundleZip();
    const body = new ArrayBuffer(bundle.archive.byteLength);
    new Uint8Array(body).set(bundle.archive);
    return new Response(body, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/zip",
        "Content-Length": String(bundle.archive.byteLength),
        "X-Servopa-App-Version": bundle.version,
        "X-Servopa-Bundle-Sha256": bundle.sha256,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[servopa-worker-bundle] falha ao montar pacote", error);
    return servopaWorkerJson({ error: "Não foi possível preparar a atualização do robô." }, 500);
  }
}
