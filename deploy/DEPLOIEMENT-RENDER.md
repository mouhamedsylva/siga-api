# Déployer SIGA gratuitement, sans carte bancaire (Render + TiDB + Redis Cloud)

Résultat : le bot, l'API et le back-office en ligne 24 h/24, en HTTPS, sans ton PC et **sans carte bancaire**.

| Brique | Service gratuit | Rôle |
|---|---|---|
| API + back-office | **Render** (Free, Docker) | `https://siga-api.onrender.com` |
| Base MySQL | **TiDB Cloud Starter** (compatible MySQL, 5 Gio) | données + images des preuves |
| Redis | **Redis Cloud** (Free, 30 Mo) | files de tâches (BullMQ), sessions |
| Réveil | **cron-job.org** | appelle `/health` toutes les 10 min (Render endort après 15 min sans trafic) |

Durée : environ 30 à 45 minutes. Garde ton `.env` local ouvert : plusieurs valeurs sont à reprendre.

> **Limites à connaître** (offres gratuites, à vérifier sur les sites, elles évoluent) :
> - Render Free : environ 0,1 processeur et 512 Mo → la lecture OCR d'une capture peut prendre de 20 s à 1 min.
>   Avec le mode relecture actif, ce n'est pas bloquant pour démarrer.
> - Si le réveil automatique cesse de fonctionner, le premier message après une veille met ~1 min à être traité.
> - Disque Render éphémère : c'est pourquoi les images sont stockées dans la base (`STORAGE_BACKEND=db`).

---

## 1. Jeton GitHub pour le back-office (lecture seule)

Render construit le dépôt `siga-api` ; il récupère `siga-admin` (privé) avec ce jeton.

1. GitHub → photo de profil → **Settings > Developer settings > Personal access tokens > Fine-grained tokens >
   Generate new token**.
