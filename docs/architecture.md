# Architecture du score

Version courte du document d'architecture interne. Ce dépôt contient le **cœur pur** du moteur (formules, règles, orchestration) ; la file de calcul, la base et les appels HTTP vivent dans le monorepo privé et sont décrits ici de façon générique.

Algorithme : `legacy-compatible-v1`, inscrit sur chaque calcul et chaque ligne d'historique.

## Vue d'ensemble

```
  Back-office          Portail déménageur        Inscription / planificateur mensuel
       │                      │                              │
       └──────────── mise en file d'un calcul ───────────────┘
                              │
                     ┌────────▼─────────┐
                     │  file ScoringJob  │  PENDING → RUNNING → SUCCEEDED / FAILED_PARTIAL / FAILED
                     └────────┬─────────┘
                              │ claim atomique (worker)
                     ┌────────▼─────────────────────────────────────────┐
                     │ scoreMover()                     src/compute.ts   │
                     │   ├─ RegistryProvider   Pappers v2 + SITR + Sirene│
                     │   ├─ PlacesProvider     Google Places v1          │  ← en parallèle
                     │   └─ ReviewsProvider    avis paginés (24 mois)    │  ← après la fiche
                     │ computeScore()  (pur, déterministe sans LLM)      │
                     │   ├─ fenêtre 12/24 mois      src/review-window.ts │
                     │   ├─ réputation, vigilance   src/reputation.ts    │
                     │   ├─ SITR, Sirene → juridique src/sitr-juridical.ts│
                     │   ├─ exceptions à 50         src/formulas.ts      │
                     │   └─ buildStrictGlobalScore  src/formulas.ts      │
                     └────────┬─────────────────────────────────────────┘
                              │ une transaction
          score courant (1 par déménageur) + historique (jamais réécrit) + statut du job
                              │
                    alertes équipe (best-effort : ne cassent jamais le calcul)
```

## Ports et pureté

Tout ce qui touche le réseau est derrière trois ports (`src/ports.ts`). Contrat : **un provider ne lève jamais** ; une panne revient comme un instantané `available: false` portant son erreur. C'est ce qui permet à la règle stricte de dire *pourquoi* il n'y a pas de note, au lieu de planter ou d'inventer.

`computeScore()` prend trois instantanés et rend un résultat, sans entrée/sortie. Les tests et la démo l'exercent avec `src/adapters/fixture-providers.ts`, qui lit des JSON de la même forme que les réponses réelles.

## La règle stricte

1. Les trois sources critiques sont interrogées : registre des entreprises, fiche Google, collecte des avis.
2. Si l'une manque, `globalScore = null`, `isReliable = false`, et `reliabilityError` liste les sources en défaut et les composantes manquantes.
3. Les sous-scores disponibles sont conservés pour l'audit, mais ne recomposent **jamais** une note partielle.
4. Deux exceptions, à 50, seulement si la source a répondu : pas de bilan publié (financier), fiche sans aucune note (Google).
5. Une note non fiable ne classe jamais un déménageur dans la liste et ne donne jamais de label.

À l'inverse, la note *indicative* d'un devis externe (`src/indicative-score.ts`) renormalise sur les axes disponibles : c'est un autre usage, avec un autre nom, et jamais présenté comme le score Moverz.

## File de calcul

- **Claim atomique** : lecture d'un candidat `PENDING` dû, puis mise à jour conditionnelle `WHERE id = ? AND status = 'PENDING'`. Une ligne modifiée : gagné ; zéro : un autre processus l'a pris. Sûr avec plusieurs instances, sans verrou applicatif. (`src/jobs.ts`, test de course dans `test/operations.test.ts`.)
- **Retry exponentiel** : échec d'un fournisseur → `PENDING` avec `scheduledAt = now + 2 min × 2^(tentatives − 1)` ; 3 tentatives au plus, puis `FAILED` et alerte.
- **Pas de doublon** : un calcul déjà `PENDING` ou `RUNNING` pour un déménageur n'en crée pas un second.
- **Jobs orphelins** : un calcul dure 30 à 60 s ; « en cours » depuis plus de 10 minutes, il a été interrompu (redémarrage) et compte comme un échec, qu'un geste de l'équipe peut clore et relancer (`src/score-watch.ts`).
- Le worker ne tourne que sur les instances de production : un poste de développement ne doit jamais réclamer les jobs de la base réelle.
- Planificateur : recalcul mensuel des déménageurs labellisés ou partenaires dont la note a plus de 30 jours.

## Coûts et caches

- **Pappers est payant** : on ne demande que le champ supplémentaire utile (`decisions`) — ~3 crédits au lieu de ~11 — et une fiche de moins de **120 jours** n'est pas rachetée. L'âge se compte depuis l'appel payé, pas depuis le dernier calcul qui l'a recyclée. Une panne (401, 429, 5xx, réseau) ne remplace jamais une fiche déjà payée (`src/pappers-cache.ts`).
- **Avis** : cache de 7 jours, versionné ; le passage de 12 à 24 mois de collecte a invalidé les anciens caches par leur numéro de version.
- **Modèles de langage** : optionnels. La vigilance et les thèmes d'avis ont une méthode déterministe par mots-clés ; un modèle (OpenAI, repli Claude) ne fait que la remplacer quand il répond une réponse lisible, relue champ par champ (`src/llm/client.ts`, `categoriesFromLlmAnswer`). Prix publics et estimation de coût dans `src/review-themes.ts`.

## Données conservées

- Score courant (une ligne par déménageur) et historique complet (une ligne par calcul, jamais réécrite).
- Les instantanés bruts des fournisseurs sont gardés avec chaque calcul : une note se ré-explique des mois plus tard, composante par composante.
- Leçon apprise : les composantes d'un score doivent être écrites dans la même passe que le score. Les recoller après coup depuis l'historique a déjà produit des explications fausses ; depuis, une composante introuvable est effacée plutôt que devinée — une case vide se lit, un chiffre pris ailleurs se croit.

## Limites connues

- Un seul calcul à la fois par instance (suffisant au volume actuel ; pool concurrent prévu, le claim atomique restant valable).
- L'heuristique de vigilance est volontairement pessimiste (sous-chaînes, « Autres » compte toute préoccupation) ; voir le commentaire de `buildHeuristicVigilance` dans `src/reputation.ts`.
