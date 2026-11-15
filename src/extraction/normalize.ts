/**
 * Normalisation des champs extraits (EF-22) :
 * montants en FCFA entiers, références sans espaces ni casse, dates en Africa/Dakar.
 */

/**
 * "15.000F", "15 000 FCFA", "10000.00", "15,000" → 15000.
 * Un séparateur suivi de 1 ou 2 chiffres en fin de nombre est une partie décimale
 * (le FCFA n'a pas de centimes : elle est ignorée) ; sinon c'est un séparateur de milliers.
 */
export function parseAmount(raw: string | null | undefined): number | null {
  if (!raw) return null;
  let s = raw
    .replace(/f\s*cfa|xof|fcfa|f\b/gi, '')
    .replace(/[\s\u00a0\u202f]/g, '');
  s = s.replace(/[.,]\d{1,2}$/, '');
  s = s.replace(/[.,]/g, '');
  if (!/^\d+$/.test(s)) return null;
  const n = Number.parseInt(s, 10);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Référence affichable : majuscules, uniquement lettres et chiffres. */
export function normalizeRef(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length >= 4 ? s : null;
}

/**
 * Clé de comparaison d'une référence, robuste aux confusions classiques
 * de l'OCR et de la recopie (O/0, I/L/1, S/5, B/8, Z/2).
 * C'est cette clé qui est comparée entre capture et SMS, et hachée (HMAC).
 */
export function refKey(ref: string): string {
  return ref
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/S/g, '5')
    .replace(/B/g, '8')
    .replace(/Z/g, '2');
}

/** Distance d'édition (Levenshtein) : tolérance aux fautes de recopie. */
export function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** Nom comparable : minuscules, sans accents ni ponctuation. */
export function normalizeName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length >= 2 ? s : null;
}

/** Deux noms sont compatibles si l'un contient l'autre ou s'ils partagent un mot de 3 lettres ou plus. */
export function namesCompatible(a: string, b: string): boolean {
  if (a.includes(b) || b.includes(a)) return true;
  const wa = new Set(a.split(' ').filter((w) => w.length >= 3));
  return b.split(' ').some((w) => w.length >= 3 && wa.has(w));
}

/**
 * Dates : "13/11/2026 14:05", "13/11/26 à 14h05", "13-11-2026 14:05:33",
 * "2026-11-13 14:05". Africa/Dakar = UTC+0 toute l'année (pas d'heure d'été) :
 * l'heure lue est donc directement une heure UTC.
 */
export function parseDateTime(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const s = raw.trim();
  let y: number, mo: number, d: number;
  let rest: string;

  const dmy = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(.*)$/.exec(s);
  const ymd = /(\d{4})-(\d{1,2})-(\d{1,2})(.*)$/.exec(s);
  if (ymd) {
    [y, mo, d] = [+ymd[1], +ymd[2], +ymd[3]];
    rest = ymd[4];
  } else if (dmy) {
    [d, mo, y] = [+dmy[1], +dmy[2], +dmy[3]];
    if (y < 100) y += 2000;
    rest = dmy[4];
  } else {
    return null;
  }

  const t = /(\d{1,2})\s*[:hH]\s*(\d{2})(?:\s*:\s*(\d{2}))?/.exec(rest);
  const [h, mi, sec] = t ? [+t[1], +t[2], +(t[3] ?? 0)] : [0, 0, 0];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, sec));
  return date.getUTCDate() === d ? date : null;
}
