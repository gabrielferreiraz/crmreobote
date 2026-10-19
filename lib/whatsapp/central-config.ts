export function centralLeadsEnabled(): boolean {
  return process.env.CENTRAL_LEADS_ENABLED?.trim().toLowerCase() === "true";
}
