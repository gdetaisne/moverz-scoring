# Score de fiabilité des déménageurs Moverz

[Moverz](https://moverz.fr) est une place de marché du déménagement : le client décrit son déménagement une fois et reçoit jusqu'à 10 devis fermes. Les déménageurs proposés sont choisis par un **score de fiabilité sur 5 axes**, calculé à partir de registres publics et des avis clients.

Ce dépôt publie le **cœur de ce score**, avec ses vrais poids et ses vrais seuils : les clients et les déménageurs partenaires doivent pouvoir vérifier comment ils sont notés.

## Ce que ce dépôt montre

**1. Des sources variées, chacune lue pour ce qu'elle dit.**
- Registre des entreprises, API Pappers v2 (bilans, décisions de justice, procédures, BODACC) : [`src/pappers.ts`](src/pappers.ts), coût et cache dans [`src/pappers-cache.ts`](src/pappers-cache.ts)
- Registre des transporteurs (SITR, CSV ministériels, licences LTI / LC) : [`src/transport-register.ts`](src/transport-register.ts), [`src/sitr-juridical.ts`](src/sitr-juridical.ts)
- Google Places et rapprochement fiche ↔ entreprise : [`src/google-matching.ts`](src/google-matching.ts)
- Analyse des avis, modèle de langage optionnel avec repli : [`src/reputation.ts`](src/reputation.ts), [`src/review-themes.ts`](src/review-themes.ts), [`src/llm/client.ts`](src/llm/client.ts)
- Bilan PDF téléversé, extrait par un modèle puis validé : [`src/financial-override.ts`](src/financial-override.ts)

**2. Le détail qui fait la différence.**
- Avis non informatifs : deux signaux sur trois, et l'histoire d'un quatrième retiré après mesure — [`detectFakeReviews`](src/reputation.ts)
- Fenêtre de lecture adaptative 12 / 24 mois : [`src/review-window.ts`](src/review-window.ts)
- Plafonds de volume (60 / 75 / 88) et seuils de vigilance en proportions (1 % / 3 %) : [`src/reputation.ts`](src/reputation.ts)
- Six catégories d'incidents, casse et vol à 30 % chacune : [`VIGILANCE_CATEGORIES`](src/reputation.ts)

**3. Des contrôles structurés : pas de note inventée.**
- Aucune note globale sans les 5 composantes, et exactement deux exceptions codifiées à 50 : [`buildStrictGlobalScore`, `financialScoreForGlobal`, `googleScoreForGlobal`](src/formulas.ts)
- Orchestration pure, trois instantanés en entrée : [`src/compute.ts`](src/compute.ts)
- Exclusions sur la santé de l'entreprise (cessée, radiée, procédure collective) : [`src/company-health.ts`](src/company-health.ts), [`src/label.ts`](src/label.ts), [`src/mover-list.ts`](src/mover-list.ts)
- File de calcul : claim atomique, retry exponentiel, jobs orphelins : [`src/jobs.ts`](src/jobs.ts), [`src/score-watch.ts`](src/score-watch.ts)
- Tests : [`test/`](test/) — par exemple [`test/compute.test.ts`](test/compute.test.ts)

**4. Du métier, pas seulement du code.** [`docs/METIER.md`](docs/METIER.md) : ce qui rend un déménageur fiable, pourquoi chaque poids, licences de transport, procédures collectives, pourquoi la casse et le vol pèsent le plus, les seuils révisés sur mesures réelles, le « motif principal ». Architecture : [`docs/architecture.md`](docs/architecture.md).

## Les 5 axes

| Axe | Poids | Calcul (résumé) |
|---|---|---|
| Financier | 12,5 % | Résultat /25, fonds propres /25, trésorerie /20, endettement /15, tendance /15 — ou le scoring Pappers sur 20 × 5 |
| Juridique | 12,5 % | 100 − 25 par décision récente (< 3 ans) ou − 10 si ancienne, − 15 de plus si grave ; **0** hors registre des transporteurs ou entreprise fermée |
| Google | 20 % | (note / 5) × 100 + bonus de volume (≤ 10) ; plafond 75 sous 20 avis |
| Réputation | 20 % | (1 − part d'avis négatifs) × 100 sur les avis authentiques ; plafonds 60 / 75 / 88 sous 5 / 10 / 25 avis |
| Vigilance | 35 % | 6 catégories pondérées ; par catégorie < 1 % des avis = 100, 1–3 % = 50, > 3 % = 0 |

Libellés : Excellent ≥ 85 · Bon ≥ 70 · Correct ≥ 50 · Fragile ≥ 30 · Critique.

## La règle de sélection

- **Confirmés** : note fiable **≥ 85** (seuil du label Excellent) — **4 places**.
- **Dynamiques** : note fiable **> 75** — **6 places**. Une note de 75 n'entre pas.
- Une place non remplie revient à l'autre catégorie. Jamais de note non fiable, jamais d'entreprise cessée, radiée ou en procédure collective.

## Lancer

```bash
npm ci && npm test
npx tsx examples/score-a-mover.ts
```

La démo note quatre déménageurs **fictifs** ([`fixtures/`](fixtures/)) sans réseau ni modèle de langage :

| Cas | Note | Ce qu'il montre |
|---|---|---|
| Déménagements Exemple | 92, Excellent | Proposé en « Confirmés » ; 2 avis écartés ; motif principal : vigilance |
| Transports Modèle | 83, Bon | Pas de bilan publié → financier 50 ; peu d'avis récents → fenêtre 24 mois ; « Dynamiques » |
| Déménagement Fragile | 58, Correct | Licence périmée → juridique 0 ; procédure collective → jamais proposé |
| Déménageurs Introuvables | aucune | Pas de fiche Google rattachable → pas de note globale, et la raison |

## Chiffres

**Ce dépôt** : 24 modules TypeScript (2 810 lignes non vides), 131 tests (`node:test`, 13 fichiers), une seule dépendance d'exécution (`zod`).

**Le monorepo privé dont il est extrait** (non publié) : 2 505 commits d'avril à octobre 2026, 474 fichiers de tests ; applications API, tunnel client, portail déménageur, back-office. Ce qui n'est pas ici : moteur de prix, base de données, appels HTTP aux fournisseurs, interfaces.

## Comment c'est fait

Construit avec des agents IA, sous ma direction : spécifications, revue, tests.

---

Guillaume Stehelin de Taisne · [teneo-services.com](https://teneo-services.com)

Tous droits réservés — lecture et évaluation uniquement, voir [`LICENSE`](LICENSE).
