export type ProvisionedStatus = "DISCONNECTED" | "CONNECTING" | "CONNECTED";

type ConnectionState = "open" | "close" | "connecting";
type QrCodeResult = { base64?: string; pairingCode?: string };

export type ProvisionDependencies = {
  create: () => Promise<void>;
  getState: () => Promise<ConnectionState>;
  getQrCode: () => Promise<QrCodeResult>;
  isMissingInstance: (error: unknown) => boolean;
  delay: (milliseconds: number) => Promise<void>;
};

export type ProvisionResult = {
  status: ProvisionedStatus;
  recoveredAfterAmbiguousFailure: boolean;
  error?: unknown;
};

/**
 * Decide como preparar uma instância sem conhecer banco, HTTP ou Next.js.
 * O ponto importante é nunca concluir que um timeout cancelou a criação:
 * primeiro tenta ler o QR usando o mesmo nome, evitando instâncias órfãs.
 */
export async function provisionEvolutionConnection(
  created: boolean,
  dependencies: ProvisionDependencies,
): Promise<ProvisionResult> {
  try {
    if (created) {
      await dependencies.create();
      return { status: "CONNECTING", recoveredAfterAmbiguousFailure: false };
    }

    try {
      const state = await dependencies.getState();
      if (state === "open") {
        return { status: "CONNECTED", recoveredAfterAmbiguousFailure: false };
      }
      await dependencies.getQrCode();
    } catch (error) {
      if (!dependencies.isMissingInstance(error)) throw error;
      await dependencies.create();
    }

    return { status: "CONNECTING", recoveredAfterAmbiguousFailure: false };
  } catch (error) {
    await dependencies.delay(1_500);
    try {
      const qr = await dependencies.getQrCode();
      if (qr.base64 || qr.pairingCode) {
        return { status: "CONNECTING", recoveredAfterAmbiguousFailure: true };
      }
    } catch {
      // O erro original é preservado abaixo para o diagnóstico do servidor.
    }

    return { status: "DISCONNECTED", recoveredAfterAmbiguousFailure: false, error };
  }
}
