import { TriangleAlert, Unplug } from "lucide-react";
import { PAUSE_REASON, type PauseReason } from "@/lib/campaigns/pause-reasons";

type PauseInstance = {
  ownerName: string;
  status: "DISCONNECTED" | "CONNECTING" | "CONNECTED";
  disconnectedAt: Date | null;
} | null;

function since(date: Date | null): string {
  if (!date) return "";
  return ` desde ${date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Campo_Grande" })}`;
}

/**
 * Campanha ainda "Rodando" com o WhatsApp fora do ar. O motor só pausa quando há um
 * ENVIO a fazer — uma campanha que só espera o prazo de um reenvio fica assim sem
 * mandar nada — então este aviso cobre esse meio-tempo, pra ninguém achar que o
 * envio está normal. Ver lib/campaigns/instance-guard.ts.
 */
export function OfflineNotice({ ownerName, disconnectedAt }: { ownerName: string; disconnectedAt: Date | null }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-500/10 dark:text-amber-300">
      <Unplug className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
      <span>
        <strong>WhatsApp desconectado.</strong> O WhatsApp de <strong>{ownerName}</strong> caiu{since(disconnectedAt)}. Nada é enviado enquanto isso
        e nenhum contato da fila é perdido: a campanha pausa sozinha na próxima tentativa de envio e volta a enviar assim que ele reconectar
        (Configurações → Perfil → WhatsApp).
      </span>
    </div>
  );
}

/**
 * Aviso no topo da campanha PAUSADA pelo próprio motor (Campaign.pausedReason):
 * por que parou, se volta sozinha e o que fazer. Sem isso a pessoa só via
 * "Pausada" e não tinha como saber que ninguém tinha clicado — foi assim que
 * uma campanha ficou dias parada/queimando leads sem ninguém entender por quê.
 * Só aparece com motivo automático: pausa manual não tem aviso.
 */
export function PausedNotice({ reason, instance, canManage }: { reason: PauseReason; instance: PauseInstance; canManage: boolean }) {
  const owner = instance?.ownerName ?? "quem usa esta campanha";
  const resumeByHand = canManage ? "confira e clique em Retomar quando estiver tudo certo" : "quem gerencia a campanha decide quando retomar";

  let Icon = TriangleAlert;
  let body: React.ReactNode;

  if (reason === PAUSE_REASON.WHATSAPP_DISCONNECTED) {
    Icon = Unplug;
    body =
      instance?.status === "CONNECTED" ? (
        <>
          O WhatsApp de <strong>{owner}</strong> reconectou — a campanha volta a enviar sozinha em instantes.
        </>
      ) : (
        <>
          O WhatsApp de <strong>{owner}</strong> está desconectado{since(instance?.disconnectedAt ?? null)}. A campanha volta a enviar{" "}
          <strong>sozinha</strong> assim que ele reconectar (Configurações → Perfil → WhatsApp) — não precisa clicar em Retomar. Enquanto isso, nenhum
          contato da fila é consumido.
          {canManage && " Se não quiser que ela volte sozinha, use “Manter pausada”."}
        </>
      );
  } else if (reason === PAUSE_REASON.WHATSAPP_INSTABILITY) {
    body = (
      <>
        O WhatsApp de <strong>{owner}</strong> caiu 3 vezes ou mais em 7 dias — sinal de risco de banimento do número. Por segurança ela{" "}
        <strong>não</strong> volta sozinha: {resumeByHand}.
      </>
    );
  } else {
    body = (
      <>
        Depois de 5 falhas de envio seguidas. Veja o motivo na coluna de erro dos destinatários, resolva (por exemplo, reconectar o WhatsApp) e{" "}
        {resumeByHand}. Ela <strong>não</strong> volta sozinha.
      </>
    );
  }

  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-500/10 dark:text-amber-300">
      <Icon className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
      <span>
        <strong>Pausada automaticamente.</strong> {body}
      </span>
    </div>
  );
}
