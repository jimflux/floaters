import { createApiClient } from '@floaters/mcp-tools';

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

export const { get: apiGet, write: apiWrite } = createApiClient(getConfig);
