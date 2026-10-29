# Mise à jour vers la version 3 (synchronisation par lots, équipe multi-utilisateurs, stats précalculées)

Votre site actuel et ses données sont conservés. **Respectez l'ordre.**

## 1. Migrer la base (UNE seule fois, AVANT d'envoyer le code)
1. Cloudflare → Workers & Pages → D1 → votre base `soutrabiz-db` → onglet **Console**.
2. Ouvrez `migration-v3.sql`, copiez tout son contenu, collez-le dans la console et exécutez.
   - Si une ligne répond « duplicate column name » : cette partie est déjà faite, ce n'est pas grave.
3. L'ancien site continue de fonctionner pendant cette étape : les anciennes données sont reprises, pas supprimées.

## 2. Envoyer le nouveau code
1. Dans votre dépôt GitHub : remplacez tous les fichiers par ceux du zip
   (**gardez votre `wrangler.toml`** : il n'est pas dans le zip).
2. Cloudflare Pages redéploie automatiquement (1–2 minutes).
3. Les utilisateurs doivent fermer puis rouvrir l'application (une ancienne version ouverte affichera « Mise à jour requise »).

## 3. Nouveautés
- **Équipe** : Paramètres → « Mon équipe » (propriétaire uniquement). Créez des comptes Gérant ou Caissier : ils se connectent en même temps, chacun avec son téléphone et son mot de passe, et voient les ventes des autres en ~1 minute (immédiat au retour sur l'application).
  - Caissier : Caisse + crédits clients uniquement.
  - Gérant : tout sauf équipe, effacement de données et restauration de sauvegarde.
- **Conflits** : deux personnes qui vendent le même produit en même temps → le stock est calculé par différence (aucune vente perdue). Les paiements de dettes sont fusionnés. Si deux personnes modifient la même fiche (ex. prix), la plus récente gagne.
- **Hors-ligne** : les ventes faites sans réseau sont envoyées par lots au retour du réseau, sans doublon.
- **Admin** : liste paginée (25/page), recherche/filtres côté serveur, chiffres précalculés, export CSV complet.

## Achats à crédit et trésorerie
- **Achat à crédit** : bouton **« Achat fournisseur (à crédit) »** dans Dettes → onglet Fournisseurs, et bouton « Achat fournisseur » dans Dépenses. Aussi possible depuis Stocks → « + Réappro » (et Dépenses → catégorie Approvisionnement) : choisissez le fournisseur (ou créez-le), indiquez le montant payé maintenant (tout, moitié, rien). Le reste est ajouté automatiquement aux **dettes fournisseurs** ; le paiement ultérieur se fait dans Dettes → Fournisseurs.
- **Trésorerie** (tableau de bord) : espèces / Mobile Money / banque réellement disponibles, entrées et sorties sur 30 jours, à encaisser (clients), à payer (fournisseurs) et trésorerie nette prévue. Renseignez votre **trésorerie de départ** dans Paramètres pour qu'elle soit exacte.
- **Correction du bénéfice** : les achats de marchandises ne sont plus déduits une seconde fois du bénéfice (leur coût est déjà dans le coût des ventes).

## Hors-ligne
- Les ventes faites sans réseau restent sur l'appareil, même si vous fermez l'application, et partent automatiquement au retour de la connexion. Un compteur « N modification(s) en attente » s'affiche en bas à gauche.
- Ne vous déconnectez pas tant que ce compteur n'est pas à zéro (l'application vous prévient).
- Ne vendez pas hors-ligne avec une ancienne version de l'application encore en cache : fermez-la et rouvrez-la une fois avec du réseau après chaque mise à jour.

## Limites à connaître
- Le prix d'achat est masqué au caissier dans l'interface, mais reste dans les données synchronisées de la boutique.
- Chaque appareil garde les données de la boutique dans le navigateur (~5 Mo) : environ 5 000 à 8 000 ventes avant de devoir archiver.
- Forfait gratuit Cloudflare : 100 000 requêtes/jour. Une boutique active consomme environ 1 500 à 3 000 requêtes/jour par appareil ouvert, soit quelques dizaines de boutiques actives en pratique. Au-delà : plan Workers payant (5 $/mois).
