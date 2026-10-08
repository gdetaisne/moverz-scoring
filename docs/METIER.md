# Le métier derrière le score

Ce document explique **pourquoi** le score est construit ainsi. Le code dit comment ; ici, on dit ce qu'on cherche à mesurer, ce qu'on a appris en le mesurant, et ce qu'on a changé.

## 1. La question posée

Un client qui déménage confie, en une journée, la totalité de ce qu'il possède à une entreprise qu'il ne connaît pas. Il réserve souvent des semaines avant le jour J. Ce qu'il veut savoir n'est pas « ce déménageur est-il bon ? » mais :

1. **Mes affaires arriveront-elles entières, et toutes ?**
2. **L'entreprise existera-t-elle encore le jour J, et a-t-elle le droit de faire ce métier ?**
3. **Le prix et la date annoncés seront-ils tenus ?**

Un déménageur fiable, au sens de Moverz, est celui qui répond oui aux trois. Le score en est la traduction chiffrée, sur cinq axes.

## 2. Les cinq axes et leurs poids

| Axe | Poids | Ce qu'il mesure | Source |
|---|---|---|---|
| Vigilance | **35 %** | Les incidents racontés dans les avis : casse, vol, retard, prix modifié, personnel | Avis Google, 12 ou 24 mois |
| Réputation | 20 % | La part d'avis négatifs parmi les avis authentiques | Avis Google |
| Google | 20 % | La note publique et son volume | Fiche Google |
| Financier | 12,5 % | Rentabilité, fonds propres, trésorerie, endettement, tendance | Bilans publiés (Pappers) |
| Juridique | 12,5 % | Contentieux, procédures, licence de transport | Pappers, registre des transporteurs, Sirene |

**Pourquoi la vigilance pèse le plus.** Les avis sont la seule source qui raconte ce qui s'est passé *pendant* des déménagements réels. La note Google dit si les clients sont contents ; la vigilance dit *de quoi* se plaignent ceux qui ne le sont pas. Un 4,6/5 avec trois récits de meubles cassés ne vaut pas un 4,6/5 avec trois récits de retard.

**Pourquoi le financier et le juridique pèsent peu dans la somme… et beaucoup ailleurs.** Ce sont des signaux lents, et beaucoup de petites entreprises ne publient pas leurs comptes. Leur poids dans la moyenne est donc modéré. Mais leurs cas graves ne passent pas par la moyenne : ils sont **éliminatoires** (§ 4 et § 5). Une entreprise en redressement judiciaire ne doit pas pouvoir « compenser » par de bons avis.

**Pourquoi trois axes sur les avis.** Google, réputation et vigilance lisent la même matière, mais pas de la même façon : la note agrégée (toute l'histoire de la fiche), la proportion d'avis négatifs sur une fenêtre récente, et la nature des incidents. Une fiche peut avoir une belle note historique et une année récente difficile ; c'est précisément ce qu'on veut voir.

## 3. Pourquoi la casse et le vol pèsent le plus

Dans la vigilance, six catégories, deux poids :

| Catégorie | Poids |
|---|---|
| Casse et dégradation | 30 % |
| Vol signalé | 30 % |
| Calendrier non respecté | 10 % |
| Prix modifié | 10 % |
| Personnel désagréable | 10 % |
| Autres problèmes | 10 % |

Un retard se rattrape, un supplément se conteste, un déménageur désagréable s'oublie. Un buffet de famille cassé ou un carton de bijoux disparu, non. Ce sont les deux incidents **irréversibles**, d'où trois fois le poids des autres.

Les seuils sont des **proportions**, pas des comptes : moins de 1 % des avis authentiques = 100, de 1 à 3 % = 50, au-delà = 0. Une entreprise qui fait 400 déménagements par an n'est pas punie d'avoir plus d'avis qu'un artisan qui en fait 30.

## 4. Le registre des transporteurs

Transporter les biens d'un client, c'est du transport routier de marchandises pour compte d'autrui. Il faut être inscrit au **registre électronique national des entreprises de transport par route** (tenu par les services de l'État en région), ce qui suppose capacité professionnelle, capacité financière et honorabilité. L'inscription donne une **licence** :

