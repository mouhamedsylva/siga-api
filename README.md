# siga-api

Backend du bot WhatsApp **SIGA** : vérification de cohérence des preuves de paiement Wave / Orange Money.
NestJS 11 · Prisma 6 / MySQL 8 (Laragon) · BullMQ / Redis · Tesseract (tesseract.js) · WhatsApp Cloud API.

> SIGA ne confirme jamais qu'un paiement est arrivé : il évalue une cohérence (Cohérent / Douteux / Faux probable)
> et rappelle toujours de vérifier dans l'application de l'opérateur.

## Démarrage local

1. Dans Laragon : **Démarrer tout** (MySQL), puis **Menu > Redis > Démarrer**.
2. Puis :

```bash
cp .env.example .env          # remplir les valeurs (voir commentaires)
npm install                   # génère aussi le client Prisma
npm run db:migrate            # crée la base « siga » et applique prisma/migrations
npm run admin:hash -- awa "un-mot-de-passe-long"   # valeur pour ADMIN_USERS
npm run start:dev
```

Exposer le webhook à Meta avec un tunnel (`ngrok http 3000`, ngrok est fourni par Laragon), puis dans l'app Meta > WhatsApp > Configuration :
URL de rappel `https://<tunnel>/webhook`, jeton de vérification = `WHATSAPP_VERIFY_TOKEN`, abonnement au champ `messages`.

Au premier OCR, le modèle de langue français (~15 Mo) est téléchargé dans `tessdata/`.

## Tests

```bash
npm test            # unitaires (doublures, ni MySQL ni Redis nécessaires)
npm run test:e2e    # webhook + admin (HTTP) et pipeline sur MySQL réel
```

Le test du pipeline utilise la base **`siga_test`** (même serveur que `DATABASE_URL`), migrée avec
`prisma migrate deploy` ; il n'efface jamais de données. Il est ignoré si `.env` est absent.

## Parcours d'une preuve

1. `POST /webhook` : signature `X-Hub-Signature-256` vérifiée, mise en file, 200 immédiat.
2. Worker d'entrée : idempotence (wamid), limitation de débit, conversation (accueil, CGU, commandes).
3. Réception : image téléchargée et stockée, SMS collé reconnu ; regroupement des pièces (`settle` 8 s, fenêtre 10 min).
4. Analyse : OCR → formats YAML (`config/formats`) → normalisation → empreinte HMAC de la référence →
   doublons sous verrou de ligne MySQL → règles R01–R10 + C01.
5. Verdict envoyé et décompté, ou relecture (mode relecture), ou rejet sans décompte (illisible).

## Organisation

| Dossier | Rôle |
|---|---|
| `src/config` | Variables d'environnement validées (zod) ; démarrage refusé si invalide |
| `src/whatsapp` | Webhook, signature, client Graph API (texte, modèles, médias) |
| `src/inbound` | Worker d'entrée : idempotence, accusés de livraison, limitation de débit |
| `src/conversation` | Accueil, CGU, commandes, textes (`messages.fr.ts`), historique, abonnement, suppression |
| `src/verification` | Réception des pièces, regroupement, pipeline d'analyse, envoi du verdict |
| `src/extraction` | OCR, normalisation (montants, références, dates Africa/Dakar), parseur de formats |
| `src/rules` | Moteur de règles pur et messages de verdict |
| `src/billing` | Essais, abonnements, quota mensuel, offre fondateur, paiements manuels |
| `src/admin` | API d'administration : session (back-office) ou Basic auth (Bruno, scripts) |
| `src/maintenance` | Tâches planifiées : purge des images, rappels d'abonnement, alerte relecture |
| `src/storage` | Images : disque local ou S3 / R2 |
| `config/formats` | Formats de SMS et de captures (**exemples à remplacer par les cas réels**) |

## Commandes vendeur

`AIDE`, `HUMAIN`, `STOP` / `REPRENDRE`, `HISTORIQUE`, `ABONNEMENT`, `SUPPRIMER MES DONNÉES` (+ `CONFIRMER`).
Casse et accents ignorés ; une commande n'est reconnue que si c'est le message entier.

## API d'administration (comptes `ADMIN_USERS`)

Deux modes d'accès :
- **Session** (back-office `siga-admin`) : `POST /admin/auth/login` pose un cookie `siga_admin`
  (httpOnly, SameSite=Strict, `Secure` en production, 8 h glissantes, `SESSION_TTL_HOURS`).
  Toute requête qui modifie doit porter l'en-tête `X-SIGA-Admin: 1` (protection CSRF).
  5 échecs en 15 minutes → 429.
- **HTTP Basic** (Bruno, scripts), uniquement derrière HTTPS.

