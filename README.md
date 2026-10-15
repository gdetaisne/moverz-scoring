# Score de fiabilité des déménageurs Moverz

[Moverz](https://moverz.fr) est une place de marché du déménagement : le client décrit son déménagement une fois, compare jusqu'à 10 devis de déménageurs, prix fermes, côte à côte, et choisit lui-même le sien. La liste est classée par prix, ou par avis Google. Le **score de fiabilité sur 5 axes**, calculé à partir de registres publics et des avis clients, ne classe pas cette liste : il décide qui peut y entrer (une note fiable de plus de 75/100).

Ce dépôt publie le **cœur de ce score**, avec ses vrais poids et ses vrais seuils : les clients et les déménageurs doivent pouvoir vérifier comment ils sont notés.

La méthode expliquée aux particuliers, avec les chiffres de la sélection : [moverz.fr/chiffres-cles/selection-des-demenageurs](https://moverz.fr/chiffres-cles/selection-des-demenageurs/). Les déménageurs retenus, avec leur note : [l'annuaire Moverz](https://moverz.fr/annuaire/).

## Ce que ce dépôt montre

**1. Des sources variées, chacune lue pour ce qu'elle dit.**
- Registre des entreprises, API Pappers v2 (bilans, décisions de justice, procédures, BODACC) : [`src/pappers.ts`](src/pappers.ts), coût et cache dans [`src/pappers-cache.ts`](src/pappers-cache.ts)
- Registre des transporteurs (SITR, CSV ministériels, licences LTI / LC) : [`src/transport-register.ts`](src/transport-register.ts), [`src/sitr-juridical.ts`](src/sitr-juridical.ts)
- Google Places et rapprochement fiche ↔ entreprise : [`src/google-matching.ts`](src/google-matching.ts), puis contrôle du métier de la fiche : [`src/google-trade.ts`](src/google-trade.ts)
- Analyse des avis, modèle de langage optionnel avec repli : [`src/reputation.ts`](src/reputation.ts), [`src/review-themes.ts`](src/review-themes.ts), [`src/llm/client.ts`](src/llm/client.ts)
- Bilan PDF téléversé, extrait par un modèle puis validé : [`src/financial-override.ts`](src/financial-override.ts)

**2. Le détail qui fait la différence.**
- Avis non informatifs : deux signaux sur trois, et l'histoire d'un quatrième retiré après mesure : [`detectFakeReviews`](src/reputation.ts)
- Fenêtre de lecture adaptative 12 / 24 mois : [`src/review-window.ts`](src/review-window.ts)
- Plafonds de volume (60 / 75 / 88) et seuils de vigilance en proportions (1 % / 3 %) : [`src/reputation.ts`](src/reputation.ts)
- Six catégories d'incidents, casse et vol à 30 % chacune : [`VIGILANCE_CATEGORIES`](src/reputation.ts) ; une tournure niée (« rien de cassé ») ou positive (« dans les délais ») n'est pas un incident : [`isNeutralisedOccurrence`](src/reputation.ts)
- Le bilan lu est toujours le plus récent, et un bilan de plus de 24 mois ne note plus : [`assessLegacyFinancial`](src/formulas.ts)
- Une fiche Google dont les avis ne parlent pas de déménagement n'est pas celle d'un déménageur : [`assessGoogleTrade`](src/google-trade.ts)

**3. Des contrôles structurés : pas de note inventée.**
- Aucune note globale sans les 5 composantes, et exactement deux exceptions codifiées à 50 : [`buildStrictGlobalScore`, `financialScoreForGlobal`, `googleScoreForGlobal`](src/formulas.ts)
- Orchestration pure, trois instantanés en entrée : [`src/compute.ts`](src/compute.ts)
- Absence confirmée au registre des transporteurs : note plafonnée à 65, sauf si l'entreprise y figure sous un autre SIREN : [`src/register-cap.ts`](src/register-cap.ts)
- Exclusions sur la santé de l'entreprise (cessée, radiée, procédure collective) : [`src/company-health.ts`](src/company-health.ts), [`src/label.ts`](src/label.ts), [`src/mover-list.ts`](src/mover-list.ts)
- File de calcul : claim atomique, retry exponentiel, jobs orphelins : [`src/jobs.ts`](src/jobs.ts), [`src/score-watch.ts`](src/score-watch.ts)
- Tests : [`test/`](test/), par exemple [`test/compute.test.ts`](test/compute.test.ts)

**4. Un seul score, une seule méthode.**
- Sur moverz.fr, l'outil « Vérifier un déménageur » ne calcule aucune note à sa façon : il montre le Score Moverz officiel, produit par la notation habituelle (mêmes critères, mêmes poids, mêmes formules, mêmes sources). Une entreprise que la base ne connaît pas reçoit une fiche et est notée par cette même notation ; une note de plus de 30 jours est recalculée en arrière-plan. Depuis le 15/10/2026, en cas de doute sur l'entreprise (sa fiche Google est portée chez nous par une fiche d'un autre SIREN, ou le SIREN enregistré est fermé alors que l'entreprise choisie est active), l'outil relit toutes les sources à neuf, remet la fiche existante sur la bonne entreprise quand c'est sûr, ne crée jamais de seconde fiche et ne montre jamais une note douteuse. Détail dans [`docs/architecture.md`](docs/architecture.md#un-seul-score--loutil-vérifier-un-déménageur) ; aucune règle du cœur n'a changé.

**5. Du métier, pas seulement du code.** [`docs/METIER.md`](docs/METIER.md) : ce qui rend un déménageur fiable, pourquoi chaque poids, licences de transport, procédures collectives, pourquoi la casse et le vol pèsent le plus, les seuils révisés sur mesures réelles, le « motif principal ». Architecture : [`docs/architecture.md`](docs/architecture.md).

## Les 5 axes

| Axe | Poids | Calcul (résumé) |
|---|---|---|
| Financier | 12,5 % | Résultat /25, fonds propres /25, trésorerie /20, endettement /15, tendance /15, sur l'exercice le plus récent, ou le scoring Pappers sur 20 × 5 ; dernier bilan clôturé il y a plus de 24 mois = 50 |
| Juridique | 12,5 % | 100 − 25 par décision récente (moins de 3 ans) ou − 10 si ancienne, − 15 de plus si grave ; **0** hors registre des transporteurs ou entreprise fermée |
| Google | 20 % | (note / 5) × 100 + bonus de volume (10 au plus) ; plafond 75 jusqu'à 10 avis, puis + 2,5 par avis, aucun plafond dès 20 avis ; **retiré** si la fiche est hors métier |
| Réputation | 20 % | (1 − part d'avis négatifs) × 100 sur les avis authentiques ; plafonds 60 / 75 / 88 sous 5 / 10 / 25 avis |
| Vigilance | 35 % | 6 catégories pondérées ; par catégorie, moins de 1 % des avis = 100, de 1 à 3 % = 50, plus de 3 % = 0 ; aucun avis retenu = 50 |

Au-delà des cinq axes : une absence **confirmée** au registre des transporteurs plafonne la note globale à **65** (sauf si l'entreprise y figure sous un autre SIREN ; un registre illisible ne pénalise pas).

Libellés : Excellent ≥ 85 · Bon ≥ 70 · Correct ≥ 50 · Fragile ≥ 30 · Critique.

## Du score à la liste

- Le client choisit. La liste est classée par prix (du moins cher au plus cher), ou par avis Google : jamais par le score.
- Le score filtre : n'entrent que les déménageurs à la note **fiable** de **plus de 75/100** (une note de 75 n'entre pas), dont l'entreprise est saine (ni cessée, ni radiée, ni en procédure collective).
- Mécanique interne du code, qui n'est pas une promesse faite au client : les places sont réparties en deux catégories, 4 « Confirmés » (note de 85 et plus) et 6 « Dynamiques » (de 76 à 84) ; une place non remplie revient à l'autre catégorie ([`src/mover-list.ts`](src/mover-list.ts)). Quand un département compte plus de déménageurs éligibles que de places, les déménageurs sous contrat avec Moverz passent d'abord, puis la note départage : c'est le seul endroit où le score ordonne, et il ne décide pas de l'ordre affiché au client.

## Lancer

```bash
npm ci && npm test
npx tsx examples/score-a-mover.ts
```

La démo note cinq déménageurs **fictifs** ([`fixtures/`](fixtures/)) sans réseau ni modèle de langage :

| Cas | Note | Ce qu'il montre |
|---|---|---|
| Déménagements Exemple | 92, Excellent | Entre dans la liste (catégorie interne « Confirmés ») ; 2 avis écartés ; motif principal : vigilance |
| Transports Modèle | 86, Excellent | Pas de bilan publié → financier 50 ; peu d'avis récents → fenêtre 24 mois ; 17 avis Google → plafond Google 92,5 (83, Bon, avant le 14/10/2026, quand le plafond était 75 sous 20 avis) ; catégorie interne « Confirmés » |
| Déménagement Fragile | 59, Correct | Licence périmée → juridique 0 (et note plafonnée à 65, sans effet ici) ; procédure collective → n'entre jamais dans la liste ; « devis » seul n'est plus un incident (58 avant le 14/10/2026) |
| Déménageurs Introuvables | aucune | Pas de fiche Google rattachable → pas de note globale, et la raison |
| Transports Voisin | aucune | Fiche rattachée par l'adresse, mais d'un autre métier (0 avis sur 30 parle de déménagement) → composante Google retirée, pas de note globale |

## Changements des 14 et 15 octobre 2026

Décisions de Guillaume Stehelin de Taisne. Version des règles : `legacy-compatible-v2`. Le pourquoi et des exemples chiffrés (fictifs) : [`docs/METIER.md`](docs/METIER.md#12-les-règles-des-14-et-15-octobre-2026).

1. **Le bilan le plus récent (14/10).** Toujours l'exercice le plus récent, complété par le précédent sauf pour le résultat ; un dernier bilan clôturé il y a plus de 24 mois compte comme « pas de chiffres » : financier 50, sans plancher.
2. **Les négations ne sont plus des incidents (14/10, relu le 15/10).** « Rien de cassé », « jamais en retard », « dans les délais », « devis respecté » ne comptent plus ; « devis » et « tarif » seuls non plus. Mais une négation s'arrête à « mais », « sauf », « par contre » ou à un point, et ne couvre pas un vrai incident : « pas de casse mais trois heures de retard » reste un retard.
3. **Aucun avis retenu : vigilance 50 (14/10).** Avant : 100, l'absence d'avis valait un sans-faute.
4. **Plafond Google progressif (14/10).** 75 jusqu'à 10 avis, + 2,5 par avis, plus de plafond à 20 avis.
5. **Absence au registre des transporteurs : 65 au plus (14/10, précisé le 15/10).** Sauf si l'entreprise y figure sous un autre SIREN comme transporteur de marchandises (l'équipe vérifie) ; un registre ou un annuaire illisible ne pénalise pas, et le calcul est refait 24 h plus tard.
6. **Fraîcheur de 90 jours (15/10).** Toute note montrée au client, et toute note plafonnée par le registre, est recalculée tous les 90 jours, avec une fiche Pappers relue ; l'analyse de devis reprend une note de moins de 90 jours.
7. **La méthode suivie, enregistrée avec chaque note (15/10).** Critère par critère, lisible par l'équipe seulement.
8. **« Vérifier un déménageur » : en cas de doute, des données fraîches (15/10).** Fiche remise sur la bonne entreprise quand c'est sûr, jamais pour un partenaire sans l'équipe, jamais de seconde fiche ni de note douteuse. Détail : [`docs/METIER.md`](docs/METIER.md) (§ 7, « Un seul Score ») et [`docs/architecture.md`](docs/architecture.md#un-seul-score--loutil-vérifier-un-déménageur).

## Comment ce dépôt est tenu à jour

Le score tourne en production depuis le monorepo privé de Moverz ; ce dépôt en est la copie publique. Règle, inscrite dans les consignes du monorepo : **toute modification du système de scoring met à jour ce dépôt (code, tests et documentation) dans la même tâche.**

Un test du monorepo la fait respecter : il garde l'empreinte de chaque fichier de règles de production couvert et le commit de ce dépôt qui lui correspond. Une règle modifiée sans mise à jour d'ici fait échouer ce test, avec la marche à suivre. Le code publié n'est pas une copie mot pour mot : la base, les appels HTTP et les modèles de langage sont remplacés par des ports (`src/ports.ts`, `src/llm/client.ts`) ; les règles, les poids et les seuils, eux, sont les mêmes.

Les données de ce dépôt sont fictives : aucune entreprise, aucun SIREN, aucun avis réel.

## Chiffres

**Ce dépôt** : 27 modules TypeScript (3 883 lignes non vides), 182 tests (`node:test`, 16 fichiers), une seule dépendance d'exécution (`zod`).

**Le monorepo privé dont il est extrait** (non publié) : 2 505 commits d'avril à octobre 2026, 474 fichiers de tests ; applications API, tunnel client, portail déménageur, back-office. Ce qui n'est pas ici : moteur de prix, base de données, appels HTTP aux fournisseurs, interfaces.

## Comment c'est fait

Construit avec des agents IA, sous ma direction : spécifications, revue, tests.

---

Guillaume Stehelin de Taisne · [teneo-services.com](https://teneo-services.com)

Tous droits réservés : lecture et évaluation uniquement, voir [`LICENSE`](LICENSE).
