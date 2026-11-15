# Déployer SIGA gratuitement sur Oracle Cloud

Résultat : le bot, l'API, la base MySQL, Redis et le back-office tournent 24 h/24 sur une machine virtuelle
gratuite, en HTTPS, sans ton PC.

```
Internet ─443─► Caddy (HTTPS auto) ─► API SIGA + back-office ─► MySQL, Redis (réseau interne Docker)
```

Durée : environ 1 h la première fois. Il te faut : une carte bancaire (vérification d'identité Oracle, rien
n'est débité dans les limites gratuites), tes deux dépôts GitHub privés et ton `.env` local.

> Les limites gratuites d'Oracle évoluent (réduites en 2026 : 2 OCPU / 12 Go pour les VM ARM).
> Vérifie la page « Always Free Resources » d'Oracle au moment de créer la VM.

---

## 1. Compte Oracle Cloud

1. Inscription sur **cloud.oracle.com** (« Commencer gratuitement »). Choisis une **région d'origine** proche
   (par ex. *France Central (Paris)* ou *Spain Central (Madrid)*) : elle ne peut plus être changée.
2. Une fois le compte actif : **Facturation et gestion des coûts > Mettre à niveau et gérer le paiement** →
   passer en **Pay As You Go** (paiement à l'usage). Tu restes gratuit tant que tu ne dépasses pas les limites
   « Always Free », mais Oracle ne récupère plus les VM jugées inactives (un bot peu utilisé pourrait l'être).
3. **Facturation > Budgets > Créer un budget** : montant **1 $**, alerte à 1 % → e-mail au moindre centime.

## 2. Créer la machine virtuelle

**Compute > Instances > Créer une instance** :

| Champ | Valeur |
|---|---|
| Nom | `siga` |
| Image | **Canonical Ubuntu 24.04** |
| Forme (shape) | **Ampere – VM.Standard.A1.Flex**, **2 OCPU**, **12 Go** de mémoire |
| Réseau | VCN par défaut, sous-réseau **public**, « Attribuer une adresse IPv4 publique » |
| Clés SSH | « Générer une paire de clés » → **télécharger la clé privée** (à garder précieusement) |
| Volume de démarrage | 50 Go (suffisant) |

Si Oracle répond **« Out of capacity »** : choisis un autre *domaine de disponibilité* dans la même page, ou
réessaie plus tard (les capacités ARM gratuites sont parfois saturées).

**Adresse IP fixe** : *Instance > Cartes d'interface réseau > VNIC principale > Adresses IPv4 > Modifier* →
**IP publique réservée** (gratuite tant qu'elle est attachée). Ainsi l'adresse ne change pas au redémarrage.

## 3. Ouvrir les ports 80 et 443

**a) Dans Oracle** : *Réseau > Réseaux cloud virtuels > ton VCN > Listes de sécurité > Default Security List >
Ajouter des règles entrantes* :

| Source CIDR | Protocole | Port de destination |
|---|---|---|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

**b) Sur la VM** (les images Ubuntu d'Oracle bloquent tout sauf SSH). Connexion depuis ton PC (PowerShell) :

```powershell
ssh -i C:\chemin\vers\cle-privee.key ubuntu@IP_PUBLIQUE
```

Puis sur la VM :

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

## 4. Installer Docker

```bash
sudo apt-get update && sudo apt-get -y upgrade
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
exit        # puis reconnecte-toi en SSH pour que le groupe docker soit pris en compte
docker run --rm hello-world
```

Mémoire d'échange (sécurité si un pic de mémoire survient pendant la construction) :

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 5. Adresse internet gratuite (DuckDNS)

1. Sur **duckdns.org**, connecte-toi (GitHub ou Google) et crée un sous-domaine, par ex. `siga-xxx`.
2. Dans le champ « current ip », mets l'**IP publique réservée** de la VM → *update ip*.
3. Vérifie depuis ton PC : `nslookup siga-xxx.duckdns.org` doit renvoyer cette IP.

## 6. Récupérer le code

Les dépôts étant privés, on donne à la VM un accès **en lecture seule** par clé de déploiement :

```bash
ssh-keygen -t ed25519 -f ~/.ssh/siga_api -N "" -C "vm-siga-api"
ssh-keygen -t ed25519 -f ~/.ssh/siga_admin -N "" -C "vm-siga-admin"
cat ~/.ssh/siga_api.pub ~/.ssh/siga_admin.pub
```

Sur GitHub, pour **chaque** dépôt : *Settings > Deploy keys > Add deploy key* → colle la clé correspondante,
**sans** cocher « Allow write access ».

```bash
cat >> ~/.ssh/config <<'EOF'
Host github-siga-api
  HostName github.com
  IdentityFile ~/.ssh/siga_api
Host github-siga-admin
  HostName github.com
  IdentityFile ~/.ssh/siga_admin
EOF

sudo mkdir -p /opt/siga && sudo chown ubuntu:ubuntu /opt/siga && cd /opt/siga
git clone git@github-siga-api:mouhamedsylva/siga-api.git
git clone git@github-siga-admin:mouhamedsylva/siga-admin.git
```

## 7. Configuration de production

```bash
cp /opt/siga/siga-api/deploy/.env.production.example /opt/siga/.env
chmod 600 /opt/siga/.env
openssl rand -hex 24      # → MYSQL_PASSWORD
openssl rand -hex 24      # → MYSQL_ROOT_PASSWORD
nano /opt/siga/.env
```

À remplir (voir les commentaires du fichier) :
- `DOMAIN` (ex. `siga-xxx.duckdns.org`), `ACME_EMAIL`, `TERMS_URL` (`https://DOMAINE/legal/cgu`) ;
- `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD` (générés ci-dessus) ;
- `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `META_APP_SECRET` : **copiés du `.env` local** ;
- `HASH_SECRET` : **exactement le même que le `.env` local** ;
- `ADMIN_USERS` : sur ton PC, `npm run admin:hash -- admin "mot-de-passe-long"`, puis colle la ligne
  **entre apostrophes** : `ADMIN_USERS='admin:$2b$12$...'` ;
- `PAYMENT_INSTRUCTIONS`, `LEGAL_CONTACT_EMAIL`, `ADMIN_WA_ID`.

Raccourci pratique (à ajouter une fois) :

```bash
echo "alias siga='sh /opt/siga/siga-api/deploy/siga'" >> ~/.bashrc && source ~/.bashrc
```

## 8. Premier démarrage

```bash
siga up -d --build        # 5 à 10 min la première fois (construction de l'image)
siga ps                   # mysql, redis, api, caddy : « running (healthy) »
siga logs -f api          # Ctrl+C pour quitter
```

Vérifications depuis ton navigateur :
- `https://DOMAINE/health` → `{"status":"ok","db":true,"queue":true,"storage":true}` (cadenas HTTPS valide) ;
- `https://DOMAINE/backoffice/` → page de connexion du back-office ;
- `https://DOMAINE/legal/confidentialite` → politique de confidentialité.

Tout redémarre seul après un redémarrage de la VM (`sudo reboot` pour tester).

## 9. Sauvegardes

```bash
sh /opt/siga/siga-api/deploy/backup.sh            # première sauvegarde manuelle
ls -lh /opt/siga/backups
crontab -e                                         # ajouter la ligne suivante :
30 3 * * * sh /opt/siga/siga-api/deploy/backup.sh >> /opt/siga/backups/backup.log 2>&1
```

**Tester la restauration** une fois (exigence du cahier des charges, avant l'ouverture) :

```bash
sh /opt/siga/siga-api/deploy/restore.sh /opt/siga/backups/siga-AAAAMMJJ-HHMM.sql.gz
```

Pense à copier de temps en temps une sauvegarde hors de la VM (depuis ton PC) :

```powershell
scp -i C:\chemin\cle.key ubuntu@IP_PUBLIQUE:/opt/siga/backups/siga-*.sql.gz .
```

## 10. Brancher Meta

Sur developers.facebook.com, app SIGA :

1. **Configuration du webhook** : URL de rappel `https://DOMAINE/webhook`, même jeton de vérification
   (`WHATSAPP_VERIFY_TOKEN`) → *Vérifier et enregistrer* ; champ **`messages`** abonné.
   Bouton **Tester** sur `messages` → le message apparaît dans `siga logs -f api`.
2. **Paramètres de l'app > De base** :
   - URL de la politique de confidentialité : `https://DOMAINE/legal/confidentialite`
   - URL des conditions de service : `https://DOMAINE/legal/cgu`
   - Suppression des données → « URL des instructions » : `https://DOMAINE/legal/suppression-donnees`
   - icône 1024 × 1024, catégorie, e-mail de contact → *Enregistrer*.
3. **Publier l'app** : tant qu'elle n'est pas publiée, Meta ne transmet pas les vrais messages.
4. Envoie « Bonjour » au numéro SIGA depuis WhatsApp : la réponse doit arriver en quelques secondes.

Tu peux alors arrêter ngrok sur ton PC ; Laragon ne sert plus qu'au développement.

## Mises à jour

Après un `git push` depuis ton PC :

```bash
sh /opt/siga/siga-api/deploy/update.sh    # sauvegarde, git pull des 2 dépôts, reconstruction, redémarrage
```

## Commandes utiles

| Besoin | Commande |
|---|---|
| État des services | `siga ps` |
| Journaux de l'API | `siga logs -f api` |
| Redémarrer l'API | `siga restart api` |
| Créer / changer le mot de passe admin | modifier `ADMIN_USERS` dans `/opt/siga/.env`, puis `siga up -d api` |
| Console MySQL | `siga exec mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" siga'` |
| Place disque | `df -h /` et `docker system df` |

## Sécurité

- Seuls les ports 22, 80 et 443 sont ouverts ; MySQL et Redis ne sont accessibles qu'à l'intérieur de Docker.
- `/opt/siga/.env` (chmod 600) et `/opt/siga/backups` (chmod 700) contiennent des secrets : ne les copie jamais
  dans un dépôt Git.
- Connexion SSH par clé uniquement (réglage par défaut des images Oracle).
- Mises à jour système régulières : `sudo apt-get update && sudo apt-get -y upgrade`.

## En cas de problème

| Symptôme | Piste |
|---|---|
| Le site ne répond pas | ports 80/443 (étape 3, **les deux** niveaux), `siga ps`, `siga logs caddy` |
| Certificat HTTPS absent | DuckDNS pointe-t-il sur la bonne IP ? port 80 ouvert ? `siga logs caddy` |
| `api` redémarre en boucle | `siga logs api` : variable manquante (message « Configuration invalide »), mot de passe MySQL |
| Connexion admin refusée | `ADMIN_USERS` entre apostrophes, puis `siga up -d api` |
| Meta : « Impossible de valider l'URL de rappel » | `https://DOMAINE/health` doit répondre, jeton identique à `WHATSAPP_VERIFY_TOKEN` |
| Aucun message reçu | champ `messages` abonné ? app **publiée** ? |
