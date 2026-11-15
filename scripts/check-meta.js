#!/usr/bin/env node
// Vérifie les variables WhatsApp du .env auprès de l'API Graph, sans afficher les secrets.
// Usage : npm run meta:check
const { readFileSync } = require('fs');
const { join } = require('path');

const env = Object.fromEntries(
  readFileSync(join(__dirname, '..', '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);

const ok = (m) => console.log(`  ✅ ${m}`);
const ko = (m) => console.log(`  ❌ ${m}`);
const version = env.GRAPH_API_VERSION || 'v23.0';
const token = env.WHATSAPP_TOKEN;
const phoneId = env.WHATSAPP_PHONE_NUMBER_ID;

(async () => {
  console.log('Vérification de la configuration Meta\n');
  let failed = false;
  for (const [name, min] of [
    ['WHATSAPP_TOKEN', 50],
    ['WHATSAPP_PHONE_NUMBER_ID', 10],
    ['WHATSAPP_VERIFY_TOKEN', 16],
    ['META_APP_SECRET', 32],
  ]) {
    const v = env[name] || '';
    if (v.length >= min) ok(`${name} renseigné`);
    else {
      ko(`${name} vide ou trop court`);
      failed = true;
    }
  }
  if (env.WHATSAPP_VERIFY_TOKEN && env.WHATSAPP_VERIFY_TOKEN === token) {
    ko('WHATSAPP_VERIFY_TOKEN doit être différent du jeton d’accès');
    failed = true;
  }
  if (!token || !phoneId) process.exit(1);

  // 1. Le jeton peut s'inspecter lui-même : validité, expiration, permissions
  const dbg = await fetch(
    `https://graph.facebook.com/${version}/debug_token?input_token=${token}&access_token=${token}`,
  ).then((r) => r.json());
  const d = dbg.data;
  if (!d?.is_valid) {
    ko(`Jeton invalide : ${dbg.error?.message ?? d?.error?.message ?? 'inconnu'}`);
    process.exit(1);
  }
  ok(`Jeton valide (application ${d.application ?? d.app_id})`);
  if (!d.expires_at) ok('Jeton permanent (n’expire jamais)');
  else {
    const h = Math.round((d.expires_at * 1000 - Date.now()) / 3_600_000);
    console.log(`  ⚠️  Jeton TEMPORAIRE : expire dans ~${h} h — à remplacer par un jeton d’utilisateur système`);
  }
  for (const scope of ['whatsapp_business_messaging', 'whatsapp_business_management']) {
    if ((d.scopes ?? []).includes(scope)) ok(`Permission ${scope}`);
    else {
      ko(`Permission manquante : ${scope}`);
      failed = true;
    }
  }

  // 2. Le numéro est accessible avec ce jeton
  const phone = await fetch(
    `https://graph.facebook.com/${version}/${phoneId}?fields=display_phone_number,verified_name,quality_rating`,
    { headers: { Authorization: `Bearer ${token}` } },
  ).then((r) => r.json());
  if (phone.error) {
    ko(`Numéro inaccessible : ${phone.error.message}`);
    failed = true;
  } else {
    ok(
      `Numéro ${phone.display_phone_number} (« ${phone.verified_name} »), qualité ${phone.quality_rating ?? 'n/a'}`,
    );
  }

  console.log(failed ? '\nÀ corriger avant de continuer.' : '\nTout est bon.');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  ko(`Erreur réseau : ${e.message}`);
  process.exit(1);
});
