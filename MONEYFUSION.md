# Money Fusion (paiement en ligne international)

Abonnement annuel unique, payable :
- en local par Mobile Money (référence validée à la main par l'admin, comme avant) ;
- en ligne via **Money Fusion** pour les clients internationaux (activation automatique).

## Mode « lien de paiement » (sans API, sans IP)
Dans l'espace admin → Abonnement, collez votre lien de paiement Money Fusion (au tarif annuel) dans « Lien de paiement Money Fusion ».
Le client clique « Payer en ligne », paie, puis colle la référence dans Nafora ; vous validez dans « Paiements en attente ».

## Configuration (mode API automatique, optionnel — Money Fusion exige une IP fixe, indisponible sur Cloudflare Pages) (Cloudflare Pages → Settings → Variables and Secrets)
| Variable | Valeur |
|---|---|
| `MONEYFUSION_API_URL` (secret) | L'URL d'API de paiement de VOTRE application, copiée depuis le tableau de bord Money Fusion (de la forme `https://www.pay.moneyfusion.net/<app>/<id>/pay/`). |
| `MONEYFUSION_STATUS_URL` (optionnel) | Par défaut `https://www.pay.moneyfusion.net/paiementNotif` |

Tant que `MONEYFUSION_API_URL` est absente, l'option « International » n'apparaît pas.
Aucune migration SQL : les paiements en ligne utilisent la table `payments` (méthode `moneyfusion`, statut `mf_pending` puis `approved`).

## Sécurité
- Le retour navigateur et le webhook (`/api/billing/moneyfusion/webhook`) ne suffisent jamais à activer l'abonnement : le serveur
  interroge Money Fusion avec le jeton, exige le statut `paid` et un montant >= tarif annuel. Activation idempotente.
- Si vous renseignez une URL de webhook dans le tableau de bord Money Fusion, utilisez la même.

## À vérifier au 1er test
Les champs de la requête/réponse suivent la documentation Money Fusion (totalPrice, article, personal_Info, numeroSend, nomclient,
return_url, webhook_url → statut, token, url). Faites un paiement test de bout en bout avant d'ouvrir au public.

---
# Nouveautés : relances, résumé du soir, catalogue
- **Relances** : Dettes → Clients, encart « clients à relancer » (jamais relancés ou depuis 7 jours). Un appui ouvre WhatsApp avec le message prêt et note la relance.
- **Résumé du soir** : carte sur le tableau de bord (mise en avant dès 17 h) → « Envoyer sur mon WhatsApp ».
- **Catalogue public** : Paramètres → Catalogue en ligne → lien `/boutique/<adresse>`. Aucune migration SQL (réglages dans `app_settings`).
