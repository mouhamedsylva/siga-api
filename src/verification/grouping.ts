/**
 * Regroupement des pièces d'une preuve (EF-10 à EF-12).
 * Une capture est toujours une image ; le SMS peut être une image ou un texte collé.
 * On ne sait distinguer deux images (capture / SMS) qu'après l'OCR : à ce stade,
 * deux images sont considérées comme une preuve complète.
 */
export interface Composition {
  images: number;
  texts: number;
}

export type Assessment =
  'complete' | 'missing_sms' | 'missing_capture' | 'too_many';

export function assess({ images, texts }: Composition): Assessment {
  if (images > 2 || texts > 1 || images + texts > 3) return 'too_many';
  if (images >= 1 && texts >= 1) return 'complete';
  if (images >= 2) return 'complete';
  if (images === 1) return 'missing_sms';
  return 'missing_capture';
}

/**
 * Un texte collé ressemble-t-il à un SMS de confirmation ?
 * Volontairement large : l'analyse fine se fait à l'extraction.
 */
export function looksLikeSms(text: string): boolean {
  const t = text.trim();
  return t.length >= 25 && /\d{3,}/.test(t.replace(/[\s.,]/g, ''));
}

export const ACCEPTED_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