2. **Token name** : `render-siga-admin` · **Expiration** : 1 an (note la date dans ton agenda).
3. **Repository access** : *Only select repositories* → **siga-admin** uniquement.
4. **Permissions > Repository permissions > Contents** : **Read-only** (rien d'autre).
5. **Generate token** → copie-le (il commence par `github_pat_`). Il ne sera plus affiché.

## 2. Base de données : TiDB Cloud Starter

1. Inscription sur **tidbcloud.com** (GitHub ou Google, sans carte).
2. **Create Cluster** → **Starter** (gratuit) → fournisseur **AWS**, région **Frankfurt (eu-central-1)**
   (même région que Render : moins de latence) → nom `siga` → **Create**.
3. Dans le cluster : **SQL Editor** (ou *Chat2Query*) → exécute :
   ```sql
   CREATE DATABASE siga;
   CREATE DATABASE siga_test;   -- pour valider la compatibilité depuis ton PC (étape 3)
   ```
4. **Connect** → *Connect With* : **Prisma** → **Generate Password** (copie-le) → l'URL affichée a la forme :
   ```
   mysql://XXXXXXXX.root:MOTDEPASSE@gateway01.eu-central-1.prod.aws.tidbcloud.com:4000/test?sslaccept=strict
   ```
   Remplace `/test` par **`/siga`** : c'est ta valeur **`DATABASE_URL`**.

## 3. (Conseillé) Valider SIGA sur TiDB depuis ton PC

TiDB est compatible MySQL mais n'est pas MySQL. Avant de déployer, lance les tests d'intégration de SIGA
(doublons, verrou anti-concurrence, décompte, images en base) contre ta base TiDB `siga_test` :

```powershell
cd "C:\Users\simplon\Documents\Mouhamed\bot whatsapp\siga-api"
$env:TEST_DATABASE_URL = "mysql://XXXXXXXX.root:MOTDEPASSE@gateway01.eu-central-1.prod.aws.tidbcloud.com:4000/siga_test?sslaccept=strict"
npx jest --config ./test/jest-e2e.json test/pipeline test/storage-db
Remove-Item Env:TEST_DATABASE_URL
```

Tout doit être vert. Sinon, envoie le résultat (il ne contient pas le mot de passe).

## 4. Redis : Redis Cloud Free

1. Inscription sur **redis.io/try-free** (sans carte).
2. Crée la base gratuite (**Free**, 30 Mo) → fournisseur **AWS**, région **eu-central-1 (Frankfurt)**.
3. Dans la base → **Configuration** (ou *Edit*) → **Data eviction policy** : **`noeviction`**
   (indispensable : BullMQ ne doit jamais perdre une tâche) → *Save*.
4. Récupère **Public endpoint** (`redis-12345.c1.eu-central-1-1.ec2.redns.redis-cloud.com:12345`) et le mot de passe
   de l'utilisateur **default** (*Security* ou *Connect*). Ta valeur **`REDIS_URL`** :
   ```
   redis://default:MOTDEPASSE@redis-12345.c1.eu-central-1-1.ec2.redns.redis-cloud.com:12345
   ```

## 5. Render

1. Inscription sur **render.com** avec **GitHub** (sans carte) ; autorise l'accès au dépôt **siga-api**.
2. **New + > Blueprint** → choisis **siga-api** → Render lit `render.yaml` et propose le service `siga-api`
   (offre **Free**, Francfort).
3. Renseigne les variables demandées :

| Variable | Valeur |
|---|---|
| `GITHUB_TOKEN` | jeton de l'étape 1 |
| `DATABASE_URL` | étape 2 |
| `REDIS_URL` | étape 4 |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `META_APP_SECRET` | copiés du `.env` local |
| `HASH_SECRET` | **exactement** celui du `.env` local |
| `ADMIN_USERS` | ligne `admin:$2b$12$...` (sur ton PC : `npm run admin:hash -- admin "mot-de-passe-long"`), **sans apostrophes** dans Render |
| `ADMIN_WA_ID` | ton numéro sans `+` (alertes) |
| `TERMS_URL` | `https://siga-api.onrender.com/legal/cgu` (à corriger après l'étape 6 si l'adresse diffère) |
| `LEGAL_CONTACT_EMAIL`, `PAYMENT_INSTRUCTIONS` | tes valeurs |

4. **Apply** → première construction (10 à 15 min). Suis les **Logs** : la fin doit montrer
   `[siga] Application des migrations Prisma…` puis `Nest application successfully started`.

Problèmes fréquents à cette étape :

| Message dans les logs | Cause |
|---|---|
| `ERREUR : variable GITHUB_TOKEN absente` | variable non renseignée dans Render |
| `Authentication failed` / `Repository not found` (git clone) | jeton expiré, ou pas d'accès à siga-admin |
| `Configuration invalide : - XXX` | variable manquante ou mal formée |
| `Démarrage impossible : MySQL injoignable` | `DATABASE_URL` (mot de passe, `/siga`, `?sslaccept=strict`) |
| `Démarrage impossible : Redis injoignable` | `REDIS_URL` (mot de passe, port) |

## 6. Vérifier

L'adresse du service est en haut de la page Render (ex. `https://siga-api.onrender.com`) :
- `…/health` → `{"status":"ok","db":true,"queue":true,"storage":true}` ;
- `…/backoffice/` → connexion avec `admin` et ton mot de passe ;
- `…/legal/confidentialite` → politique de confidentialité.

Si l'adresse n'est pas `siga-api.onrender.com`, corrige `TERMS_URL` dans **Environment** (Render redéploie seul).

## 7. Empêcher la mise en veille (cron-job.org)

1. Inscription sur **cron-job.org** (gratuit).
2. **Create cronjob** : URL `https://siga-api.onrender.com/health`, exécution **toutes les 10 minutes**,
   notifications en cas d'échec activées → *Create*.

Le service reste éveillé (une instance allumée en continu tient dans les 750 h gratuites mensuelles de Render),
et les tâches planifiées de SIGA (purge des images, rappels, alertes) s'exécutent normalement.

## 8. Brancher Meta

Sur developers.facebook.com, app SIGA :
1. Webhook : URL de rappel **`https://siga-api.onrender.com/webhook`**, même jeton de vérification →
   *Vérifier et enregistrer* ; champ **`messages`** abonné ; bouton **Tester** → visible dans les **Logs** Render.
2. **Paramètres de l'app > De base** : URL de confidentialité `…/legal/confidentialite`, conditions `…/legal/cgu`,
   instructions de suppression des données `…/legal/suppression-donnees`, icône, catégorie → *Enregistrer*.
3. **Publier l'app** (sans publication, Meta ne transmet pas les vrais messages).
4. Envoie « Bonjour » au numéro SIGA depuis WhatsApp.

Tu peux ensuite arrêter ngrok et l'API locale.

## Mises à jour

- **`siga-api`** : chaque `git push` sur `main` redéploie automatiquement (le back-office est re-téléchargé à jour).
- **Seulement `siga-admin`** : sur Render, **Manual Deploy > Clear build cache & deploy**.
- Les migrations de base sont appliquées automatiquement au démarrage.

## Sauvegardes

TiDB Cloud Starter propose des sauvegardes automatiques : vérifie dans la console du cluster (**Backup**) leur
fréquence et leur durée de conservation. Pour une copie chez toi, depuis le *SQL Editor* ou un client MySQL,
exporte régulièrement la base `siga`.

## Surveillance

| Où | Quoi regarder |
|---|---|
| Render > **Metrics** | mémoire (proche de 512 Mo ?), redémarrages |
| Render > **Logs** | erreurs, durée des analyses OCR |
| TiDB > cluster | stockage utilisé (5 Gio gratuits), Request Units consommées |
| Redis Cloud > base | mémoire utilisée (30 Mo), connexions (30 max) |
| cron-job.org | historique des appels `/health` |
| Back-office > Paramètres | journal d'audit, alertes |

Si un jour les limites gratuites deviennent trop justes : le plan Render « Starter » (payant) supprime la veille et
augmente la puissance sans rien changer d'autre ; ou bien le déploiement sur VM décrit dans `DEPLOIEMENT.md`.
