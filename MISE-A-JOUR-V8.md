# Mise à jour v8 — Catalogue en ligne avec photos

## Ce qui change
- **Nouvelle page catalogue** (`/boutique/<adresse>`) : bandeau d'accueil aux couleurs Nafora, boutons WhatsApp / Appeler,
  recherche, filtres par rayon, produits en cartes avec photo, panier et commande WhatsApp (nom + précisions), mode nuit automatique.
- **Photos des produits** : Stock → modifier (ou créer) un article → « Ajouter une photo ». La photo est réduite sur le téléphone
  (720 px, ≈ 40 Ko) avant l'envoi. Vignettes dans la liste du stock.
- Les photos sont enregistrées dans la base D1 (aucune configuration supplémentaire). Limites : 130 Ko par photo, 200 photos par boutique.

## À faire une seule fois (avant de déployer)
1. Console Cloudflare → D1 → `soutrabiz-db` → Console → coller le contenu de **`migration-v8.sql`** (une seule ligne, sans commentaire) → Exécuter.
2. Déployer le projet comme d'habitude.
Sans l'étape 1, le catalogue reste visible mais sans photos (l'envoi de photo affiche une erreur).
