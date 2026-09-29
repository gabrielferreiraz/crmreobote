/** Limits shared by the preview and the final Contacts import. */
export const MAX_CONTACT_IMPORT_ROWS = 20_000;
export const MAX_CONTACT_IMPORT_FILE_SIZE_BYTES = 5 * 1024 * 1024;

// Keeps every INSERT well below PostgreSQL's parameter limit.
export const CONTACT_IMPORT_WRITE_CHUNK_SIZE = 1_000;
export const CONTACT_IMPORT_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 60_000 } as const;
