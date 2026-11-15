import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Empreinte d'une référence de transaction (§9) : HMAC et non simple hash,
 * car une référence courte se retrouve par essais successifs.
 * La référence doit déjà être normalisée.
 */
export function refFingerprint(normalizedRef: string, secret: string): string {
  return createHmac('sha256', secret).update(normalizedRef).digest('hex');
}

/**
 * Clé d'idempotence d'un événement Meta. On stocke un SHA-256 hexadécimal :
 * la collation MySQL par défaut ignore la casse, alors que les wamid y sont sensibles.
 */
export function eventKey(wamid: string): string {
  return createHash('sha256').update(wamid).digest('hex');
}

/** Comparaison en temps constant de deux chaînes. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
