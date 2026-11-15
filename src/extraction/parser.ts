import type { FieldName, Operator, ProofFormat, ProofKind } from './formats';
import { normalizeRef, parseAmount, parseDateTime } from './normalize';

/** Résultat de l'analyse d'une pièce (texte collé ou texte OCR d'une image). */
export interface ParsedPiece {
  source: 'text' | 'ocr';
  /** Type reconnu ; 'unknown' si aucun format ne correspond */
  kind: ProofKind | 'unknown';
  operator: Operator | null;
  formatId: string | null;
  amount: number | null;
  ref: string | null;
  datetime: Date | null;
  /** Nom de l'expéditeur : utilisé pour la comparaison, jamais conservé */
  sender: string | null;
  /** Champs obligatoires du format non trouvés */
  missing: FieldName[];
  /** Confiance OCR 0-100 (texte collé : 100) */
  confidence: number;
  /** Image illisible (OCR vide ou confiance trop faible) */
  unreadable: boolean;
}

export function compactText(text: string): string {
  return text.replace(/[\s\u00a0\u202f]+/g, ' ').trim();
}

/** Opérateur deviné par mots-clés quand aucun format ne correspond. */
export function guessOperator(text: string): Operator | null {
  if (/\bwave\b/i.test(text)) return 'wave';
  if (/orange\s*money|max\s?it|\bOM\b/i.test(text)) return 'orange_money';
  return null;
}

function extractField(re: RegExp | undefined, text: string): string | null {
  if (!re) return null;
  const m = re.exec(text);
  return m?.[1]?.trim() ?? null;
}

function applyFormat(f: ProofFormat, text: string) {
  const raw = {
    amount: extractField(f.fields.amount, text),
    ref: extractField(f.fields.ref, text),
    datetime: extractField(f.fields.datetime, text),
    sender: extractField(f.fields.sender, text),
  };
  const values = {
    amount: parseAmount(raw.amount),
    ref: normalizeRef(raw.ref),
    datetime: parseDateTime(raw.datetime),
    sender: raw.sender,
  };
  const missing = f.required.filter((name) => values[name] == null);
  return { values, missing };
}

/**
 * Analyse un texte avec les formats connus. Le format retenu est celui qui
 * est détecté et extrait le plus de champs obligatoires.
 * `preferKind` départage (un texte collé est a priori un SMS).
 */
export function parsePiece(
  text: string,
  formats: ProofFormat[],
  opts: { source: 'text' | 'ocr'; confidence?: number; preferKind?: ProofKind },
): ParsedPiece {
  const t = compactText(text);
  const confidence = opts.confidence ?? 100;

  const candidates = formats
    .filter((f) => f.detect.every((re) => re.test(t)))
    .map((f) => ({ f, ...applyFormat(f, t) }))
    .sort(
      (a, b) =>
        a.missing.length - b.missing.length ||
        Number(b.f.kind === opts.preferKind) -
          Number(a.f.kind === opts.preferKind),
    );

  const best = candidates[0];
  if (!best) {
    return {
      source: opts.source,
      kind: 'unknown',
      operator: guessOperator(t),
      formatId: null,
      amount: null,
      ref: null,
      datetime: null,
      sender: null,
      missing: ['amount', 'ref'],
      confidence,
      unreadable: false,
    };
  }
  return {
    source: opts.source,
    kind: best.f.kind,
    operator: best.f.operator,
    formatId: best.f.id,
    ...best.values,
    missing: best.missing,
    confidence,
    unreadable: false,
  };
}
