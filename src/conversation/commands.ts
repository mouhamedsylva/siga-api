export type Command =
  | 'AIDE'
  | 'HUMAIN'
  | 'STOP'
  | 'REPRENDRE'
  | 'OUI'
  | 'HISTORIQUE'
  | 'ABONNEMENT'
  | 'SUPPRIMER'
  | 'CONFIRMER';

/** Majuscules, sans accents ni ponctuation, espaces réduits. */
export function normalizeCommandText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ALIASES: Record<string, Command> = {
  AIDE: 'AIDE',
  HELP: 'AIDE',
  MENU: 'AIDE',
  HUMAIN: 'HUMAIN',
  STOP: 'STOP',
  ARRET: 'STOP',
  REPRENDRE: 'REPRENDRE',
  START: 'REPRENDRE',
  OUI: 'OUI',
  OK: 'OUI',
  'J ACCEPTE': 'OUI',
  ACCEPTE: 'OUI',
  HISTORIQUE: 'HISTORIQUE',
  ABONNEMENT: 'ABONNEMENT',
  'SUPPRIMER MES DONNEES': 'SUPPRIMER',
  CONFIRMER: 'CONFIRMER',
};

/**
 * Reconnaît une commande uniquement si le message entier est la commande
 * (un SMS collé contenant le mot « stop » ne doit pas déclencher STOP).
 */
export function parseCommand(text: string | undefined): Command | null {
  if (!text) return null;
  const norm = normalizeCommandText(text);
  if (norm.length > 30) return null;
  return ALIASES[norm] ?? null;
}
