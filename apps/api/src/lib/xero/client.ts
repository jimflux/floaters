import Bottleneck from "bottleneck";
import { getValidAccessToken } from "./auth";

// Xero rate limit: 60 calls/minute per tenant
const limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 1100, // ~54 calls/min, safe margin
});

interface XeroRequestOptions {
  connectionId: string;
  endpoint: string;
  method?: "GET" | "POST" | "PUT";
  params?: Record<string, string>;
  body?: unknown;
}

export async function xeroRequest<T>(options: XeroRequestOptions): Promise<T> {
  const { connectionId, endpoint, method = "GET", params, body } = options;
  const { accessToken, tenantId } = await getValidAccessToken(connectionId);

  const url = new URL(`https://api.xero.com/api.xro/2.0/${endpoint}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  const result = await limiter.schedule(async () => {
    const response = await fetch(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Xero-Tenant-Id": tenantId,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(
        `Xero API error (${response.status}): ${error}`
      );
    }

    return response.json();
  });

  return result as T;
}

export async function xeroRequestPaginated<T>(
  connectionId: string,
  endpoint: string,
  responseKey: string,
  params?: Record<string, string>
): Promise<T[]> {
  const allResults: T[] = [];
  let page = 1;

  while (true) {
    const response = await xeroRequest<Record<string, T[]>>({
      connectionId,
      endpoint,
      params: { ...params, page: String(page) },
    });

    const items = response[responseKey] || [];
    allResults.push(...items);

    // Xero returns max 100 per page
    if (items.length < 100) break;
    page++;
  }

  return allResults;
}
