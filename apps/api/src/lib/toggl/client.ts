import Bottleneck from "bottleneck";

// Toggl Track API v9. Auth is HTTP Basic with the personal API token as the
// username and the literal string "api_token" as the password. The token is
// configuration (TOGGL_API_TOKEN), never stored in the database: with no
// token, time tracking simply reports itself unconfigured.
export const TOGGL_API_BASE = "https://api.track.toggl.com/api/v9";

// Toggl asks for roughly one request per second per token.
const limiter = new Bottleneck({ maxConcurrent: 1, minTime: 1100 });

export function togglToken(): string | null {
  const token = process.env.TOGGL_API_TOKEN?.trim();
  return token ? token : null;
}

export function isTogglConfigured(): boolean {
  return togglToken() !== null;
}

// The IANA zone entries are bucketed into local days/months by.
export const DEFAULT_TIME_ZONE = "Europe/London";

export function togglTimeZone(): string {
  return process.env.TOGGL_TIMEZONE?.trim() || DEFAULT_TIME_ZONE;
}

export function togglAuthHeader(token: string): string {
  return `Basic ${Buffer.from(`${token}:api_token`).toString("base64")}`;
}

export async function togglRequest<T>(
  path: string,
  params?: Record<string, string | number | boolean | undefined>
): Promise<T> {
  const token = togglToken();
  if (!token) throw new Error("TOGGL_API_TOKEN is not set");

  const url = new URL(`${TOGGL_API_BASE}${path}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  return limiter.schedule(async () => {
    const response = await fetch(url.toString(), {
      headers: {
        Authorization: togglAuthHeader(token),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Toggl API error (${response.status}) on ${path}: ${text}`.trim());
    }
    return (await response.json()) as T;
  });
}
