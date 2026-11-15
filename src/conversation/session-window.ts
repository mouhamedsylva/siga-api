const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Fenêtre de 24 h de WhatsApp : un message libre n'est autorisé que si le
 * vendeur a écrit dans les dernières 24 h ; sinon il faut un modèle approuvé.
 * Une marge de 5 minutes évite d'envoyer à la limite.
 */
export function isWithinSessionWindow(
  lastInboundAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!lastInboundAt) return false;
  return now.getTime() - lastInboundAt.getTime() < WINDOW_MS - 5 * 60 * 1000;
}
