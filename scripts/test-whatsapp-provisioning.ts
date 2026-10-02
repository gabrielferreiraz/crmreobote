import assert from "node:assert/strict";
import test from "node:test";
import {
  provisionEvolutionConnection,
  type ProvisionDependencies,
} from "../lib/whatsapp/provision-evolution.ts";

const missingError = new Error("missing");

function dependencies(overrides: Partial<ProvisionDependencies> = {}): ProvisionDependencies {
  return {
    create: async () => undefined,
    getState: async () => "connecting",
    getQrCode: async () => ({ base64: "data:image/png;base64,qr" }),
    isMissingInstance: (error) => error === missingError,
    delay: async () => undefined,
    ...overrides,
  };
}

test("instância nova é criada uma vez e fica aguardando o QR", async () => {
  let creations = 0;
  const result = await provisionEvolutionConnection(
    true,
    dependencies({ create: async () => void (creations += 1) }),
  );

  assert.equal(creations, 1);
  assert.equal(result.status, "CONNECTING");
  assert.equal(result.recoveredAfterAmbiguousFailure, false);
});

test("instância já conectada não solicita outro QR", async () => {
  let qrRequests = 0;
  const result = await provisionEvolutionConnection(
    false,
    dependencies({
      getState: async () => "open",
      getQrCode: async () => {
        qrRequests += 1;
        return {};
      },
    }),
  );

  assert.equal(qrRequests, 0);
  assert.equal(result.status, "CONNECTED");
});

test("registro local sem instância na Evolution recria usando o mesmo vínculo", async () => {
  let creations = 0;
  const result = await provisionEvolutionConnection(
    false,
    dependencies({
      getState: async () => {
        throw missingError;
      },
      create: async () => void (creations += 1),
    }),
  );

  assert.equal(creations, 1);
  assert.equal(result.status, "CONNECTING");
});

test("timeout de criação é recuperado quando o QR apareceu depois", async () => {
  const timeout = new Error("timeout");
  const result = await provisionEvolutionConnection(
    true,
    dependencies({
      create: async () => {
        throw timeout;
      },
      getQrCode: async () => ({ base64: "data:image/png;base64,qr" }),
    }),
  );

  assert.equal(result.status, "CONNECTING");
  assert.equal(result.recoveredAfterAmbiguousFailure, true);
  assert.equal(result.error, undefined);
});

test("falha confirmada libera nova tentativa sem apagar o vínculo", async () => {
  const timeout = new Error("timeout");
  const result = await provisionEvolutionConnection(
    true,
    dependencies({
      create: async () => {
        throw timeout;
      },
      getQrCode: async () => {
        throw missingError;
      },
    }),
  );

  assert.equal(result.status, "DISCONNECTED");
  assert.equal(result.error, timeout);
});
