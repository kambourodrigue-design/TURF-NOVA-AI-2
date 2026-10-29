# Mise en ligne de Nafora sur Cloudflare (Pages + base D1)

Le site gère maintenant de vrais comptes (inscription / connexion par mot de passe) et un espace admin.
Les données sont stockées dans une base **Cloudflare D1**. 
⚠️ Le glisser-déposer de dossier dans Cloudflare **ne gère pas** l'API : utilisez la méthode A (GitHub) ou B (ligne de commande).

## Étape 1 (commune) : créer la base de données
1. dash.cloudflare.com → **Storage & Databases** → **D1 SQL Database** → **Create database** → nom : `soutrabiz-db`.
2. Copiez le **Database ID** affiché.
3. Ouvrez l'onglet **Console** de la base, collez TOUT le contenu du fichier `schema.sql`, cliquez **Execute**.
4. Dans le fichier `wrangler.toml`, remplacez `REMPLACER_PAR_VOTRE_DATABASE_ID` par votre Database ID,
   et vérifiez que `ADMIN_EMAIL` est bien l'email qui sera administrateur.

## Méthode A : via GitHub (sans ligne de commande)
1. Créez un dépôt GitHub (privé) et envoyez-y tous les fichiers du projet (sans `node_modules` ni `dist`).
2. Cloudflare → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → choisissez le dépôt.
3. Réglages : Framework **Vite**, Build command `npm run build`, Output directory `dist`,
   variable d'environnement `NODE_VERSION` = `22`.
4. **Save and Deploy**. Le site est en ligne sur `https://<nom>.pages.dev`.

## Méthode B : ligne de commande
```bash
npm install
npx wrangler login
npm run build
npx wrangler d1 execute soutrabiz-db --remote --file=schema.sql   # si pas déjà fait en console
npx wrangler pages deploy dist --project-name soutrabiz
```

## Devenir administrateur
Allez sur votre site → **Créer un compte** avec l'email `ADMIN_EMAIL` (celui de `wrangler.toml`).
Ce compte reçoit automatiquement le rôle **admin** et l'onglet « Admin & PME ».
Les autres inscrits sont des commerçants.

## Fonctions admin
Liste des commerçants avec chiffre d'affaires réel, recherche et filtres, suspension / réactivation,
**réinitialisation du mot de passe** (pas d'envoi d'email : l'admin choisit un mot de passe et le transmet),
suppression de compte, consultation de la boutique d'un client (lecture seule), export CSV.

## Test en local (optionnel)
```bash
npm run build
npx wrangler d1 execute soutrabiz-db --local --file=schema.sql
npx wrangler pages dev dist --d1 DB=<database_id>
```
