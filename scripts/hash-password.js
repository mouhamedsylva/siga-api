#!/usr/bin/env node
// Génère l'entrée ADMIN_USERS d'un administrateur.
//   npm run admin:hash -- <login> <mot de passe>            → affiche la ligne à copier
//   npm run admin:hash -- <login> <mot de passe> --write    → l'écrit directement dans .env
const { hashSync } = require('bcryptjs');
const { readFileSync, writeFileSync } = require('fs');
const { join } = require('path');

const args = process.argv.slice(2);
const write = args.includes('--write');
const [login, password] = args.filter((a) => a !== '--write');

if (!login || !password) {
  console.error('Usage : npm run admin:hash -- <login> "<mot de passe>" [--write]');
  process.exit(1);
}
if (password.length < 12) {
  console.error('Mot de passe trop court : 12 caractères minimum.');
  process.exit(1);
}
if (!/^[A-Za-z0-9._-]{2,40}$/.test(login)) {
  console.error('Login invalide : lettres, chiffres, point, tiret ou souligné (2 à 40 caractères).');
  process.exit(1);
}

const entry = `${login}:${hashSync(password, 12)}`;

if (!write) {
  console.log(entry);
  console.log('\nAjoute cette valeur à ADMIN_USERS (plusieurs admins : séparer par des virgules).');
  console.log('Ou relance avec --write pour l’écrire directement dans .env.');
  process.exit(0);
}

const envPath = join(__dirname, '..', '.env');
const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
const i = lines.findIndex((l) => l.startsWith('ADMIN_USERS='));
// On garde les autres administrateurs, on remplace celui qui a le même login
const others =
  i === -1
    ? []
    : lines[i]
        .slice('ADMIN_USERS='.length)
        .split(',')
        .map((e) => e.trim())
        .filter((e) => /^[^:]+:\$2[aby]\$/.test(e) && !e.startsWith(`${login}:`));
const line = `ADMIN_USERS=${[...others, entry].join(',')}`;
if (i === -1) lines.push(line);
else lines[i] = line;
writeFileSync(envPath, lines.join('\n'));

console.log(`✅ Administrateur « ${login} » enregistré dans .env (${others.length + 1} administrateur(s) au total).`);
console.log('Dans Bruno : adminUser = ' + login + ', adminPassword = le mot de passe en clair.');
