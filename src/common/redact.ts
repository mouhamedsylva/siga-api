/**
 * Masquage des données sensibles avant journalisation (§12).
 * Un numéro "221771234567" devient "2217*****67".
 */
export function maskPhone(waId: string | null | undefined): string {
  if (!waId) return '-';
  if (waId.length <= 6) return '***';
  return `${waId.slice(0, 4)}${'*'.repeat(waId.length - 6)}${waId.slice(-2)}`;
}

const PHONE_RE = /\+?\d[\d\s]{7,}\d/g;

/** Masque toute suite de chiffres ressemblant à un numéro dans un texte libre. */
export function redactText(text: string): string {
  return text.replace(PHONE_RE, (m) => maskPhone(m.replace(/\s/g, '')));
}
