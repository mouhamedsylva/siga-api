import { createHmac } from 'node:crypto';
import { safeEqual } from '../common/hmac.util';

/**
 * Vérifie l'en-tête X-Hub-Signature-256 ("sha256=<hex>") calculé par Meta
 * sur le corps brut avec le secret de l'application.
 */
export function isValidSignature(
  rawBody: Buffer | undefined,
  header: string | undefined,
  appSecret: string,
): boolean {
  if (!rawBody || !header || !header.startsWith('sha256=')) return false;
  const expected =
    'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex');
  return safeEqual(header, expected);
}
