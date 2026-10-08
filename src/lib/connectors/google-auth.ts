import "server-only";
import { createSign } from "node:crypto";

/**
 * Google sign-in for server-to-server access with a service account (a robot
 * login that only has the access you give it). The key lives in the
 * GOOGLE_SERVICE_ACCOUNT_KEY environment variable and never reaches the
 * browser. Signs a JWT with Node's crypto and swaps it for an access token.
 */

export interface ServiceAccount {
  client_email: string;
  private_key: string;
}

/** The service account from the environment: raw JSON or base64 of it. Null if not set or unreadable. */
export function serviceAccount(): ServiceAccount | null {
  const raw = (process.env.GOOGLE_SERVICE_ACCOUNT_KEY ?? "").trim();
  if (!raw) return null;
  const tryParse = (s: string) => {
    try {
      const v = JSON.parse(s) as Partial<ServiceAccount>;
      return v.client_email && v.private_key ? { client_email: v.client_email, private_key: v.private_key.replace(/\\n/g, "\n") } : null;
    } catch {
      return null;
    }
  };
  return tryParse(raw) ?? tryParse(Buffer.from(raw, "base64").toString("utf8"));
}

export const googleConfigured = () => serviceAccount() !== null;

/** The email to add in GA4 (not secret: it is only an identity, the key stays server-side). */
export const serviceAccountEmail = () => serviceAccount()?.client_email ?? null;

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

/** A signed JWT asking for an access token (exported for tests). */
export function signedAssertion(sa: ServiceAccount, scope: string, now = Math.floor(Date.now() / 1000)): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({ iss: sa.client_email, scope, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${b64url(signer.sign(sa.private_key))}`;
}

const cache = new Map<string, { token: string; expires: number }>();

export class GoogleAuthError extends Error {}

export async function googleAccessToken(scope: string): Promise<string> {
  const sa = serviceAccount();
  if (!sa) throw new GoogleAuthError("GOOGLE_SERVICE_ACCOUNT_KEY is not set, or is not the JSON key file from Google Cloud.");
  const hit = cache.get(scope);
  if (hit && hit.expires > Date.now() + 60_000) return hit.token;
  let assertion: string;
  try {
    assertion = signedAssertion(sa, scope);
  } catch {
    throw new GoogleAuthError("The Google service account key could not be read. Paste the whole JSON key file into GOOGLE_SERVICE_ACCOUNT_KEY.");
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !json.access_token) {
    throw new GoogleAuthError(`Google sign-in failed: ${json.error_description ?? res.statusText}. Check the service account key.`);
  }
  cache.set(scope, { token: json.access_token, expires: Date.now() + (json.expires_in ?? 3600) * 1000 });
  return json.access_token;
}
