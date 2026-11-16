#!/usr/bin/env node
// Audit en LECTURE SEULE de la base de production (TiDB) : réception des messages,
// réponses envoyées et statuts de livraison renvoyés par Meta.
// Usage : créer siga-api/.env.audit contenant  DATABASE_URL=mysql://…/siga?sslaccept=strict
//         puis : npm run audit:prod
// Aucun numéro complet n'est affiché.
const { readFileSync, existsSync } = require('fs');
const { join } = require('path');
const { PrismaClient } = require('@prisma/client');

const file = join(__dirname, '..', '.env.audit');
if (!existsSync(file)) {
  console.error('Fichier .env.audit absent. Crée-le avec : DATABASE_URL=mysql://…/siga?sslaccept=strict');
  process.exit(1);
}
const line = readFileSync(file, 'utf8')
  .split(/\r?\n/)
  .find((l) => l.startsWith('DATABASE_URL='));
const url = line?.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
if (!url) {
  console.error('DATABASE_URL introuvable dans .env.audit');
  process.exit(1);
}

const mask = (n) =>
  !n ? '-' : n.length <= 6 ? '***' : `${n.slice(0, 4)}${'*'.repeat(n.length - 6)}${n.slice(-2)}`;
const at = (d) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '—');
const prisma = new PrismaClient({ datasourceUrl: url, log: [] });

(async () => {
  const since = new Date(Date.now() - 48 * 3600 * 1000);
  console.log('=== Audit SIGA (production) — 48 dernières heures ===\n');

  const sellers = await prisma.seller.findMany({
    orderBy: { lastInboundAt: 'desc' },
    take: 20,
    select: {
      id: true, waId: true, state: true, stopped: true, blocked: true,
      freeLeft: true, lastInboundAt: true, createdAt: true,
    },
  });
  console.log(`Vendeurs (${sellers.length}) :`);
  for (const s of sellers) {
    console.log(
      `  n°${s.id} ${mask(s.waId)} · état ${s.state}${s.stopped ? ' · STOP' : ''}${s.blocked ? ' · BLOQUÉ' : ''}` +
        ` · essais ${s.freeLeft} · dernier message ${at(s.lastInboundAt)}`,
    );
  }

  const inbound = await prisma.inboundEvent.findMany({
    where: { receivedAt: { gte: since } },
    orderBy: { receivedAt: 'desc' },
    take: 15,
  });
  console.log(`\nMessages entrants traités (${inbound.length}) :`);
  inbound.forEach((e) => console.log(`  ${at(e.receivedAt)}`));

  const out = await prisma.outboundMessage.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    take: 25,
    include: { seller: { select: { waId: true } } },
  });
  console.log(`\nMessages envoyés par SIGA et leur statut Meta (${out.length}) :`);
  for (const o of out) {
    console.log(
      `  ${at(o.createdAt)} → ${mask(o.seller?.waId)} · ${o.kind}${o.template ? ' ' + o.template : ''}` +
        ` · statut ${o.status}${o.error ? ' · ERREUR ' + o.error : ''}`,
    );
  }

  const byStatus = await prisma.outboundMessage.groupBy({
    by: ['status'],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
  });
  console.log('\nRépartition des statuts :', byStatus.map((b) => `${b.status}=${b._count._all}`).join(', ') || 'aucun');

  const audit = await prisma.auditLog.findMany({
    where: { at: { gte: since } },
    orderBy: { at: 'desc' },
    take: 15,
    select: { at: true, actor: true, action: true, target: true },
  });
  console.log(`\nJournal d'audit (${audit.length} dernières lignes) :`);
  audit.forEach((a) => console.log(`  ${at(a.at)} · ${a.action} · ${a.actor} · ${a.target ?? ''}`));
})()
  .catch((e) => console.error('Erreur :', e.message.split('\n')[0]))
  .finally(() => prisma.$disconnect());
