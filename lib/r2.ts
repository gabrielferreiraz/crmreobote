import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "crypto";

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const BUCKET_NAME = process.env.R2_BUCKET_NAME;

const client = new S3Client({
  region: "auto",
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1h

export class AvatarUploadError extends Error {}

export function assertValidAvatar(contentType: string, size: number) {
  if (!ALLOWED_TYPES.has(contentType)) {
    throw new AvatarUploadError("Formato inválido. Envie um JPEG, PNG ou WebP.");
  }
  if (size > MAX_SIZE) {
    throw new AvatarUploadError("Arquivo maior que 10MB.");
  }
}

/** Chave R2 imprevisível — nem o userId nem sequência são adivinháveis a partir dela. */
export function buildAvatarKey(userId: string, contentType: string) {
  const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  const random = crypto.randomBytes(16).toString("hex");
  return `avatars/${userId}/${random}.${ext}`;
}

export async function uploadAvatar(key: string, body: Buffer, contentType: string) {
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function deleteAvatar(key: string) {
  await client.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
}

/**
 * `image` no banco guarda ou uma URL externa completa (foto de perfil do Google, por
 * exemplo) ou uma chave interna do R2 (sempre iniciando com "avatars/"). URLs externas
 * são retornadas como estão; chaves do R2 viram uma URL assinada de curta duração,
 * já que o bucket é privado.
 */
export async function resolveAvatarUrl(image: string | null | undefined): Promise<string | null> {
  if (!image) return null;
  if (!image.startsWith("avatars/")) return image;

  return getSignedUrl(client, new GetObjectCommand({ Bucket: BUCKET_NAME, Key: image }), {
    expiresIn: SIGNED_URL_TTL_SECONDS,
  });
}

/** Resolve várias imagens de uma vez, sem assinar a mesma chave repetida. */
export async function resolveAvatarUrlMap(
  images: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(images.filter((v): v is string => !!v)));
  const resolved = await Promise.all(unique.map((img) => resolveAvatarUrl(img)));
  const map = new Map<string, string>();
  unique.forEach((img, i) => {
    const url = resolved[i];
    if (url) map.set(img, url);
  });
  return map;
}

// ─── Mídia de chat do WhatsApp (imagem/áudio enviados pelo composer) ────────

const CHAT_MEDIA_ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
};
const CHAT_MEDIA_MAX_SIZE = 16 * 1024 * 1024; // 16MB — mesmo teto que o próprio WhatsApp aplica

export class ChatMediaUploadError extends Error {}

// Mídia recebida do WhatsApp vem com parâmetros no content-type (ex.:
// "audio/ogg; codecs=opus") — a lista de permitidos é por tipo base, sem os
// parâmetros, senão nunca bate com a chave exata do Record acima.
function baseContentType(contentType: string): string {
  return contentType.split(";")[0].trim();
}

export function assertValidChatMedia(contentType: string, size: number) {
  if (!(baseContentType(contentType) in CHAT_MEDIA_ALLOWED_TYPES)) {
    throw new ChatMediaUploadError(`Formato "${contentType}" não suportado.`);
  }
  if (size > CHAT_MEDIA_MAX_SIZE) {
    throw new ChatMediaUploadError("Arquivo maior que 16MB.");
  }
}

/** Chave R2 imprevisível, namespaced por organização — nunca revela o contato/negócio a partir dela. */
export function buildChatMediaKey(organizationId: string, contentType: string) {
  const ext = CHAT_MEDIA_ALLOWED_TYPES[baseContentType(contentType)] ?? "bin";
  const random = crypto.randomBytes(16).toString("hex");
  return `whatsapp-media/${organizationId}/${random}.${ext}`;
}

export async function uploadChatMedia(key: string, body: Buffer, contentType: string) {
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function deleteChatMedia(key: string) {
  await client.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
}

/**
 * `mediaUrl` no banco guarda ou uma chave interna do R2 ("whatsapp-media/...")
 * ou, por retrocompatibilidade, uma URL externa completa — mesma convenção do
 * `resolveAvatarUrl`. A URL assinada tem TTL curto porque só precisa valer o
 * suficiente pro Evolution baixar a mídia na hora do envio, ou pro navegador
 * carregar a mensagem enquanto o chat está aberto.
 */
export async function resolveChatMediaUrl(mediaUrl: string | null | undefined): Promise<string | null> {
  if (!mediaUrl) return null;
  if (!mediaUrl.startsWith("whatsapp-media/")) return mediaUrl;

  return getSignedUrl(client, new GetObjectCommand({ Bucket: BUCKET_NAME, Key: mediaUrl }), {
    expiresIn: SIGNED_URL_TTL_SECONDS,
  });
}

/**
 * Baixa o objeto direto do R2 (sem URL assinada) — usado pelo proxy em
 * app/api/whatsapp/media-file, que existe porque o Evolution acrescenta um
 * "?timestamp=" na URL antes de baixar a mídia (visto no código-fonte dele,
 * em mais de um lugar), o que invalida a assinatura de uma URL de
 * query-string e o R2 responde 403. Um caminho sem autenticação por
 * query-string não tem esse problema: o parâmetro extra é só ignorado.
 */
export async function getChatMediaObject(key: string): Promise<{ body: Uint8Array; contentType: string } | null> {
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key }));
    const body = await res.Body?.transformToByteArray();
    if (!body) return null;
    return { body, contentType: res.ContentType ?? "application/octet-stream" };
  } catch {
    return null;
  }
}
