export const MAX_CARD_COVER_PHOTOS = 4;

/**
 * `DigitalCard.coverPhotoKey` nasceu como uma unica chave e hoje tambem
 * aceita um carrossel, armazenado como chaves separadas por virgula. Manter
 * essa normalizacao em um unico lugar evita enviar a string inteira ao R2
 * como se fosse o nome de um unico objeto.
 */
export function parseCardCoverPhotoKeys(value: string | null | undefined): string[] {
  return value
    ? value
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean)
    : [];
}
