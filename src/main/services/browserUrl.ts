const DEFAULT_URL = "https://duckduckgo.com/";

export function normalizeBrowserInput(value: unknown): string {
  const input = typeof value === "string" ? value.trim() : "";
  if (input.length === 0) return DEFAULT_URL;
  const direct = input.includes("://")
    ? input
    : !input.includes(" ") && input.includes(".")
      ? `https://${input}`
      : null;
  if (direct && isAllowedBrowserUrl(direct)) return new URL(direct).toString();
  return `https://duckduckgo.com/?q=${encodeURIComponent(input)}`;
}

export function isAllowedBrowserUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
