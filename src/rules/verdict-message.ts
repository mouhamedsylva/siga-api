import type { RuleId, Triggered, Verdict } from './engine';

/**
 * Raisons montrées au vendeur : courtes et volontairement générales,
 * pour ne pas guider un fraudeur (§6.3).
 */
const REASONS: Partial<Record<RuleId, string>> = {
  R01: "Je n'ai pas reçu le SMS de confirmation pour comparer",
  R02: 'La capture et le SMS ne correspondent pas',
  R03: 'La capture et le SMS ne correspondent pas',
  R04: "La date ou l'heure du paiement pose question",
  R05: 'Cette référence a déjà été utilisée pour un autre paiement',
  R07: 'Certaines informations sont illisibles',
  R08: 'Je ne reconnais pas ce format de paiement',
  R09: "Les informations de l'expéditeur ne correspondent pas",
  R10: 'La capture et le SMS ne correspondent pas',
  C01: 'Certaines informations sont difficiles à lire',
};

const DEFAULT_DOUBT = 'Je ne peux pas confirmer que tout est cohérent';

export const VERDICT_LABEL: Record<Verdict, string> = {
  coherent: 'Cohérent',
  douteux: 'Douteux',
  faux_probable: 'Faux probable',
};

/**
 * Réponse en 3 lignes (EF-32) : verdict + raison, conseil, rappel de vérifier
 * dans l'application. Jamais de confirmation qu'un paiement est arrivé.
 */
export function buildVerdictMessage(
  verdict: Verdict,
  triggered: Triggered[],
  primary: RuleId | null,
  customReason?: string,
): string {
  const warning = triggered.some((t) => t.rule === 'R06')
    ? '\nAttention : tu as déjà vérifié cette référence.'
    : '';

  if (verdict === 'coherent') {
    return (
      `✅ Cohérent. Montant, référence et heure correspondent, et cette référence n'a pas été vue ailleurs.\n` +
      `Pour une grosse commande, vérifie quand même dans ton application Wave ou Orange Money.` +
      warning
    );
  }
  const reason =
    customReason ?? (primary ? REASONS[primary] : undefined) ?? DEFAULT_DOUBT;
  if (verdict === 'douteux') {
    return (
      `⚠️ Douteux. ${reason}.\n` +
      `Vérifie dans ton application avant de livrer.` +
      warning
    );
  }
  return (
    `❌ Faux probable. ${reason}.\n` +
    `Je te conseille de ne pas livrer. Vérifie dans ton application.` +
    warning
  );
}