- **LTI**, licence de transport intérieur, pour les entreprises qui n'utilisent que des véhicules de 3,5 t et moins ;
- **LC**, licence communautaire, au-delà de 3,5 t (et pour certains utilitaires légers à l'international).

Ce que le score en fait (`src/sitr-juridical.ts`) :

- **absent du registre, licence périmée, ou inscrit seulement comme commissionnaire** → juridique à **0**. Un commissionnaire organise le transport mais le confie à un autre : ce n'est pas l'entreprise qui portera vos meubles, et ce n'est pas la même responsabilité ;
- **pas de SIREN** → on ne tranche pas (`unknown`) : on ne condamne pas sur une donnée manquante ;
- pour le **label Excellent**, l'absence du registre est éliminatoire, quel que soit le score.

Le registre n'est en revanche pas un filtre d'entrée dans la liste proposée au client : il agit déjà sur la note, et son numéro figure sur le devis quand on le connaît.

## 5. Les procédures collectives

Sauvegarde, redressement judiciaire, liquidation judiciaire : trois procédures ouvertes par le tribunal quand une entreprise ne peut plus (ou risque de ne plus pouvoir) payer ses dettes. Pour un client, le risque est concret : déménagement non exécuté, meubles bloqués dans un garde-meubles le temps de la procédure.

Ce que le score en fait :

- au juridique, chaque décision pèse, plus si elle est récente (moins de 3 ans), plus encore si elle contient un mot grave (liquidation, redressement, sauvegarde, faillite, dissolution, condamnation) ; une décision où l'entreprise **attaque** ne compte pas : réclamer son dû n'est pas un risque ;
- au-delà de la note, `src/company-health.ts` lit l'état de l'entreprise (cessée, radiée, procédure en cours ou passée), y compris dans les **annonces BODACC**, qui portent souvent la procédure avant qu'elle ne soit structurée dans les bases ;
- une entreprise dans cet état n'est **jamais** proposée au client ni labellisée, quel que soit son score : un score élevé ne rachète pas une société en difficulté. La note indicative d'un devis externe est, elle, plafonnée à 49 (sous « Correct »).

## 6. Distinguer un avis d'un bruit

Un avis qui ne dit rien n'apporte rien. Un avis est écarté s'il cumule **deux** signaux parmi : moins de dix mots, 5★ d'un auteur qui a déjà noté l'entreprise, 5★ sans aucun texte. Un seul signal ne suffit jamais : « Super, je recommande ! » est un avis court et légitime.

On n'appelle pas ça « faux avis » devant un client ou un déménageur : on ne constate pas de fraude, on constate qu'une part des avis n'apporte pas d'information.

**La fenêtre de lecture est adaptative.** 12 mois par défaut, parce qu'un score doit refléter l'équipe d'aujourd'hui. Mais un artisan qui reçoit 8 avis par an serait noté sur un échantillon où un seul avis négatif fait basculer la note : sous **12 avis récents**, on lit **24 mois**. Les plafonds de volume (60 sous 5 avis authentiques, 75 sous 10, 88 sous 25) disent la même chose autrement : 100 % de satisfaits sur 4 avis n'est pas une preuve.

## 7. « Pas de note inventée »

Le score est une promesse faite au client. S'il manque une source critique (registre, fiche Google, avis), il n'y a **pas de note**, et l'équipe voit pourquoi. On n'affiche pas un « environ 80 » calculé sur trois axes.

Deux exceptions, et seulement deux, toutes deux à 50 (la neutralité), et seulement quand la source a répondu :

- **pas de bilan publié** : une TPE a le droit de ne pas publier ses comptes ; ce n'est pas une faute, ce n'est pas non plus une preuve de solidité. Le déménageur peut téléverser son bilan : un modèle de langage en extrait les chiffres, des contrôles stricts les valident (bonne entreprise, vrai bilan, confiance suffisante, moins de 12 mois), et c'est **la même formule** qui note. Le registre reprend la main dès qu'il publie plus récent ;
- **fiche Google sans aucune note** : une fiche toute neuve n'est ni bonne ni mauvaise.

Une fiche Google **introuvable**, elle, bloque la note : on ne note jamais un déménageur avec les avis d'un autre. D'où un rapprochement nom/localisation volontairement étroit (`src/google-matching.ts`), et un mode « sans Google » quand la fiche n'est pas prouvée comme la sienne.

**Une fiche d'un autre métier bloque aussi la note (08/10/2026).** Prouver qu'une fiche appartient à l'entreprise ne prouve pas qu'elle décrit un déménageur. Deux cas réels l'ont montré : une paroisse installée à la même adresse que l'entreprise, rattachée par l'adresse ; la fiche d'un promoteur immobilier, désignée par le déménageur lui-même. Les deux recevaient une bonne note, calculée sur les avis de quelqu'un d'autre. Ce qui dit le métier d'une fiche, ce sont ses avis (`src/google-trade.ts`) :

- on ne lit que les avis qui ont un vrai texte (plus de 30 caractères), sur toute la collecte (24 mois), pas sur la seule fenêtre de la réputation : le métier d'une fiche ne dépend pas de la récence de ses avis ;
- on compte ceux qui parlent du métier (déménagement, cartons, camion, meubles, garde-meuble, débarras…) ; « immeuble » ne compte pas pour « meuble » ;
- sur au moins 5 avis à texte, la fiche est **hors métier** sous 10 % d'avis du métier, ou sous 20 % quand le **nom** de la fiche ne dit rien du métier ;
- alors la composante Google est retirée, et la règle stricte refuse la note globale, avec la raison écrite (« 0/30 avis parlent de déménagement »).

Pourquoi deux seuils : mesuré sur les 1 259 notes fiables, un seuil unique ne sépare pas. La paroisse était à 11 % d'avis du métier, un vrai déménageur à 14 %. Le nom de la fiche, lui, les sépare. Le vocabulaire est volontairement large : un garde-meubles ou un service de débarras reste dans le métier ; les garder ou non dans la liste est une question de positionnement, pas de rattachement. Simulée sur les notes de production le 08/10/2026, la règle a désigné 18 fiches réelles : paroisse, promoteur, déchetterie, cabinet juridique, agence d'intérim, nettoyage, navettes, entrepôts logistiques.

Limite connue : sous 5 avis à texte, on ne tranche pas ; une fiche d'un autre métier presque sans avis passe ce contrôle, et ne reste arrêtée que par le rapprochement nom/localisation.

## 8. Ce qu'on a changé en mesurant

Les règles ont bougé quand les mesures sur des fiches réelles l'ont demandé. Chaque changement est daté et commenté dans le code.

- **Détection d'avis non informatifs (09/09/2026).** Un quatrième signal existait : « 5★ dans une semaine comptant au moins trois avis 5★ ». C'était un seuil absolu : il se déclenchait mécaniquement chez les entreprises actives (200 avis par an, c'est quatre par semaine). Mesuré sur un panel de plusieurs centaines de fiches : 65 % des fiches à vingt avis ou plus étaient signalées, contre 31 % des petites. On punissait le succès. Signal retiré : 44 % contre 25 %.
- **Fenêtre 12 → 24 mois sous 12 avis récents (avril 2026).** Les petits déménageurs avaient des notes instables d'un mois sur l'autre.
- **Fiche Google fermée (avril 2026).** Une fiche « fermée définitivement » était pénalisée. Or un déménageur qui change de local voit souvent son ancienne fiche fermée : c'est l'historique des avis qui compte, pas le statut de la fiche. Pénalité retirée.
- **Exception financière à 50 (avril 2026), exception Google à 50 (septembre 2026).** Des entreprises sérieuses n'avaient pas de note pour une absence qui n'était pas une faute.
- **Accents dans le rapprochement Google (avril 2026).** « Déménagements Élysée » ne retrouvait pas « DEMENAGEMENTS ELYSEE » : des déménageurs restaient sans note. Normalisation Unicode ajoutée.
- **Seuil de la liste (02/10/2026).** Les Dynamiques passent de « 70 et plus » à « plus de 75 », pour que le code dise exactement la promesse écrite au client : « seuls les déménageurs notés plus de 75/100 vous sont présentés ».
- **Fiche Google hors métier (08/10/2026).** Une fiche rattachée dont les avis ne parlent pas de déménagement ne note plus le déménageur (§ 7).
- **Coût du registre.** Ne demander que le champ utile a divisé par trois à quatre le coût d'un appel ; une fiche de moins de 120 jours n'est plus rachetée.

## 9. Trois défauts trouvés, et corrigés

Un score honnête dit aussi où il s'est trompé. En préparant ce dépôt, trois défauts sont apparus dans la lecture des avis **sans modèle de langage** (le mode par mots-clés, qui produit l'essentiel des notes en production). Ils ont été corrigés le 8 octobre 2026, dans le produit comme ici :

- le mot-clé « vol » attrapait aussi « volume » : les mots-clés se cherchent désormais comme mots entiers, accents et casse ignorés, accords tolérés ;
- la catégorie « Autres problèmes » comptait tous les avis de 4★ ou moins, même élogieux : elle ne compte plus que les avis négatifs (3★ ou moins) qu'aucune autre catégorie n'a retenus ;
- une décision « Procédure collective en cours » ne prenait pas le malus de gravité au juridique : c'est désormais un mot grave. Sans effet sur la sélection : l'entreprise restait exclue par son état (§ 5).

Mesuré avant correction, sur les notes réelles : 368 notes changent, et 49 déménageurs pénalisés à tort repassent au-dessus du seuil de 75. Le recalcul repart des avis déjà collectés, sans nouvel appel aux sources.

## 10. Le motif principal

« Pourquoi ma note est-elle basse ? » est la première question d'un déménageur. Il n'y a pas de réponse unique : cinq composantes tirent ensemble.

On retient celle qui **coûte le plus de points**, `poids × (100 − composante)`, pas la plus basse. Un juridique à 40 coûte 7,5 points ; une vigilance à 60 en coûte 14. C'est la vigilance qu'il faut expliquer.

C'est une attribution, pas une cause, et on mesure sa portée : l'écart avec le deuxième motif. Sous 3 points, aucune raison n'explique la note à elle seule, et on le dit plutôt que de désigner un coupable (`src/motif.ts`).

## 11. Du score à la liste

Le client compare jusqu'à 10 devis, prix fermes, et **choisit lui-même** son déménageur. La liste est classée par prix, ou par avis Google : le score ne la classe pas, il décide qui peut y entrer.

- entrent seulement les notes **fiables** de **plus de 75/100** ; une note de 75 n'entre pas ;
- avant toute note : jamais une entreprise fermée, cessée, radiée ou en procédure collective ;
- jamais une note non fiable ; jamais le libellé « Correct » ou « Fragile » sous les yeux du client.

Mécanique interne du code, qui n'est pas une promesse faite au client : les places de la liste sont réparties en deux catégories, 4 « Confirmés » (note fiable de 85 et plus, le seuil du label Excellent) et 6 « Dynamiques » (de 76 à 84) ; une place qu'une catégorie ne remplit pas revient à l'autre (`src/mover-list.ts`).

Le label Excellent demande en plus : être au registre des transporteurs, et être joignable.
