# Architecture du score

Version courte du document d'architecture interne. Ce dépôt contient le **cœur pur** du moteur (formules, règles, orchestration) ; la file de calcul, la base et les appels HTTP vivent dans le monorepo privé et sont décrits ici de façon générique.

Algorithme : `legacy-compatible-v2` depuis le 14/10/2026 (`legacy-compatible-v1` avant), inscrit sur chaque calcul et chaque ligne d'historique. Un calcul mis en file avant le changement est calculé et étiqueté avec les règles en vigueur au moment du calcul.

## Vue d'ensemble

```
  Back-office          Portail déménageur        Inscription / planificateur trimestriel
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
                     │   ├─ fiche hors métier ?     src/google-trade.ts  │
                     │   ├─ exceptions à 50         src/formulas.ts      │
                     │   ├─ buildStrictGlobalScore  src/formulas.ts      │
                     │   └─ plafond hors registre   src/register-cap.ts  │
                     └────────┬─────────────────────────────────────────┘
                              │ une transaction
          score courant (1 par déménageur) + historique (jamais réécrit) + statut du job
                              │
                    alertes équipe (best-effort : ne cassent jamais le calcul)
```

## Ports et pureté

Tout ce qui touche le réseau est derrière trois ports (`src/ports.ts`). Contrat : **un provider ne lève jamais** ; une panne revient comme un instantané `available: false` portant son erreur. C'est ce qui permet à la règle stricte de dire *pourquoi* il n'y a pas de note, au lieu de planter ou d'inventer.

L'annuaire du registre des transporteurs, qui sert à chercher une entreprise absente sous un autre SIREN, arrive par le même port : champ facultatif `transportRegisterDirectory` de `RegistrySnapshot` (en production, lu dans les mêmes CSV ministériels). Absent ou `null` : l'annuaire n'a pas pu être lu, et la note n'est pas plafonnée.

`computeScore()` prend trois instantanés et rend un résultat, sans entrée/sortie. L'identité de la fiche (`mover` : nom, lieu, SIREN), facultative, ne sert qu'à cette recherche ; `scoreMover()` la passe. Les tests et la démo l'exercent avec `src/adapters/fixture-providers.ts`, qui lit des JSON de la même forme que les réponses réelles.

## La règle stricte

