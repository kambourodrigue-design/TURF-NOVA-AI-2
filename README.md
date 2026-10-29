> **Mise en ligne avec comptes + espace admin : voir `DEPLOY.md`** (Cloudflare Pages + D1).

# Nafora 🚀

Application complète de gestion commerciale et score de crédit pour les commerçants et PME d'Afrique de l'Ouest.

## Fonctionnalités
- **Caisse rapide (POS)** : Ventes en 3 clics, espèces et Mobile Money (Wave, Orange Money, MTN MoMo, MoMo, etc.).
- **Gestion des stocks & alertes** : Suivi des marges, seuils d'alerte, coût de revient.
- **Suivi des créances clients** : Carnet de crédit, relances automatiques par WhatsApp.
- **Suivi des dettes fournisseurs** : Dépôts, grossistes, échéances et paiements.
- **Ratios financiers & BFR** : Marge nette, point mort (seuil de rentabilité), besoin en fonds de roulement, graphique Recharts sur 6 mois.
- **Score de crédit bancaire** : Solvabilité sur 1000 points et dossier de demande de prêt imprimable / PDF pour les banques et microfinances (Cofina, Baobab, Advans, Coris Bank).
- **Progressive Web App (PWA)** : 100% hors-ligne et installable sur smartphone.

---

## ⚡ Déploiement en 2 minutes sur VERCEL

1. Créez un compte gratuit sur [Vercel.com](https://vercel.com) si ce n'est pas déjà fait.
2. Cliquez sur **Add New Project**.
3. Importez votre dépôt GitHub (ou téléversez le code source).
4. Paramètres de compilation :
   - **Framework Preset** : `Vite`
   - **Build Command** : `npm run build`
   - **Output Directory** : `dist`
   - **Install Command** : `npm install`
5. Cliquez sur **Deploy**. Votre site est en ligne avec un lien HTTPS instantané !

---

## ⚡ Déploiement sur CLOUDFLARE PAGES

### Méthode 1 : Glisser-Déposer direct (Sans Git, en 30 secondes)
1. Allez sur le tableau de bord [Cloudflare](https://dash.cloudflare.com) > **Workers & Pages** > **Create application** > **Pages** > **Upload assets**.
2. Nommez votre projet (ex. `soutrabiz`).
3. Glissez-déposez simplement le contenu du dossier `dist/` (ou l'archive `nafora-dist.zip` décompressée).
4. Cliquez sur **Deploy site**. C'est terminé !

### Méthode 2 : Déploiement Git
1. Connectez votre dépôt GitHub dans **Cloudflare Pages**.
2. Paramètres de build :
   - **Build command** : `npm run build`
   - **Build output directory** : `dist`
   - **Node.js version** : `20` ou `22` (variable d'environnement `NODE_VERSION=20`)
3. Cliquez sur **Save and Deploy**.

---

## 🛠️ Exécution en local

```bash
# Installation des dépendances
npm install

# Lancement du serveur de développement (Port 3000)
npm run dev

# Compilation pour la production
npm run build
```
