/**
 * Confere os primeiros bytes do arquivo contra a assinatura conhecida do
 * formato — sem isso, o whitelist de Content-Type em lib/r2.ts confiava só
 * no que o cliente declarou (`file.type`), que é só metadado e não garante
 * nada sobre o conteúdo real do arquivo.
 */
function matchesBytes(buffer: Buffer, offset: number, bytes: number[]): boolean {
  if (buffer.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buffer[offset + i] === b);
}

function matchesAscii(buffer: Buffer, offset: number, text: string): boolean {
  return matchesBytes(buffer, offset, Array.from(text, (c) => c.charCodeAt(0)));
}

// MP3 sem tag ID3 começa direto no frame sync: byte 0 = 0xFF, byte 1 com os
// 3 bits mais altos setados (0xE0) — não dá pra checar bytes fixos exatos.
function isMpegFrameSync(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
}

const SIGNATURE_CHECKS: Record<string, (buffer: Buffer) => boolean> = {
  "image/jpeg": (b) => matchesBytes(b, 0, [0xff, 0xd8, 0xff]),
  "image/png": (b) => matchesBytes(b, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/webp": (b) => matchesAscii(b, 0, "RIFF") && matchesAscii(b, 8, "WEBP"),
  "image/gif": (b) => matchesAscii(b, 0, "GIF87a") || matchesAscii(b, 0, "GIF89a"),
  "audio/webm": (b) => matchesBytes(b, 0, [0x1a, 0x45, 0xdf, 0xa3]),
  "audio/ogg": (b) => matchesAscii(b, 0, "OggS"),
  "audio/mpeg": (b) => matchesAscii(b, 0, "ID3") || isMpegFrameSync(b),
  "audio/mp4": (b) => matchesAscii(b, 4, "ftyp"),
  "audio/wav": (b) => matchesAscii(b, 0, "RIFF") && matchesAscii(b, 8, "WAVE"),
};

/** `contentType` já deve vir sem parâmetros (ex.: sem "; codecs=opus") — ver baseContentType em lib/r2.ts. */
export function matchesFileSignature(buffer: Buffer, contentType: string): boolean {
  const check = SIGNATURE_CHECKS[contentType];
  // Tipo sem checagem cadastrada aqui: nunca deixa passar por omissão — toda
  // entrada em ALLOWED_TYPES/CHAT_MEDIA_ALLOWED_TYPES (lib/r2.ts) precisa ter
  // uma checagem correspondente neste Record.
  if (!check) return false;
  return check(buffer);
}