| Route | Usage |
|---|---|
| `POST /admin/auth/login` · `POST /admin/auth/logout` · `GET /admin/auth/me` | Session du back-office |
| `GET /admin/verifications?status=&verdict=&sellerId=&from=&to=&page=` | Liste filtrable |
| `GET /admin/verifications/:id` | Détail (raisons, scores, pièces) |
| `GET /admin/verifications/:id/items/:itemId/image` | Image de la preuve |
| `GET /admin/review` | File de relecture |
| `POST /admin/review/:id` | `{"action":"send"}` confirme · `{"action":"send","verdict":"douteux","reason":"…"}` modifie · `{"action":"reject"}` |
| `GET /admin/sellers?q=&plan=&blocked=` · `GET /admin/sellers/:id` | Vendeurs, fiche, quota |
| `POST /admin/sellers/:id/payments` | `{"amountXof":2000,"plan":"founder","months":1,"method":"wave"}` active l'abonnement |
| `POST /admin/sellers/:id/block` | `{"blocked":true}` |
| `GET /admin/stats?days=30` | Indicateurs |
| `GET/POST /admin/settings` | `{"reviewMode":false}` mode relecture à chaud |
| `POST /admin/formats/reload` | Recharge les formats YAML |
| `GET /admin/audit` | Journal (toute action admin y est écrite) |

Exemple : `curl -u awa:mot-de-passe http://localhost:3000/admin/review`

Le SMS collé d'une vérification reste lisible par l'administrateur tant qu'elle est en relecture ;
il est effacé à la décision finale (verdict envoyé ou rejet), et au plus tard par la purge quotidienne.

## Back-office

Le projet séparé `../siga-admin` est servi par l'API sous **`/backoffice`** une fois construit
(`ADMIN_UI_DIR`, par défaut `../siga-admin/dist`). S'il n'est pas construit, l'API démarre sans lui.
L'API envoie des en-têtes de sécurité (helmet, CSP `default-src 'self'`).

## Pages légales

`/legal/confidentialite`, `/legal/cgu`, `/legal/suppression-donnees` : pages publiques exigées par Meta pour
publier l'app et par le cahier des charges (CGU accessibles depuis le bot, via `TERMS_URL`).
Contenu généré d'après la configuration réelle (rétention, tarifs, version des CGU) ;
**brouillons à faire valider** juridiquement (CDP). Variables : `LEGAL_ENTITY_NAME`, `LEGAL_CONTACT_EMAIL`.

## Déploiement

### Option recommandée : gratuit, sans carte bancaire (Render + TiDB + Redis Cloud)

Guide pas à pas : **[deploy/DEPLOIEMENT-RENDER.md](deploy/DEPLOIEMENT-RENDER.md)**.
`render.yaml` (Blueprint) + `deploy/Dockerfile.render` : Render construit ce dépôt et récupère le back-office
(`siga-admin`, privé) avec un jeton GitHub en lecture seule. Base : TiDB Cloud Starter (compatible MySQL) ;
Redis : Redis Cloud Free ; images stockées en base (`STORAGE_BACKEND=db`, disque Render éphémère) ;
cron-job.org appelle `/health` toutes les 10 min pour éviter la mise en veille.

### Alternative : VM Oracle Cloud (gratuite, carte bancaire demandée)

Guide pas à pas : **[deploy/DEPLOIEMENT.md](deploy/DEPLOIEMENT.md)**.
VM Oracle Cloud « Always Free » (ARM) + Docker Compose : API et back-office (une image construite depuis
les deux dépôts clonés côte à côte dans `/opt/siga`), MySQL 8.4, Redis 7, Caddy (HTTPS automatique, DuckDNS).

| Fichier | Rôle |
|---|---|
| `deploy/Dockerfile` | image multi-étapes : back-office + API, migrations au démarrage |
| `deploy/docker-compose.prod.yml` | mysql, redis, api, caddy ; données dans des volumes |
| `deploy/Caddyfile` | HTTPS Let's Encrypt, `/` → `/backoffice/` |
| `deploy/.env.production.example` | modèle de `/opt/siga/.env` |
| `deploy/siga` | raccourci `docker compose` (`sh deploy/siga ps`, `logs -f api`…) |
| `deploy/backup.sh` · `restore.sh` · `update.sh` | sauvegarde quotidienne, restauration, mise à jour |

## À faire hors code avant la mise en ligne

- Remplacer les formats d'exemple de `config/formats` par les vrais SMS / captures de la phase 0, et ajouter les cas au jeu de tests.
- Faire approuver par Meta les modèles `siga_verdict_pret` et `siga_rappel_abonnement`.
- Rédiger les CGU / politique de confidentialité (`TERMS_URL`) et valider les durées de conservation (CDP).
- Renseigner `PAYMENT_INSTRUCTIONS` (numéro de paiement du service).
- Redis 6.2+ en production (Laragon fournit 5.0 : BullMQ fonctionne mais avertit).

## Avancement

- [x] J1 Fondations · [x] J2 Webhook · [x] J3 Conversation · [x] J4 Réception des preuves
- [x] J5 Extraction · [x] J6 Règles, doublons, relecture · [x] J7 Essais et abonnements
- [x] J8 API d'administration · [x] J9 Exploitation
- [x] Back-office web (`../siga-admin`) et connexion par session
- [ ] P3 : wolof, boutons, encaissement automatique
