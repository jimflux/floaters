import { clearCachedData } from './cache';

// Sign-in is login.flux.am. The API sets a session cookie at /auth/callback;
// when it answers 401 the app sends Jim to sign in, then back to this page.

export const LOGIN_URL = 'https://login.flux.am/';
export const LOGOUT_PATH = '/auth/logout';
const REDIRECT_KEY = 'floaters.signInRedirectAt';
const REDIRECT_GAP_MS = 60_000;

export class SignInRequiredError extends Error {
  constructor() {
    super('You need to sign in again.');
    this.name = 'SignInRequiredError';
  }
}

export function loginUrl(next: string = window.location.href): string {
  return `${LOGIN_URL}?next=${encodeURIComponent(next)}`;
}

/** Returns false if the browser wouldn't store it (Safari private mode can throw). */
function saveGuard(value: string | null): boolean {
  try {
    if (value === null) sessionStorage.removeItem(REDIRECT_KEY);
    else sessionStorage.setItem(REDIRECT_KEY, value);
    return true;
  } catch {
    return false;
  }
}

function lastRedirect(): number {
  try { return Number(sessionStorage.getItem(REDIRECT_KEY)) || 0; } catch { return 0; }
}

/** A request got through, so the next 401 may redirect straight away. */
export function clearSignInGuard(): void {
  saveGuard(null);
}

/**
 * Handles a 401. Redirects to login.flux.am unless it did so in the last minute
 * (sign-in isn't working, so another redirect would loop) or the guard can't be
 * stored (it couldn't stop a loop). In those cases it rejects with
 * SignInRequiredError and the page shows a sign-in link instead.
 */
export function handleUnauthorised(): Promise<never> {
  clearCachedData();
  const now = Date.now();
  if (now - lastRedirect() > REDIRECT_GAP_MS && saveGuard(String(now))) {
    window.location.assign(loginUrl());
    // Leave the page loading while the browser navigates away.
    return new Promise<never>(() => {});
  }
  return Promise.reject(new SignInRequiredError());
}