1. Les trois sources critiques sont interrogées : registre des entreprises, fiche Google, collecte des avis.
2. Si l'une manque, `globalScore = null`, `isReliable = false`, et `reliabilityError` liste les sources en défaut et les composantes manquantes.
3. Les sous-scores disponibles sont conservés pour l'audit, mais ne recomposent **jamais** une note partielle.
4. Deux exceptions, à 50, seulement si la source a répondu : pas de bilan publié ou dernier bilan de plus de 24 mois à la date du calcul (financier, depuis le 14/10/2026 pour l'âge du bilan), fiche sans aucune note (Google). Avis collectés mais aucun retenu : réputation et vigilance à 50 (la vigilance depuis le 14/10/2026 ; 100 avant).
4 bis. Une fiche Google **hors métier** (moins de 10 % d'avis qui parlent de déménagement, 20 % si son nom n'en dit rien, sur au moins 5 avis à texte) perd sa composante Google : pas de note globale, et la raison est écrite (`src/google-trade.ts`, depuis le 08/10/2026). Le contrôle lit toute la collecte d'avis, pas la fenêtre de la réputation.
5. Une note non fiable ne classe jamais un déménageur dans la liste et ne donne jamais de label.
6. Panne ou verdict (14/10/2026, `src/outage-policy.ts`) : chaque source en défaut porte la nature de son échec, et le résultat porte `failureKind`. Une entreprise fermée, une procédure collective en cours ou une absence du registre des transporteurs sont des verdicts, même le jour d'une panne. Quand seule une panne technique explique l'échec, que la note courante est fiable et a moins de 120 jours, et que les composantes fraîches (financier, juridique) ne sont pas pires que les siennes, la production **ne remplace pas** la note courante : elle écrit l'échec dans l'historique, ne touche pas au label, et programme une relance 24 h plus tard (3 relances d'affilée au plus, puis la note reste et l'équipe est alertée). Sans note fiable récente, la note est remplacée comme avant mais le calcul est relancé de même, avec le même compteur. Après 3 relances sans succès, le planificateur trimestriel laisse le déménageur jusqu'au cycle suivant (90 jours depuis la dernière tentative) ; une demande manuelle passe toujours. Une collecte d'avis amputée est une panne : elle ne note pas.

7. Plafond hors registre (14/10/2026, `src/register-cap.ts`) : une absence **confirmée** au registre des transporteurs (verdict `zero`) plafonne la note globale à 65, après le calcul strict. Avant, on cherche l'entreprise sous un autre SIREN dans l'annuaire du registre (même nom et même code postal ou commune ; ou gestionnaire / attestataire = dirigeant connu, même département) : une correspondance lève le plafond et produit l'avertissement `sitr_successor_candidate:<siren>`, que la production transforme en alerte à l'équipe. Seul un transporteur de marchandises inscrit lève le plafond ; un nom de commune ne compte pas comme nom ; une commune ne vaut que dans le même département ; un gérant homonyme demande en plus un mot du nom en commun ou la même commune (relecture du 15/10/2026). Registre illisible (`sitr_lookup_failed`) : pas de plafond. Annuaire non lu (`transportRegisterDirectory` absent) : pas de plafond non plus (15/10/2026), avertissement `sitr_successor_lookup_failed:no_cap` ; en production, le calcul est refait 24 h plus tard, 3 fois au plus. Le résultat garde la note avant plafond (`details.registerCap.uncappedScore`).

À l'inverse, la note *indicative* d'un devis externe (`src/indicative-score.ts`) renormalise sur les axes disponibles : c'est un autre usage, avec un autre nom, et jamais présentée comme le score Moverz. L'outil « Vérifier un déménageur » n'affiche pas cette note : il montre le Score Moverz officiel, ou dit qu'il n'est pas disponible.

## Un seul Score : l'outil « Vérifier un déménageur »

Depuis le 14/10/2026, l'outil « Vérifier un déménageur » de moverz.fr montre le Score Moverz de n'importe quelle entreprise vérifiée, inscrite chez Moverz ou non. Il ne calcule aucune note à sa façon : il montre le Score officiel, produit par la notation habituelle, avec les mêmes cinq critères, les mêmes poids, les mêmes formules et les mêmes sources (jusqu'à 50 pages d'avis, fiches Google héritées comprises). Aucune règle du cœur n'a changé.

1. **Déménageur déjà noté.** Sa note officielle est montrée avec sa date. Si elle a plus de 30 jours, l'outil demande à la file de calcul ci-dessous de relancer la notation en arrière-plan : le visiteur n'attend pas, et le calcul paie ses propres sources. Pas de nouveau calcul si un est déjà en attente ou en cours, ni si un job a été créé pour ce déménageur dans les dernières 24 h ; le nombre de calculs que l'outil peut déclencher par jour est plafonné. Une relance programmée plus tard (après une panne de source) n'est pas un calcul en cours : la note gardée est montrée, datée, sans doublon.
2. **Entreprise inconnue.** Une fiche est créée à partir de l'annuaire de l'État et de la fiche Google retenue, puis notée tout de suite par la même notation, que l'écran attend. Si le calcul dépasse l'attente, l'écran dit « en cours de calcul » et le calcul continue. Cette fiche est marquée comme créée par l'outil : non revue par l'équipe, elle n'entre ni dans la liste du client, ni dans l'annuaire, ni au Label tant qu'elle n'est pas inscrite.
3. **Pas de note inventée.** Si un critère manque, il n'y a pas de Score, et la raison est écrite : c'est la règle stricte ci-dessus, sans exception propre à l'outil.
4. **Une correction de SIREN ne reprend pas la fiche d'une autre entreprise** dans le cache Pappers (voir « Coûts et caches »).
5. **En cas de doute, des données fraîches** (15/10/2026, décision de Guillaume ; une seule note par déménageur). Doute dans deux cas : la fiche Google retenue est portée dans la base par une fiche d'un autre SIREN que l'entreprise choisie ; ou la fiche trouvée porte un SIREN fermé alors que l'entreprise choisie est active. Alors l'outil relit toutes les sources à neuf (aucun cache, aucune note reprise), puis la notation habituelle. Une fiche non inscrite est remise sur l'entreprise choisie et renotée, seulement si le nom recoupe et que la fiche Google est la même ; ses anciens numéros sont gardés et la correction est journalisée. Une fiche partenaire (en ligne, espace ouvert, dossier actif ou Label actif) n'est jamais corrigée automatiquement : la correction est proposée à l'équipe, et le Score s'affiche « en cours de vérification ». Un SIRET déjà porté par une autre fiche est signalé, sans écriture. L'outil ne crée jamais de seconde fiche et ne montre jamais une note douteuse. Ce module vit dans le monorepo privé (il écrit en base) ; aucune règle de calcul du score n'en dépend.

## File de calcul

- **Claim atomique** : lecture d'un candidat `PENDING` dû, puis mise à jour conditionnelle `WHERE id = ? AND status = 'PENDING'`. Une ligne modifiée : gagné ; zéro : un autre processus l'a pris. Sûr avec plusieurs instances, sans verrou applicatif. (`src/jobs.ts`, test de course dans `test/operations.test.ts`.)
- **Retry exponentiel** : échec d'un fournisseur → `PENDING` avec `scheduledAt = now + 2 min × 2^(tentatives − 1)` ; 3 tentatives au plus, puis `FAILED` et alerte.
- **Pas de doublon** : un calcul déjà `PENDING` ou `RUNNING` pour un déménageur n'en crée pas un second. Depuis le 14/10/2026, la lecture et la création se font sous un verrou de transaction propre au déménageur : deux demandes simultanées n'en créent qu'un. Une demande manuelle avance un calcul programmé plus tard (relance après panne).
- **Jobs orphelins** : un calcul dure 30 à 60 s ; « en cours » depuis plus de 10 minutes, il a été interrompu (redémarrage). Depuis le 14/10/2026, le worker les reprend lui-même, à son démarrage puis toutes les 10 minutes : remis en file s'il leur reste une tentative, échec définitif sinon (`staleRunningAction`, `src/jobs.ts`). L'écran de l'équipe les montre toujours comme des échecs (`src/score-watch.ts`). L'arrêt propre de l'API attend la fin du calcul en cours, 12 s au plus.
- **Une note enregistrée ne repasse jamais en échec** : une erreur après l'enregistrement (label, attestation) est journalisée et alertée, sans recalcul.
- **Propriété du job** : un calcul n'écrit sa fin que si le job est toujours le sien (même tentative) ; un signal de vie rafraîchi chaque minute fait foi pour la reprise des jobs bloqués, et un processus ne reprend jamais un job qu'il calcule lui-même.
- **Alertes** : une seule alerte par panne et par déménageur (ses relances se taisent) ; les alertes de label non synchronisé et de relances épuisées ont leur propre clé de dédoublonnage.
- Le worker ne tourne que sur les instances de production : un poste de développement ne doit jamais réclamer les jobs de la base réelle.
- **Planificateur trimestriel** (15/10/2026) : un passage par 24 h met en file le recalcul de tout déménageur montré au client (partenaires en ligne, Labels actifs, toute note fiable de plus de 75 ; avant : 85 et plus), et de toute note plafonnée par le registre des transporteurs, dont la note a plus de 90 jours. Les plus anciennes d'abord, 250 au plus par passage. Au démarrage de l'application, pas de passage si le dernier date de moins de 20 h : plusieurs mises en ligne par jour ne multiplient pas les passages. Les fiches créées par l'outil « Vérifier un déménageur » en sont exclues ; un déménageur dont les relances sont épuisées attend le cycle suivant.
- **Bilan quotidien** (14/10/2026) : chaque matin, un mail interne à l'équipe résume les dernières 24 h — calculs bloqués, échecs, pannes de source, replis du modèle de langage, notes conservées et relances en attente, dernier passage du planificateur (alerte au-delà de 36 h). Il ne part que s'il y a une anomalie.

## Coûts et caches

- **Pappers est payant** : on ne demande que le champ supplémentaire utile (`decisions`), soit ~3 crédits au lieu de ~11, et une fiche de moins de **120 jours** n'est pas rachetée. L'âge se compte depuis l'appel payé, pas depuis le dernier calcul qui l'a recyclée. Une panne (401, 429, 5xx, réseau) ne remplace jamais une fiche déjà payée (`src/pappers-cache.ts`). Depuis le 14/10/2026, une fiche payée est rangée dès sa réception : si le calcul échoue ensuite (Google ou les avis en panne), la relance la retrouve au lieu de la repayer. Depuis le 15/10/2026, une fiche n'est reprise que si elle décrit la même entreprise que la fiche du déménageur (même SIREN) : après une correction de SIREN, l'ancienne fiche n'est plus jamais réutilisée. Depuis le 15/10/2026, le recalcul trimestriel (et ses relances) relit le registre : il ne reprend qu'une fiche de moins de **7 jours** (`pickFreshPappers(…, maxAgeDays)`, `PAPPERS_QUARTERLY_MAX_AGE_DAYS`) ; le filet en cas de panne et les autres déclencheurs gardent 120 jours.
- **Analyse de devis** : la note en base d'un déménageur déjà noté est reprise jusqu'à 90 jours (180 avant le 15/10/2026), le cycle de recalcul.
- **Avis** : cache de 7 jours, versionné ; en production, les avis d'une ancienne fiche Google figée de la même entreprise (fiche fermée après un déménagement de local) s'ajoutent à la collecte de la fiche vivante, avant la fenêtre 12/24 mois et le contrôle du métier : ici, c'est au `ReviewsProvider` de les rendre ; le passage de 12 à 24 mois de collecte a invalidé les anciens caches par leur numéro de version.
- **Modèles de langage** : optionnels. La vigilance et les thèmes d'avis ont une méthode déterministe par mots-clés ; un modèle (OpenAI, repli Claude) ne fait que la remplacer quand il répond une réponse lisible, relue champ par champ (`src/llm/client.ts`, `categoriesFromLlmAnswer`). Chaque appel a un délai de 30 s ; un modèle lent ou en panne ne fait jamais échouer le calcul, et la méthode réellement utilisée (modèle ou mots-clés, avec la raison du repli) est écrite dans le détail de la note. Côté avis, chaque page de la collecte a un délai de 20 s, comme chaque appel Google Places. Pour Pappers, un HTTP 400 ou une réponse illisible sont des erreurs définitives, pas des pannes : pas de relance. Prix publics et estimation de coût dans `src/review-themes.ts`.

## Données conservées

- Score courant (une ligne par déménageur) et historique complet (une ligne par calcul, jamais réécrite).
- Les instantanés bruts des fournisseurs sont gardés avec chaque calcul : une note se ré-explique des mois plus tard, composante par composante.
- **Méthode suivie** (15/10/2026) : chaque note enregistre, critère par critère, la méthode réellement suivie (financier : natif, formule, sans chiffres, bilan de plus de 24 mois, bilan déposé ; juridique ; registre des transporteurs : inscrit, plafond, autre SIREN, registre ou annuaire illisible ; Google ; réputation ; vigilance : modèle OpenAI ou Anthropic, ou mots-clés avec la raison du repli ; lecture des avis complète ou non). Elle est lue par l'équipe au back-office, jamais par le client. Le module qui l'écrit en phrases n'est pas publié (sans effet sur la note) ; ses éléments sont dans `details` : `financialAssessment`, `registerCap`, `vigilance`, `sitrJuridicalVerdict`, `googleTrade`.
- Leçon apprise : les composantes d'un score doivent être écrites dans la même passe que le score. Les recoller après coup depuis l'historique a déjà produit des explications fausses ; depuis, une composante introuvable est effacée plutôt que devinée : une case vide se lit, un chiffre pris ailleurs se croit.

## Limites connues

- Un seul calcul à la fois par instance (suffisant au volume actuel ; pool concurrent prévu, le claim atomique restant valable).
- L'heuristique de vigilance par mots-clés produit l'essentiel des notes de production (1 182 notes fiables sur 1 188 au 08/10/2026). Elle reste prudente : un avis de 4★ qui contient un mot-clé compte comme incident, sauf, depuis le 14/10/2026, quand le mot est nié (« rien de cassé ») ou pris dans une expression positive (« dans les délais »). Les règles de négation lisent les quelques mots qui précèdent, coupés à « mais », « sauf », « par contre »… et à la ponctuation forte (relecture du 15/10/2026) : une négation lointaine ou tournée autrement n'est pas reconnue, et l'avis reste alors compté comme incident. Ses deux défauts de lecture (sous-chaînes, « Autres problèmes » qui comptait tous les avis de 4★ ou moins) sont corrigés depuis le 08/10/2026 : voir `buildHeuristicVigilance` dans `src/reputation.ts` et `docs/METIER.md` § 9.
- Contrôle du métier de la fiche : sous 5 avis à texte, on ne tranche pas. Il compte des racines de mots, sans modèle de langage : un avis qui raconte un déménagement sans aucun des mots de la liste ne compte pas pour le métier (d'où des seuils bas, 10 et 20 %).

## Tenue à jour

Ce dépôt suit le code de production. Toute modification du système de scoring dans le monorepo met à jour ce dépôt (code, tests, documentation) dans la même tâche. Un test du monorepo garde, pour chaque fichier de règles couvert, son empreinte et le commit public correspondant : modifier une règle sans mettre à jour ce dépôt le fait échouer.

Les écarts voulus avec la production sont des adaptations, pas des différences de règles : ports à la place des appels HTTP et de la base, modèles de langage injectés (`src/llm/client.ts`), date de référence passée en paramètre (`now`) pour que les tests soient déterministes, et filtres opérationnels de la liste (déménageurs de test, couverture géographique, dépublication) laissés hors du cœur.
