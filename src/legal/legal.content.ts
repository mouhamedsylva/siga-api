/**
 * Pages légales de SIGA. BROUILLONS rédigés d'après le fonctionnement réel du service,
 * à faire valider par un conseil juridique et la Commission de Protection des Données
 * Personnelles (CDP) avant l'ouverture au public.
 */
export interface LegalParams {
  entity: string;
  contactEmail?: string;
  imageRetentionDays: number;
  termsVersion: string;
  freeTrials: number;
  founderPrice: number;
  standardPrice: number;
  monthlyQuota: number;
  overagePrice: number;
  baseUrl: string;
}

export interface LegalPage {
  slug: string;
  title: string;
  body: string;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const fcfa = (n: number) =>
  `${n.toLocaleString('fr-FR').replace(/[\u202f\u00a0]/g, ' ')} FCFA`;

function contact(p: LegalParams): string {
  const email = p.contactEmail
    ? `par e-mail à <a href="mailto:${escapeHtml(p.contactEmail)}">${escapeHtml(p.contactEmail)}</a>, ou `
    : '';
  return `${email}en écrivant <strong>HUMAIN</strong> au bot SIGA sur WhatsApp`;
}

export function privacyPage(p: LegalParams): LegalPage {
  const e = escapeHtml(p.entity);
  return {
    slug: 'confidentialite',
    title: 'Politique de confidentialité',
    body: `
<p>Cette politique explique quelles données ${e} (« SIGA ») traite lorsque tu utilises le bot WhatsApp SIGA,
pourquoi, combien de temps elles sont conservées et comment exercer tes droits. Elle s'applique dans le cadre de la
loi sénégalaise n° 2008-12 du 25 janvier 2008 sur la protection des données à caractère personnel.</p>

<h2>1. Responsable du traitement</h2>
<p>${e}. Contact : ${contact(p)}.</p>

<h2>2. Ce que fait SIGA</h2>
<p>SIGA aide les vendeurs à évaluer la <strong>cohérence</strong> d'une preuve de paiement Wave ou Orange Money
(capture d'écran et SMS de confirmation). SIGA est une aide à la décision : il <strong>ne confirme jamais</strong>
qu'un paiement est arrivé, n'accède à aucun compte Mobile Money et ne demande jamais de code secret.</p>

<h2>3. Données traitées</h2>
<table>
<thead><tr><th>Donnée</th><th>Utilisation</th><th>Conservation</th></tr></thead>
<tbody>
<tr><td>Ton numéro WhatsApp et ton nom de profil</td><td>Identifier ton compte, te répondre, gérer tes essais et ton abonnement</td><td>Tant que ton compte existe (voir la suppression)</td></tr>
<tr><td>Images envoyées (captures, SMS en image)</td><td>Lecture automatique (OCR) et relecture humaine éventuelle</td><td><strong>${p.imageRetentionDays} jours</strong>, puis suppression automatique</td></tr>
<tr><td>SMS collé en texte</td><td>Comparaison avec la capture</td><td>Effacé dès que la vérification est terminée</td></tr>
<tr><td>Résultat d'une vérification : opérateur, montant, date, verdict, contrôles déclenchés</td><td>Historique, statistiques, support</td><td>Durée à définir (voir § 5)</td></tr>
<tr><td>Empreinte de la référence de transaction (HMAC, la référence elle-même n'est pas conservée)</td><td>Détecter une même preuve réutilisée (lutte contre la fraude)</td><td>Durée à définir (voir § 5)</td></tr>
<tr><td>Acceptation des conditions (version, date)</td><td>Preuve de ton consentement</td><td>Durée de la relation, puis délai légal</td></tr>
<tr><td>Paiements d'abonnement (montant, période, référence)</td><td>Gestion de l'abonnement, comptabilité</td><td>Délai légal comptable</td></tr>
<tr><td>Journal technique et d'audit (actions, alertes ; numéros masqués)</td><td>Sécurité et bon fonctionnement</td><td>Durée limitée</td></tr>
</tbody>
</table>
<p>Les noms et numéros des <strong>clients</strong> du vendeur qui apparaissent sur une preuve servent uniquement à la
comparaison automatique et ne sont <strong>pas conservés</strong> après l'analyse.</p>

<h2>4. Destinataires et sous-traitants</h2>
<ul>
<li><strong>Meta Platforms</strong> (WhatsApp Business Cloud API) : transport des messages et des images.</li>
<li><strong>Hébergeur</strong> du serveur SIGA (base de données, images).</li>
<li>Les administrateurs de SIGA, pour la relecture des cas douteux et le support.</li>
</ul>
<p>Les données ne sont <strong>ni vendues ni utilisées à des fins publicitaires</strong>. Certains prestataires
(Meta, hébergeur) peuvent traiter des données hors du Sénégal.</p>

<h2>5. Durées de conservation</h2>
<p>Images : ${p.imageRetentionDays} jours. SMS collé : jusqu'à la fin de la vérification. La durée de conservation
des résultats de vérification et des empreintes de références (nécessaires à la détection des preuves réutilisées)
est <strong>en cours de définition</strong> avec la CDP.</p>

<h2>6. Sécurité</h2>
<p>Connexions chiffrées (HTTPS), accès d'administration protégé et journalisé, références de transaction stockées
sous forme d'empreinte, numéros masqués dans les journaux techniques, suppression automatique des images.</p>

<h2>7. Tes droits</h2>
<p>Tu peux demander l'accès, la rectification ou la suppression de tes données, et t'opposer à leur traitement :</p>
<ul>
<li>écris <strong>SUPPRIMER MES DONNÉES</strong> au bot (voir <a href="${p.baseUrl}/legal/suppression-donnees">la procédure</a>) ;</li>
<li>écris <strong>STOP</strong> pour ne plus recevoir de messages ;</li>
<li>ou contacte-nous ${contact(p)}.</li>
</ul>
<p>Tu peux aussi saisir la Commission de Protection des Données Personnelles (CDP) du Sénégal.</p>
`,
  };
}

export function termsPage(p: LegalParams): LegalPage {
  const e = escapeHtml(p.entity);
  return {
    slug: 'cgu',
    title: "Conditions d'utilisation",
    body: `
<p>Version <strong>${escapeHtml(p.termsVersion)}</strong>. En répondant « OUI » au bot SIGA, tu acceptes ces
conditions. Le service est fourni par ${e}.</p>

<h2>1. Le service</h2>
<p>SIGA analyse une capture de paiement et le SMS de confirmation de l'opérateur (Wave, Orange Money) et rend un
verdict : <strong>Cohérent</strong>, <strong>Douteux</strong> ou <strong>Faux probable</strong>.</p>
<p><strong>SIGA est une aide à la décision.</strong> Il ne confirme jamais qu'un paiement est arrivé sur ton compte et
n'a accès à aucun compte Mobile Money. Avant de livrer, et en particulier pour une somme importante,
<strong>vérifie toujours la réception dans ton application Wave ou Orange Money</strong>.</p>

<h2>2. Sécurité</h2>
<p>SIGA ne te demandera <strong>jamais</strong> ton code secret, ton mot de passe ni un code de validation.
Toute demande de ce type n'émane pas de SIGA.</p>

<h2>3. Essais et abonnement</h2>
<ul>
<li>${p.freeTrials} vérifications gratuites par numéro. Une vérification est décomptée lorsqu'un verdict t'est envoyé ;
une capture illisible ou incomplète n'est pas décomptée.</li>
<li>Abonnement mensuel : ${fcfa(p.standardPrice)} par mois (tarif fondateur de ${fcfa(p.founderPrice)} le premier mois,
dans la limite des places disponibles), ${p.monthlyQuota} vérifications incluses, puis ${fcfa(p.overagePrice)} par
vérification supplémentaire.</li>
<li>Le paiement est effectué selon les instructions envoyées par le bot et l'abonnement est activé après réception.</li>
</ul>

<h2>4. Utilisation acceptable</h2>
<p>Tu t'engages à n'envoyer que des preuves de paiement reçues dans le cadre de ton activité, et à ne pas utiliser
SIGA pour tester ou fabriquer de fausses preuves. En cas d'abus, l'accès peut être limité ou suspendu.</p>

<h2>5. Responsabilité</h2>
<p>Les verdicts reposent sur des contrôles automatiques et, le cas échéant, sur une relecture humaine ; ils peuvent
être erronés. ${e} ne saurait être tenu responsable d'une décision de livraison prise sur la seule base d'un verdict
SIGA, la vérification dans l'application de l'opérateur restant indispensable.</p>

<h2>6. Données personnelles</h2>
<p>Voir la <a href="${p.baseUrl}/legal/confidentialite">politique de confidentialité</a>.</p>

<h2>7. Arrêt et modification</h2>
<p>Tu peux arrêter à tout moment (commande <strong>STOP</strong>) et demander la suppression de tes données
(<strong>SUPPRIMER MES DONNÉES</strong>). Ces conditions peuvent évoluer ; la nouvelle version te sera présentée
avant toute nouvelle vérification.</p>

<h2>8. Contact</h2>
<p>${contact(p)}.</p>
`,
  };
}

export function deletionPage(p: LegalParams): LegalPage {
  return {
    slug: 'suppression-donnees',
    title: 'Suppression de tes données',
    body: `
<p>Tu peux demander à tout moment la suppression de tes données SIGA, directement depuis WhatsApp.</p>

<h2>Procédure</h2>
<ol>
<li>Dans ta discussion avec SIGA, écris <strong>SUPPRIMER MES DONNÉES</strong>.</li>
<li>SIGA te demande une confirmation : écris <strong>CONFIRMER</strong> dans les 10 minutes.</li>
<li>Tu reçois un message confirmant la suppression.</li>
</ol>
<p>Si tu n'as plus accès à WhatsApp, contacte-nous ${contact(p)} en indiquant le numéro concerné.</p>

<h2>Ce qui est supprimé</h2>
<ul>
<li>ton profil (nom de profil) et toutes tes images de preuves ;</li>
<li>les SMS collés encore présents ;</li>
<li>ton numéro, remplacé par une empreinte irréversible.</li>
</ul>

<h2>Ce qui est conservé</h2>
<ul>
<li>les empreintes de références de transaction, montants et verdicts, sans lien avec ton numéro en clair, pour
détecter la réutilisation frauduleuse d'une même preuve par d'autres personnes ;</li>
<li>l'empreinte de ton numéro, uniquement pour ne pas réattribuer d'essais gratuits ;</li>
<li>les données de paiement soumises à une obligation légale de conservation.</li>
</ul>
<p>La durée de conservation de ces éléments est en cours de validation avec la Commission de Protection des Données
Personnelles (CDP).</p>

<h2>Arrêter seulement les messages</h2>
<p>Pour ne plus recevoir de messages sans supprimer tes données, écris <strong>STOP</strong>.
Écris <strong>REPRENDRE</strong> pour réactiver le service.</p>
`,
  };
}

/** Gabarit HTML autonome (aucun script, aucune ressource externe), clair / sombre. */
export function renderPage(page: LegalPage, p: LegalParams): string {
  const nav = [
    ['confidentialite', 'Confidentialité'],
    ['cgu', "Conditions d'utilisation"],
    ['suppression-donnees', 'Suppression des données'],
  ]
    .map(
      ([slug, label]) =>
        `<a href="${p.baseUrl}/legal/${slug}"${slug === page.slug ? ' aria-current="page"' : ''}>${label}</a>`,
    )
    .join('');
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(page.title)} — SIGA</title>
<style>
:root{--bg:#f8fafc;--surface:#fff;--border:#e2e8f0;--fg:#0f172a;--muted:#64748b;--primary:#4f46e5;--side:#1e1b4b;--side-fg:#e0e7ff;--warn:#b45309;--warn-bg:#fef3c7;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0b0f1a;--surface:#121829;--border:#1f2a44;--fg:#e2e8f0;--muted:#94a3b8;--primary:#818cf8;--side:#0e0b2e;--warn:#fbbf24;--warn-bg:#451a03;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{background:var(--side);color:var(--side-fg);padding:20px 16px}header div{max-width:820px;margin:auto;font-weight:700;letter-spacing:.04em}
nav{max-width:820px;margin:16px auto 0;padding:0 16px;display:flex;flex-wrap:wrap;gap:8px}
nav a{padding:6px 12px;border-radius:999px;border:1px solid var(--border);color:var(--fg);text-decoration:none;font-size:14px;background:var(--surface)}
nav a[aria-current]{background:var(--primary);border-color:var(--primary);color:#fff}
main{max-width:820px;margin:16px auto 48px;padding:28px 24px;background:var(--surface);border:1px solid var(--border);border-radius:12px}
h1{margin:0 0 16px;font-size:26px;line-height:1.25}h2{margin:28px 0 8px;font-size:18px}
a{color:var(--primary)}.draft{background:var(--warn-bg);color:var(--warn);padding:10px 14px;border-radius:8px;font-size:14px;margin-bottom:20px}
table{width:100%;border-collapse:collapse;font-size:14px;margin:12px 0}th,td{border:1px solid var(--border);padding:8px 10px;text-align:left;vertical-align:top}th{color:var(--muted);font-weight:600}
.table{overflow-x:auto}footer{max-width:820px;margin:0 auto 32px;padding:0 16px;color:var(--muted);font-size:13px}
</style>
</head>
<body>
<header><div>SIGA</div></header>
<nav aria-label="Pages légales">${nav}</nav>
<main>
<div class="draft" role="note">Document provisoire, en cours de validation juridique.</div>
<h1>${escapeHtml(page.title)}</h1>
${page.body.replace(/<table>/g, '<div class="table"><table>').replace(/<\/table>/g, '</table></div>')}
</main>
<footer>${escapeHtml(p.entity)} · SIGA évalue une cohérence, il ne confirme jamais qu'un paiement est arrivé.</footer>
</body>
</html>`;
}
