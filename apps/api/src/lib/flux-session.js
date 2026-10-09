// Signed values for Flux sign-in. login.flux.am and each private tool copy
// this file unchanged. Keep the copies identical.
//
// Value: base64url(JSON claims) + "." + base64url(HMAC-SHA256(secret, payload))
// Claims always carry `typ` (what the value is for) and `exp` (unix seconds).
import { createHmac, timingSafeEqual } from 'node:crypto';

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const mac = (secret, payload) => createHmac('sha256', secret).update(payload).digest();
const B64URL = /^[A-Za-z0-9_-]+$/;

/** Signs `claims` (which must include typ and exp). */
export function sign(secret, claims) {
  const payload = b64(JSON.stringify(claims));
  return `${payload}.${b64(mac(secret, payload))}`;
}

/** Returns the claims if `value` is signed with `secret`, has this `typ` and hasn't expired. Otherwise null. */
export function verify(secret, value, typ) {
  if (!secret || typeof value !== 'string') return null;
  const parts = value.split('.');
  if (parts.length !== 2 || !B64URL.test(parts[0]) || !B64URL.test(parts[1])) return null;
  const [payload, sig] = parts;
  const expected = mac(secret, payload);
  const given = Buffer.from(sig, 'base64url');
  // Re-encoding must match exactly, so there's one valid spelling of each signature.
  if (given.length !== expected.length || b64(given) !== sig || !timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!claims || claims.typ !== typ || typeof claims.exp !== 'number') return null;
    if (claims.exp * 1000 < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

/** Every value of cookie `name` on the request. Bad encodings are skipped, not thrown. */
export function readCookies(req, name) {
  const values = [];
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0 || part.slice(0, i).trim() !== name) continue;
    try {
      values.push(decodeURIComponent(part.slice(i + 1).trim()));
    } catch {
      // Ignore it; another value may still be good.
    }
  }
  return values;
}

/** The first value of cookie `name` that verifies, as claims, or null. */
export function cookieClaims(req, name, secret, typ) {
  for (const value of readCookies(req, name)) {
    const claims = verify(secret, value, typ);
    if (claims) return claims;
  }
  return null;
}

export const nowSeconds = () => Math.floor(Date.now() / 1000);
