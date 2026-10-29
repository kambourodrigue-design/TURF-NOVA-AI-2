# Assistant IA gratuit (v3.1)

Nouveautés : onglet **Assistant ✨** (questions en français sur vos chiffres), **Conseils du jour**, et bouton **Relance IA** (message WhatsApp rédigé par l'IA) dans *Dettes*.
Réservé au propriétaire et au gérant (pas aux caissiers). Aucune migration D1 nécessaire.

## Activer (2 minutes)
1. Cloudflare → Workers & Pages → votre projet → **Settings** → **Bindings** → **Add** → **Workers AI**.
2. Nom de la variable : `AI` → Save. (Faites-le pour Production, et Preview si utilisé.)
3. Redéployez (envoyez les fichiers sur GitHub ou « Retry deployment »).

Sans cette liaison, l'assistant affiche « indisponible » et le reste de l'application fonctionne normalement ; la relance WhatsApp retombe sur le message standard.

## Limites et coûts
- Gratuit : 10 000 « neurones » par jour pour tout le compte Cloudflare (≈ plusieurs centaines de questions/jour au total). Au-delà : refus poli, ou ~0,011 $ / 1 000 neurones si vous passez en payant.
- Quotas intégrés : 15 demandes/jour par boutique, 400/jour pour toute la plateforme. Réglables (variables d'environnement, optionnelles) : `AI_DAILY_SHOP`, `AI_DAILY_GLOBAL`, `AI_MODEL`.
- Confidentialité : seul un résumé de chiffres est envoyé (aucun téléphone ni nom de client ; seul le prénom pour une relance).
- Bon en français ; pas de dioula/mooré. L'IA peut se tromper : elle se base uniquement sur les chiffres fournis.

## Fichiers modifiés / ajoutés
functions/_lib/ai.ts, functions/_lib/util.ts, functions/api/[[path]].ts, src/services/{api,aiSummary}.ts, src/components/assistant/AssistantView.tsx, src/components/debts/DebtsView.tsx, src/components/common/{Navbar,BottomNav}.tsx, src/App.tsx

## Saisie de vente à la voix (v3.2)
Dans **Caisse**, bouton **Dicter** : dites ou tapez « deux sucre, une huile, à crédit pour Moussa ». L'application reconnaît les articles, vous les montre (quantités modifiables, produit corrigeable), puis les ajoute au panier. Rien n'est enregistré avant l'encaissement habituel.
- Micro : reconnaissance vocale du navigateur (gratuite, meilleure sur Chrome/Android, nécessite internet). Sans micro : tapez la phrase ou utilisez le micro du clavier du téléphone.
- Les caissiers peuvent l'utiliser. Quota séparé : 60 dictées/jour/boutique (`AI_DAILY_SALE`), et compte dans le total plateforme.
- Si l'IA est indisponible ou hors quota, une analyse simple (chiffres + nom d'article) prend le relais.
- Fichiers : functions/_lib/{ai,util}.ts, src/services/voiceSale.ts, src/components/pos/{POSView,VoiceSaleModal}.tsx
