// Thin read-only HTTP client over the Floaters API. The MCP server never talks
// to the database directly — it reuses the API's GET endpoints (and therefore
// the exact same cashflow/forecast computation), which keeps it both DRY and
// inherently read-only.

const RAW_BASE = process.env.FLOATERS_API_URL;
const API_KEY = process.env.FLOATERS_API_KEY;

export function getConfig(): { base: string; key: string } {
  if (!RAW_BASE) {
    throw new Error(
      "FLOATERS_API_URL is not set. Point it at the Floaters API (e.g. https://api.floaters.flux.am)."
    );
  }
  if (!API_KEY) {
    throw new Error(
      "FLOATERS_API_KEY is not set. Use the API's CONNECT_SECRET value."
    );
  }
  return { base: RAW_BASE.replace(/\/$/, ""), key: API_KEY };
}

export async function apiGet<T = unknown>(
  path: string,
  params?: Record<string, string | number | undefined>
): Promise<T> {
  const { base, key } = getConfig();
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${key}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GET ${path} failed: ${res.status} ${res.statusText} ${body}`.trim());
  }
  return (await res.json()) as T;
}
