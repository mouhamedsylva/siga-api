/**
 * Textes envoyés au vendeur (Annexe A). Français, 5 lignes au plus, sans jargon.
 * Garde-fou : aucun message ne demande de code secret, et aucun ne confirme
 * qu'un paiement est arrivé.
 */
export const MSG = {
  welcome: (trials: number) =>
    `Bonjour, je suis SIGA ! Envoie-moi la capture du paiement et le SMS de confirmation de Wave ou Orange Money.\n` +
    `Je te dis en quelques secondes si tout est cohérent. Tes ${trials} premiers tests sont gratuits.\n` +
    `Je ne te demande jamais ton code secret.`,

  askTerms: (termsUrl?: string) =>
    `Avant de commencer, lis les conditions d'utilisation${termsUrl ? ` : ${termsUrl}` : ''}.\n` +
    `SIGA est une aide à la décision : il ne confirme pas qu'un paiement est arrivé.\n` +
    `Réponds OUI pour accepter.`,

  termsAccepted:
    `Merci, c'est noté !\n` +
    `Envoie-moi la capture du paiement et le SMS de confirmation (en image ou en texte collé).`,

  help:
    `Envoie la capture du paiement puis le SMS de confirmation de l'opérateur.\n` +
    `Commandes : HISTORIQUE, ABONNEMENT, HUMAIN (parler à une personne), STOP (ne plus recevoir de messages), SUPPRIMER MES DONNÉES.\n` +
    `Je ne te demande jamais ton code secret.`,

  human: `C'est noté, une personne de l'équipe SIGA va te répondre ici dès que possible.`,

  stop: `C'est noté, je ne t'écrirai plus. Écris REPRENDRE quand tu veux recommencer.`,

  stoppedReminder: `Tu as arrêté les messages de SIGA. Écris REPRENDRE pour réactiver le service.`,

  resumed: `Content de te revoir ! Envoie-moi la capture et le SMS de confirmation.`,

  unsupported:
    `Je ne lis que les images (captures d'écran) et le texte.\n` +
    `Envoie la capture du paiement et le SMS de confirmation, sans vocal ni vidéo ni fichier.`,

  missingSms: `Il me manque le SMS de confirmation de l'opérateur. Envoie-le-moi pour que je puisse comparer.`,

  missingCapture: `Il me manque la capture du paiement. Envoie-la-moi pour que je puisse comparer.`,

  unreadable:
    `Je n'arrive pas à lire la capture. Renvoie-la en plein écran et bien éclairée.\n` +
    `Cet envoi ne compte pas dans tes essais.`,

  oneAtATime: `J'ai reçu trop d'éléments à la fois. Envoie-moi un seul paiement à la fois : la capture puis le SMS.`,

  notAProof:
    `Je n'ai pas compris. Envoie la capture du paiement et le SMS de confirmation.\n` +
    `Écris AIDE pour voir les commandes.`,

  mediaError: `Je n'ai pas pu récupérer ton image. Renvoie-la, s'il te plaît. Cet envoi ne compte pas dans tes essais.`,

  received: `Bien reçu, je vérifie…`,

  slowDown: `Tu m'envoies beaucoup de messages. Patiente une minute avant de continuer, s'il te plaît.`,

  resendBoth:
    `Il me manque la capture du paiement.\n` +
    `Renvoie la capture et le SMS de confirmation ensemble. Cet envoi ne compte pas dans tes essais.`,

  deleted: `C'est fait : ton profil et tes captures ont été effacés. Au revoir !`,

  subscriptionActivated: (until: string) =>
    `Merci ! Ton abonnement SIGA est actif jusqu'au ${until}.\n` +
    `Envoie-moi la capture et le SMS quand tu veux.`,

  inReview: `Une personne de l'équipe vérifie ce paiement. Je te réponds ici dès que c'est fait.`,

  technicalError:
    `Désolé, j'ai un souci technique. Une personne de l'équipe va vérifier ta demande et te répondre ici.\n` +
    `Cet envoi ne compte pas dans tes essais.`,
} as const;
