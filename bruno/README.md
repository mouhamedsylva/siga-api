# Collection Bruno — SIGA API

Ouvrir dans Bruno : **Open Collection** → choisir ce dossier `siga-api/bruno`.

## Configuration (une fois)

Environnement **Local** (en haut à droite) → **Configure** :

| Variable | Valeur |
|---|---|
| `baseUrl` | `http://localhost:3000` |
| `adminUser` | le login choisi pour ADMIN_USERS |
| `adminPassword` 🔒 | le mot de passe correspondant (en clair, pas le hash) |
| `verifyToken` 🔒 | valeur de WHATSAPP_VERIFY_TOKEN du .env |
| `appSecret` 🔒 | valeur de META_APP_SECRET du .env |
| `testWaId` 🔒 | ton numéro WhatsApp au format international sans + (ex. 221771234567) |

Les variables 🔒 sont **secrètes** : Bruno ne les écrit pas dans les fichiers `.bru`, elles ne partent pas dans Git.

`verificationId`, `itemId` et `sellerId` sont remplis automatiquement par les requêtes « Lister »
et « File de relecture ».

## Contenu

| Dossier | Routes |
|---|---|
| 01 Santé | `GET /health` |
| 02 Webhook | vérification Meta (bon / mauvais jeton), messages simulés signés (texte, commandes, SMS collé, vocal, image), accusé de livraison, signature falsifiée / absente |
| 03 Admin - Vérifications | liste filtrable, détail, image d'une pièce |
| 04 Admin - Relecture | file, confirmer, modifier, rejeter |
| 05 Admin - Vendeurs | liste, fiche, paiements (fondateur, standard 3 mois), bloquer / débloquer |
| 06 Admin - Exploitation | statistiques, mode relecture, rechargement des formats, audit, test 401 |

## Webhook simulé

Les requêtes **POST webhook** construisent un payload identique à celui de Meta et le signent
(HMAC-SHA256 avec `appSecret`). SIGA les traite comme de vrais messages : **les réponses partent
réellement sur WhatsApp** vers `testWaId`, qui doit être ajouté comme destinataire de test dans Meta.

Si ces requêtes renvoient 401 : passer Bruno en **Developer Mode** (paramètres de la collection)
pour autoriser `crypto-js` dans les scripts, et vérifier `appSecret`.

Lancer tout un dossier : clic droit → **Run**. Chaque requête contient des tests sur le statut HTTP.
