import { timingSafeEqual } from "node:crypto";

/** Vercel Cron sends "Authorization: Bearer <CRON_SECRET>". No secret set means nobody can call it. */
export function cronAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 16 || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
