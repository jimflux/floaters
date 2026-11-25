export type ApiParams = Record<string, string | number | string[] | undefined>;
export type ApiGet = <T = unknown>(path: string, params?: ApiParams) => Promise<T>;
export type ApiWrite = <T = unknown>(path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown, params?: ApiParams) => Promise<T>;

/** Both MCP transports reuse the authenticated application API, never the DB. */
export function createApiClient(config: () => { base: string; key: string }) {
  async function request<T>(path: string, method: string, body?: unknown, params?: ApiParams): Promise<T> {
    const { base, key } = config();
    const url = new URL(base.replace(/\/$/, '') + path);
    for (const [name, value] of Object.entries(params ?? {})) {
      for (const item of Array.isArray(value) ? value : [value]) {
        if (item !== undefined && item !== '') url.searchParams.append(name, String(item));
      }
    }
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${key}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: 'no-store',
      redirect: 'error',
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`${method} ${path} failed: ${res.status} ${res.statusText} ${detail}`.trim());
    }
    return await res.json() as T;
  }
  const get: ApiGet = (path, params) => request(path, 'GET', undefined, params);
  const write: ApiWrite = (path, method, body, params) => request(path, method, body, params);
  return { get, write };
}
