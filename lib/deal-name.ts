export function buildDealName(contactName: string, source?: string | null) {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(now.getFullYear()).slice(-2);
  const suffix = source ? ` ${source.toUpperCase()}` : "";
  return `${mm}/${yy} - ${contactName}${suffix}`;
}
