import type { ParsedPiece } from '../extraction/parser';
import {
  editDistance,
  namesCompatible,
  normalizeName,
  refKey,
} from '../extraction/normalize';

/**
 * Moteur de règles (§6). Fonction pure : aucune base, aucun réseau.
 * Chaque règle produit un effet ; le verdict est l'effet le plus sévère.
 */
export type Effect = 'reject' | 'blocking' | 'doubt' | 'warning';
export type RuleId =
  | 'R01'
  | 'R02'
  | 'R03'
  | 'R04'
  | 'R05'
  | 'R06'
  | 'R07'
  | 'R08'
  | 'R09'
  | 'R10'
  | 'C01';
export type Verdict = 'coherent' | 'douteux' | 'faux_probable';

export interface Triggered {
  rule: RuleId;
  effect: Effect;
  /** Envoi en relecture même si le mode relecture ne vise que les douteux */
  review?: boolean;
  /** Détail technique (jamais montré au vendeur) */
  note?: string;
}

export interface RuleInput {
  capture: ParsedPiece | null;
  sms: ParsedPiece | null;
  history: {
    /** Référence déjà vue chez un autre vendeur (même opérateur) */
    otherSeller: boolean;
    /** Référence déjà vérifiée par ce vendeur */
    sameSeller: boolean;
  };
  now: Date;
}

export interface RuleConfig {
  maxTimeGapMinutes: number;
  futureToleranceMinutes: number;
  ocrMinConfidence: number;
}

export interface Decision {
  outcome: Verdict | 'rejected';
  triggered: Triggered[];
  /** Règle principale à expliquer au vendeur */
  primary: Triggered | null;
  needsReview: boolean;
}

const MIN = 60_000;

export function evaluate(input: RuleInput, cfg: RuleConfig): Decision {
  const { capture, sms, history, now } = input;
  const t: Triggered[] = [];
  const hit = (rule: RuleId, effect: Effect, extra: Partial<Triggered> = {}) =>
    t.push({ rule, effect, ...extra });

  // R07 : capture absente, illisible ou champ obligatoire manquant → rejet sans décompte
  if (!capture) hit('R07', 'reject', { note: 'capture absente' });
  else if (capture.unreadable)
    hit('R07', 'reject', { note: 'capture illisible' });
  else if (capture.formatId && capture.missing.length)
    hit('R07', 'reject', { note: `capture: ${capture.missing.join(',')}` });
  if (sms?.unreadable) hit('R07', 'reject', { note: 'sms illisible' });

  // R08 : format inconnu → doute et relecture
  if (capture && !capture.unreadable && capture.kind === 'unknown')
    hit('R08', 'doubt', { review: true, note: 'capture' });
  if (sms && !sms.unreadable && sms.kind === 'unknown')
    hit('R08', 'doubt', { review: true, note: 'sms' });

  // R01 : SMS absent
  if (!sms) hit('R01', 'doubt');
  else if (!sms.unreadable && sms.formatId && sms.missing.length)
    hit('R07', 'doubt', { note: `sms: ${sms.missing.join(',')}` });

  if (capture && sms) {
    // R10 : opérateurs différents
    if (capture.operator && sms.operator && capture.operator !== sms.operator)
      hit('R10', 'blocking');

    // R02 : montants différents
    if (
      capture.amount != null &&
      sms.amount != null &&
      capture.amount !== sms.amount
    )
      hit('R02', 'blocking');

    // R03 : références différentes (1 caractère d'écart = faute de lecture ou de recopie → doute)
    if (capture.ref && sms.ref) {
      const a = refKey(capture.ref);
      const b = refKey(sms.ref);
      if (a !== b) {
        if (editDistance(a, b) <= 1) hit('R03', 'doubt', { note: 'écart 1' });
        else hit('R03', 'blocking');
      }
    }

    // R09 : nom de l'expéditeur incohérent
    const n1 = normalizeName(capture.sender);
    const n2 = normalizeName(sms.sender);
    if (n1 && n2 && !namesCompatible(n1, n2)) hit('R09', 'doubt');
  }

  // R04 : date dans le futur, ou écart important entre capture et SMS
  const dates = [capture?.datetime, sms?.datetime].filter(
    (d): d is Date => d instanceof Date,
  );
  if (
    dates.some(
      (d) => d.getTime() > now.getTime() + cfg.futureToleranceMinutes * MIN,
    )
  )
    hit('R04', 'doubt', { note: 'futur' });
  else if (
    capture?.datetime &&
    sms?.datetime &&
    Math.abs(capture.datetime.getTime() - sms.datetime.getTime()) >
      cfg.maxTimeGapMinutes * MIN
  )
    hit('R04', 'doubt', { note: 'écart' });

  // R05 / R06 : référence déjà vue
  if (history.otherSeller) hit('R05', 'blocking');
  if (history.sameSeller) hit('R06', 'warning');

  // C01 (EF-23) : confiance OCR insuffisante
  const ocrConf = [capture, sms]
    .filter((p): p is ParsedPiece => !!p && p.source === 'ocr' && !p.unreadable)
    .map((p) => p.confidence);
  if (ocrConf.length && Math.min(...ocrConf) < cfg.ocrMinConfidence)
    hit('C01', 'doubt', { review: true });

  // Garde-fou : jamais « cohérent » sans montant et référence extraits
  const fieldsOk =
    capture?.amount != null &&
    capture?.ref != null &&
    sms?.amount != null &&
    sms?.ref != null;

  const outcome: Decision['outcome'] = t.some((x) => x.effect === 'reject')
    ? 'rejected'
    : t.some((x) => x.effect === 'blocking')
      ? 'faux_probable'
      : t.some((x) => x.effect === 'doubt') || !fieldsOk
        ? 'douteux'
        : 'coherent';

  return {
    outcome,
    triggered: t,
    primary: pickPrimary(t, outcome),
    needsReview: outcome === 'douteux' || t.some((x) => x.review),
  };
}

/** Ordre de priorité pour l'explication au vendeur. */
const PRIORITY: RuleId[] = [
  'R07',
  'R05',
  'R10',
  'R02',
  'R03',
  'R08',
  'R01',
  'R04',
  'R09',
  'C01',
  'R06',
];

export function pickPrimary(
  t: Triggered[],
  outcome: Decision['outcome'],
): Triggered | null {
  const effect: Effect | null =
    outcome === 'rejected'
      ? 'reject'
      : outcome === 'faux_probable'
        ? 'blocking'
        : outcome === 'douteux'
          ? 'doubt'
          : null;
  if (!effect) return null;
  const candidates = t.filter((x) => x.effect === effect);
  candidates.sort(
    (a, b) => PRIORITY.indexOf(a.rule) - PRIORITY.indexOf(b.rule),
  );
  return candidates[0] ?? null;
}
