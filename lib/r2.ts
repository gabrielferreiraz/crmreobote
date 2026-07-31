import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "crypto";
import sharp from "sharp";
import { matchesFileSignature } from "@/lib/file-signature";

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

export function assertValidAvatar(contentType: string, size: number, buffer: Buffer) {
  if (!ALLOWED_TYPES.has(contentType)) {
    throw new AvatarUploadError("Formato inválido. Envie um JPEG, PNG ou WebP.");
  }
  if (size > MAX_SIZE) {
    throw new AvatarUploadError("Arquivo maior que 10MB.");
  }
  // `contentType` é só o que o cliente declarou (metadado, não garante nada
  // sobre o conteúdo) — confere os bytes de verdade contra a assinatura do
  // formato antes de aceitar.
  if (!matchesFileSignature(buffer, contentType)) {
    throw new AvatarUploadError("O conteúdo do arquivo não corresponde ao formato declarado.");
  }
}

// Maior que qualquer tamanho de exibição real (o maior Avatar hoje é "xl",
// 96px de CSS) mas com folga pra tela retina/2x-3x — sem redimensionar,
// uma foto de celular de vários MB era guardada e baixada inteira toda vez
// só pra aparecer como um círculo de 24-96px.
const AVATAR_MAX_DIMENSION = 512;

/**
 * Redimensiona e recomprime antes de subir pro R2 — feito uma vez no upload,
 * não a cada visualização (diferente de next/image, que exigiria expor o
 * bucket privado por trás de remotePatterns e perderia o cache do otimizador
 * de qualquer forma, já que cada URL assinada muda a cada resolução). Mantém
 * o formato original (PNG preserva transparência de logo/marca-d'água, se
 * for o caso) só encolhendo dimensão/qualidade.
 */
export async function resizeAvatar(buffer: Buffer, contentType: string): Promise<Buffer> {
  const resized = sharp(buffer)
    .rotate() // aplica a orientação EXIF antes de cortar — sem isso, foto de celular vertical podia sair deitada
    .resize({ width: AVATAR_MAX_DIMENSION, height: AVATAR_MAX_DIMENSION, fit: "cover", withoutEnlargement: true });

  if (contentType === "image/png") return resized.png({ compressionLevel: 8 }).toBuffer();
  if (contentType === "image/webp") return resized.webp({ quality: 82 }).toBuffer();
  return resized.jpeg({ quality: 82, mozjpeg: true }).toBuffer();
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

export function assertValidChatMedia(contentType: string, size: number, buffer: Buffer) {
  const base = baseContentType(contentType);
  if (!(base in CHAT_MEDIA_ALLOWED_TYPES)) {
    throw new ChatMediaUploadError(`Formato "${contentType}" não suportado.`);
  }
  if (size > CHAT_MEDIA_MAX_SIZE) {
    throw new ChatMediaUploadError("Arquivo maior que 16MB.");
  }
  // Mesma ideia do assertValidAvatar: contentType é só o que o cliente
  // declarou, confere contra os bytes reais antes de aceitar.
  if (!matchesFileSignature(buffer, base)) {
    throw new ChatMediaUploadError("O conteúdo do arquivo não corresponde ao formato declarado.");
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
