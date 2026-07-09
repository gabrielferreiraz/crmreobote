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
