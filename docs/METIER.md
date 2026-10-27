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
- pour le **label Excellent**, l'absence du registre est éliminatoire, quel que soit le score ;
- depuis le 14/10/2026, une absence **confirmée** plafonne aussi la **note globale à 65** (`src/register-cap.ts`, § 12) : le déménageur reste noté, mais sous le seuil de 75.

Le registre n'est pas, en tant que tel, une condition d'entrée dans la liste proposée au client : il agit sur la note, et son numéro figure sur le devis quand on le connaît. Le plafond a deux exceptions : un registre (ou son annuaire) illisible au moment du calcul (aucune pénalité, le calcul est refait), et une entreprise qui figure au registre sous un autre SIREN, un seul, comme transporteur de marchandises (l'équipe vérifie la fiche). C'est pourquoi on ne dit pas au client que tous les déménageurs présentés sont inscrits.

## 5. Les procédures collectives

Sauvegarde, redressement judiciaire, liquidation judiciaire : trois procédures ouvertes par le tribunal quand une entreprise ne peut plus (ou risque de ne plus pouvoir) payer ses dettes. Pour un client, le risque est concret : déménagement non exécuté, meubles bloqués dans un garde-meubles le temps de la procédure.

Ce que le score en fait :

- au juridique, chaque décision pèse, plus si elle est récente (moins de 3 ans), plus encore si elle contient un mot grave (liquidation, redressement, sauvegarde, faillite, dissolution, condamnation) ; une décision où l'entreprise **attaque** ne compte pas : réclamer son dû n'est pas un risque ;
- au-delà de la note, `src/company-health.ts` lit l'état de l'entreprise (cessée, radiée, procédure en cours ou passée), y compris dans les **annonces BODACC**, qui portent souvent la procédure avant qu'elle ne soit structurée dans les bases ;
- une entreprise dans cet état n'est **jamais** proposée au client ni labellisée, quel que soit son score : un score élevé ne rachète pas une société en difficulté. La note indicative d'un devis externe est, elle, plafonnée à 49 (sous « Correct ») . L'outil « Vérifier un déménageur » n'affiche pas cette note indicative : il montre le Score Moverz officiel, ou dit qu'il n'est pas disponible.

## 6. Distinguer un avis d'un bruit

Un avis qui ne dit rien n'apporte rien. Un avis est écarté s'il cumule **deux** signaux parmi : moins de dix mots, 5★ d'un auteur qui a déjà noté l'entreprise, 5★ sans aucun texte. Un seul signal ne suffit jamais : « Super, je recommande ! » est un avis court et légitime.

On n'appelle pas ça « faux avis » devant un client ou un déménageur : on ne constate pas de fraude, on constate qu'une part des avis n'apporte pas d'information.

**Une tournure niée n'est pas un incident (14/10/2026).** Le mode par mots-clés lit « Rien de cassé, équipe au top » comme « cassé ». Désormais, une occurrence précédée d'une négation (« rien de », « aucun », « sans », « pas de », « jamais », « rien n'a été ») ou prise dans une expression positive (« dans les délais », « délais respectés », « au-delà de mes attentes », « devis respecté », « tarif raisonnable ») ne compte pas. La neutralisation porte sur l'occurrence, pas sur l'avis : « pas de casse au départ, mais casse à l'arrivée » reste un incident. Relu le 15/10/2026, pour qu'une négation n'efface jamais un vrai incident : elle ne porte que sur le mot-clé qui la suit, ou, à un mot de distance, sur un participe (« aucun objet manquant ») et jamais sur un nom (« zéro respect, retard énorme » est un retard) ; elle s'arrête à « mais », « sauf », « par contre », « cependant », « en revanche » et à la ponctuation forte (« Rien de cassé. Par contre un carton manquant » compte le carton) ; « sans parler du retard », « sans compter le supplément » ne nient rien ; et une expression positive contredite (« le délai annoncé n'a pas été respecté », « délais dépassés ») ne neutralise rien. « Devis » et « tarif » seuls ne sont plus des mots-clés : « j'ai demandé plusieurs devis » décrit un parcours normal.

**Aucun avis retenu : vigilance neutre (14/10/2026).** Quand la collecte a réussi mais qu'aucun avis n'est retenu (aucun avis, ou seulement des avis écartés), la vigilance vaut 50, comme la réputation dans le même cas : on ne sait rien des incidents, ce n'est ni un sans-faute ni une faute. Avant, elle valait 100.

**La fenêtre de lecture est adaptative.** 12 mois par défaut, parce qu'un score doit refléter l'équipe d'aujourd'hui. Mais un artisan qui reçoit 8 avis par an serait noté sur un échantillon où un seul avis négatif fait basculer la note : sous **12 avis récents**, on lit **24 mois**. Les plafonds de volume (60 sous 5 avis authentiques, 75 sous 10, 88 sous 25) disent la même chose autrement : 100 % de satisfaits sur 4 avis n'est pas une preuve.

## 7. « Pas de note inventée »

Le score est une promesse faite au client. S'il manque une source critique (registre, fiche Google, avis), il n'y a **pas de note**, et l'équipe voit pourquoi. On n'affiche pas un « environ 80 » calculé sur trois axes.

Deux exceptions, et seulement deux, toutes deux à 50 (la neutralité), et seulement quand la source a répondu :

- **pas de bilan publié**, ou un dernier bilan clôturé il y a plus de 24 mois (depuis le 14/10/2026) : une TPE a le droit de ne pas publier ses comptes ; ce n'est pas une faute, ce n'est pas non plus une preuve de solidité. Le déménageur peut téléverser son bilan : un modèle de langage en extrait les chiffres, des contrôles stricts les valident (bonne entreprise, vrai bilan, confiance suffisante, moins de 12 mois), et c'est **la même formule** qui note. Le registre reprend la main dès qu'il publie plus récent ;
- **fiche Google sans aucune note** : une fiche toute neuve n'est ni bonne ni mauvaise.

Ce ne sont pas des sources manquantes : quand la collecte d'avis a réussi mais qu'aucun avis n'est retenu, la réputation et la vigilance valent aussi 50, pour la même raison (§ 6).

Une fiche Google **introuvable**, elle, bloque la note : on ne note jamais un déménageur avec les avis d'un autre. D'où un rapprochement nom/localisation volontairement étroit (`src/google-matching.ts`), et un mode « sans Google » quand la fiche n'est pas prouvée comme la sienne.

**Une fiche d'un autre métier bloque aussi la note (08/10/2026).** Prouver qu'une fiche appartient à l'entreprise ne prouve pas qu'elle décrit un déménageur. Deux cas réels l'ont montré : une paroisse installée à la même adresse que l'entreprise, rattachée par l'adresse ; la fiche d'un promoteur immobilier, désignée par le déménageur lui-même. Les deux recevaient une bonne note, calculée sur les avis de quelqu'un d'autre. Ce qui dit le métier d'une fiche, ce sont ses avis (`src/google-trade.ts`) :

- on ne lit que les avis qui ont un vrai texte (plus de 30 caractères), sur toute la collecte (24 mois), pas sur la seule fenêtre de la réputation : le métier d'une fiche ne dépend pas de la récence de ses avis ;
- on compte ceux qui parlent du métier (déménagement, cartons, camion, meubles, garde-meuble, débarras…) ; « immeuble » ne compte pas pour « meuble » ;
- sur au moins 5 avis à texte, la fiche est **hors métier** sous 10 % d'avis du métier, ou sous 20 % quand le **nom** de la fiche ne dit rien du métier ;
- alors la composante Google est retirée, et la règle stricte refuse la note globale, avec la raison écrite (« 0/30 avis parlent de déménagement »).

Pourquoi deux seuils : mesuré sur les 1 259 notes fiables, un seuil unique ne sépare pas. La paroisse était à 11 % d'avis du métier, un vrai déménageur à 14 %. Le nom de la fiche, lui, les sépare. Le vocabulaire est volontairement large : un garde-meubles ou un service de débarras reste dans le métier ; les garder ou non dans la liste est une question de positionnement, pas de rattachement. Simulée sur les notes de production le 08/10/2026, la règle a désigné 18 fiches réelles : paroisse, promoteur, déchetterie, cabinet juridique, agence d'intérim, nettoyage, navettes, entrepôts logistiques.

Limite connue : sous 5 avis à texte, on ne tranche pas ; une fiche d'un autre métier presque sans avis passe ce contrôle, et ne reste arrêtée que par le rapprochement nom/localisation.

**Une panne n'efface pas une bonne note (14/10/2026).** Une source peut manquer pour deux raisons très différentes. Un **verdict** dit quelque chose de l'entreprise : introuvable au registre, fiche Google non prouvée, absente ou hors métier. Une **panne** ne dit rien d'elle : réseau coupé, service saturé, quota épuisé, délai dépassé, collecte d'avis amputée en route. Chaque échec dit désormais sa nature (`src/outage-policy.ts`). Sont aussi des verdicts, même quand une source est en panne le même jour : une entreprise fermée (Sirene, ou cessée ou radiée selon le registre), une procédure collective en cours, une absence du registre des transporteurs. Un verdict remplace la note, comme avant. Une panne, elle, ne remplace pas une note fiable de moins de 120 jours (le cycle de recalcul de 90 jours, plus 30 jours de relances), à condition que les composantes fraîchement obtenues (financier, juridique) ne soient pas pires que celles de la note gardée : la note reste, l'échec est gardé dans l'historique, et le calcul est relancé environ 24 h plus tard, trois fois de suite au plus ; au-delà, la note reste et l'équipe est prévenue. Sans note fiable récente à garder, la règle stricte s'applique : pas de note, mais le calcul est relancé de la même façon (24 h, trois fois d'affilée au plus, même compteur). Après trois relances sans succès, le recalcul automatique attend le cycle suivant, 90 jours après la dernière tentative ; une demande de l'équipe passe toujours. Une collecte d'avis amputée ne note plus du tout : c'est une panne, pas une fiche à moins d'avis.

**Un seul Score, une seule méthode (14/10/2026).** Sur moverz.fr, l'outil « Vérifier un déménageur » montre le Score Moverz de n'importe quelle entreprise, inscrite chez Moverz ou non, mais il ne calcule rien lui-même : c'est le Score officiel, celui de la notation habituelle, avec les mêmes cinq critères, les mêmes poids, les mêmes formules, les mêmes sources (jusqu'à 50 pages d'avis, fiches héritées comprises) et la même règle stricte : un critère manquant, pas de Score, et la raison est écrite. Une entreprise inconnue reçoit une fiche et est notée par cette notation ; une note de plus de 30 jours est recalculée en arrière-plan. Détail dans `docs/architecture.md` § « Un seul Score : l'outil "Vérifier un déménageur" ».

**En cas de doute, des données fraîches (15/10/2026).** Décision de Guillaume : nos données servent à faire des économies ; s'il y a un doute sur l'entreprise, on va chercher des données fraîches pour répondre juste, et il n'existe qu'une note par déménageur. Pourquoi : une fiche de notre base peut porter le SIREN d'une entreprise précédente (une entreprise individuelle fermée, remplacée par une société avec la même fiche Google), et l'outil ne doit ni la noter sur de mauvais chiffres, ni créer une seconde fiche pour la même entreprise. L'outil doute dans deux cas :

- la fiche Google retenue est portée chez nous par une fiche d'un **autre SIREN** que l'entreprise choisie par le visiteur ;
- la fiche trouvée pour l'entreprise porte un **SIREN fermé**, alors que l'entreprise choisie est active.

Alors :

- l'outil **relit toutes les sources à neuf** (aucune reprise de nos caches ni de notre note), puis la notation habituelle ;
- une fiche **non inscrite** chez Moverz est **remise sur l'entreprise choisie**, puis renotée, seulement si le nom recoupe **et** que la fiche Google est la même ; les anciens numéros sont gardés, et la correction est journalisée ;
- une fiche **partenaire** (en ligne, espace ouvert, dossier actif ou Label actif) n'est **jamais corrigée automatiquement** : son contrat, ses conditions, ses paiements et son attestation tiennent à son SIREN. La correction est proposée à l'équipe, et le Score s'affiche « en cours de vérification » ;
- un SIRET déjà porté par une autre fiche de notre base est **signalé** à l'équipe, sans rien écrire ;
- même fiche Google mais un nom qui ne recoupe pas : rien n'est écrit, l'équipe est prévenue pour vérifier ;
- l'outil ne crée **jamais de seconde fiche** et ne montre **jamais une note douteuse**.

Exemple fictif : la fiche « Transports Exemple » porte le SIREN 800000001, fermé ; le visiteur choisit la société active 900000001, même nom, même fiche Google. La fiche, non inscrite, passe sur 900000001 (800000001 reste dans son historique) et elle est renotée avec des données du jour. Si elle était partenaire, rien ne serait écrit : l'équipe recevrait la correction à valider, et le visiteur lirait « en cours de vérification ».

## 8. Ce qu'on a changé en mesurant

Les règles ont bougé quand les mesures sur des fiches réelles l'ont demandé. Chaque changement est daté et commenté dans le code.

- **Détection d'avis non informatifs (09/09/2026).** Un quatrième signal existait : « 5★ dans une semaine comptant au moins trois avis 5★ ». C'était un seuil absolu : il se déclenchait mécaniquement chez les entreprises actives (200 avis par an, c'est quatre par semaine). Mesuré sur un panel de plusieurs centaines de fiches : 65 % des fiches à vingt avis ou plus étaient signalées, contre 31 % des petites. On punissait le succès. Signal retiré : 44 % contre 25 %.
- **Fenêtre 12 → 24 mois sous 12 avis récents (avril 2026).** Les petits déménageurs avaient des notes instables d'un mois sur l'autre.
- **Fiche Google fermée (avril 2026).** Une fiche « fermée définitivement » était pénalisée. Or un déménageur qui change de local voit souvent son ancienne fiche fermée : c'est l'historique des avis qui compte, pas le statut de la fiche. Pénalité retirée.
- **Exception financière à 50 (avril 2026), exception Google à 50 (septembre 2026).** Des entreprises sérieuses n'avaient pas de note pour une absence qui n'était pas une faute.
- **Accents dans le rapprochement Google (avril 2026).** « Déménagements Élysée » ne retrouvait pas « DEMENAGEMENTS ELYSEE » : des déménageurs restaient sans note. Normalisation Unicode ajoutée.
- **Seuil de la liste (02/10/2026).** Les Dynamiques passent de « 70 et plus » à « plus de 75 », pour que le code dise exactement la promesse écrite au client : « seuls les déménageurs notés plus de 75/100 vous sont présentés ».
- **Fiche Google hors métier (08/10/2026).** Une fiche rattachée dont les avis ne parlent pas de déménagement ne note plus le déménageur (§ 7).
- **Coût du registre.** Ne demander que le champ utile a divisé par trois à quatre le coût d'un appel ; une fiche de moins de 120 jours n'est plus rachetée (sauf au recalcul trimestriel, qui la relit depuis le 15/10/2026, § 12).
- **Règles des 14 et 15 octobre 2026.** Bilan le plus récent, négations, vigilance sans avis, plafond Google progressif, plafond hors registre, fraîcheur de 90 jours, méthode enregistrée : § 12.

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
- avant toute note : jamais une entreprise fermée, cessée, radiée ou en procédure collective ; depuis le 15/10/2026, la fermeture lue dans l'annuaire de l'État suffit à retirer le Label tout de suite, sans attendre la relecture du registre des entreprises payant (une entreprise cessée fin août restait labellisée) ;
- jamais une note non fiable ; jamais le libellé « Correct » ou « Fragile » sous les yeux du client.

Mécanique interne du code, qui n'est pas une promesse faite au client (`src/mover-list.ts`) :

- depuis le 16/10/2026, les partenaires de Moverz qui couvrent le département de départ entrent **tous** dans la liste ; les déménageurs notés de la base la complètent jusqu'à 10 lignes, du mieux noté au moins bien noté. Pourquoi : avec des places réservées par catégorie, un partenaire pouvait rester hors de la liste ;
- un partenaire, c'est un contrat actif chez Moverz **et** une fiche en ligne (26/10/2026). Une fiche en ligne sans contrat, héritée du lancement, est un déménageur de la base : elle n'a pas le pas sur les autres et entre par sa note ;
- les deux catégories, 4 « Confirmés » (note fiable de 85 et plus, le seuil du label Excellent) et 6 « Dynamiques » (de 76 à 84), ne servent plus qu'à repérer un manque (« aucun Confirmé dans ce département »), qui guide le recrutement. Avant le 16/10, elles se partageaient les places, une place non remplie revenant à l'autre catégorie ;
- l'ordre affiché au client, lui, reste celui du prix ou des avis Google.

Exemple fictif : un département compte 2 partenaires (notés 78 et 90) et 15 déménageurs éligibles de la base. La liste montre les 2 partenaires, puis les 8 meilleures notes de la base, soit 10 lignes ; le client les voit classées par prix.

Le label Excellent demande en plus : être au registre des transporteurs, et être joignable.

## 12. Les règles des 14 et 15 octobre 2026

Décisions de Guillaume Stehelin de Taisne, après un audit du score. Les règles du 14/10 forment la version `legacy-compatible-v2` ; une note calculée avant porte `legacy-compatible-v1`. Les exemples sont fictifs.

**1. Le bilan le plus récent (14/10/2026, `assessLegacyFinancial`).** Pourquoi : on retenait « l'exercice le plus rempli des trois derniers », qui pouvait noter une entreprise sur un bilan vieux de plusieurs années alors qu'un plus récent était publié ; et une fiche du registre gardée en cache gardait sa note du jour de l'appel. Désormais :

- on note toujours l'exercice le plus récent ; un champ qu'il ne donne pas se complète avec l'exercice précédent, **jamais le résultat** (un résultat absent reste absent) ;
- la note se recalcule à la date du calcul, pas à celle de l'appel au registre ;
- un dernier bilan clôturé il y a **plus de 24 mois** compte comme « pas de chiffres » : financier 50, l'exception neutre (§ 7). **Sans plancher** : un vieux mauvais bilan devient 50 lui aussi. Guillaume a refusé le plancher : un bilan trop ancien ne dit rien, ni en bien ni en mal.

Exemple : bilans 2022 (bénéficiaire, complet) et 2025 (perte de 20 % du chiffre d'affaires, seuls le résultat et le chiffre d'affaires publiés). Avant, 2022 servait. Désormais 2025 : résultat 2, fonds propres, trésorerie et endettement repris de 2022 (25, 20, 15), tendance en baisse 3, soit **65/100**. Calcul au 15/10/2026 avec un dernier bilan clos le 31/12/2023 : **50**, qu'il soit excellent ou mauvais.

**2. Les négations ne sont plus des incidents (14/10/2026, relu le 15/10/2026, `isNeutralisedOccurrence`).** Pourquoi : le mode par mots-clés, qui produit l'essentiel des notes, comptait « rien de cassé » comme une casse. La relecture du 15/10 empêche l'excès inverse : une négation ne couvre plus un vrai incident (« pas de casse mais trois heures de retard » reste un retard). Détail au § 6. Exemple : sur 30 avis retenus, un avis 4★ « Rien de cassé, équipe au top » faisait passer la casse à 3,3 % des avis, donc à 0 : vigilance 70 au lieu de 100, soit **10,5 points** de note globale perdus pour un compliment.

**3. Aucun avis retenu : vigilance 50 (14/10/2026).** Pourquoi : une absence d'avis valait un sans-faute (100). Exemple : une fiche dont les seuls avis sont des 5★ sans texte (écartés) avait 100 en vigilance ; elle a 50, soit 17,5 points de moins sur la note globale.

**4. Plafond Google progressif (14/10/2026, `googleVolumeCap`).** Pourquoi : le plafond de 75 tombait d'un coup à 20 avis ; un avis de plus valait jusqu'à 25 points de composante Google. Désormais : 75 jusqu'à 10 avis, puis 75 + 2,5 par avis au-delà de 10, plus de plafond à partir de 20. Exemple : 4,9/5 sur 17 avis, plafonné à 75 avant, vaut **93** (plafond 92,5) ; c'est le cas de démonstration « Transports Modèle », passé de 83 à 86.

**5. Absence au registre des transporteurs : 65 au plus (14/10/2026, `src/register-cap.ts`).** Pourquoi : un déménageur absent du registre exerce sans l'inscription que la loi exige pour transporter les biens d'un client ; Guillaume ne veut plus qu'il soit présenté sur la seule foi de ses avis. Le juridique à 0 (§ 4) ne coûtait que 12,5 points : une note de 88 restait au-dessus du seuil de 75. Désormais :

- une absence **confirmée** (absent, licence périmée, ou seulement commissionnaire) plafonne la note globale à **65** : le déménageur reste noté, mais sous le seuil de 75 ;
- avant de plafonner, on cherche si l'entreprise exerce sous un **autre SIREN** (société reprise, entreprise individuelle fermée puis remplacée par une société). Correspondance retenue : même raison sociale et même code postal ou même commune ; ou gestionnaire de transport (ou attestataire de capacité) du registre égal à un dirigeant connu de l'entreprise, nom et prénom, dans le même département. Un nom générique (« Déménagement ») ne prouve rien. Une correspondance lève le plafond, et l'équipe est alertée pour vérifier la fiche ;
- relu le 15/10/2026 pour éviter les faux « autre SIREN » : seul un **transporteur de marchandises** inscrit lève le plafond, jamais un commissionnaire seul ; un nom de commune ne compte pas comme nom d'entreprise (« Paris Déménagement ») ; une même commune doit être dans le même département (Saint-Denis en Seine-Saint-Denis n'est pas Saint-Denis de La Réunion) ; un gérant homonyme ne suffit pas sans un mot du nom en commun ou la même commune ;
- relu encore le 15/10/2026, **mots génériques et ambiguïté** (décision de Guillaume). Pourquoi : un recalcul à blanc sur les notes réelles trouvait une trentaine d'« autres SIREN », dont plusieurs fiches portant le même nom générique, rapprochées des mêmes trois sociétés d'un réseau. Désormais, une liste de mots génériques ne compte jamais comme mot du nom : le métier et les formes (« déménagement », « transports », « services », « groupe »…), les régions, les départements et leurs gentilés (« France », « Provence », « Vendée », « savoyard »…). Un nom fait seulement de ces mots (« France Déménagement », « Vendée Déménagement ») ne correspond à personne par le nom, et la correspondance par le gérant exige toujours un mot distinctif en commun, ou la même commune dans le même département. Et **un seul** autre SIREN lève le plafond : s'il y en a plusieurs, on ne sait pas lequel est le bon, le plafond reste et l'équipe est prévenue (avertissement `sitr_successor_ambiguous`) ;
- dernière précision du 15/10/2026 : dans la preuve par le gérant, **le nom du gérant ne compte pas** comme mot du nom en commun (un gérant à plusieurs sociétés, « Ortolan Strasbourg » et « Carton Malin », les rapprochait toutes), et **seule l'adresse de la fiche** compte pour la commune et le département, pas le siège connu (une agence de Toulon d'un réseau installé à Chambéry n'est pas dans le département du siège). Chaque correspondance retenue dit sa preuve en clair à l'équipe (« même nom, même code postal », « même gérant, mot du nom en commun ») ;
- **société sœur : à vérifier** (option A, décision de Guillaume du 15/10/2026). Pourquoi : un dirigeant a souvent plusieurs sociétés ; celle qui est inscrite au registre n'est pas forcément celle qui fait le déménagement. Une correspondance par le seul gérant et la même commune, **sans aucun mot distinctif du nom en commun**, ne lève donc plus le plafond : la note reste à 65 et l'équipe reçoit la fiche à vérifier (avertissement `sitr_successor_to_review`). Lèvent toujours le plafond : même nom et même lieu, ou même gérant avec un mot distinctif du nom en commun. Exemple fictif : la fiche « Carton Malin » à Lampertheim, dont le gérant dirige aussi « Ortolan Strasbourg », inscrite dans la même commune : 65, à vérifier. « Lumen Déménagement » à Castelnau-le-Lez, gérée par la même personne que « Lumen Transports » inscrite à Montpellier : plafond levé ;
- un **registre illisible** au moment du calcul ne pénalise pas : pas de plafond sur la foi d'un ancien relevé. Depuis le 15/10/2026 (Guillaume, même logique que pour les pannes de source), un **annuaire illisible** pendant la recherche d'un autre SIREN ne plafonne pas non plus : l'avertissement le dit, et en production le calcul est refait 24 h plus tard, trois fois au plus.

Exemple : note de 88 (financier 100, juridique 0, Google, réputation et vigilance 100), absente du registre : **65**. Si « Déménagements Exemple », même code postal, figure au registre sous un autre SIREN comme transporteur de marchandises : 88, et une alerte. Si l'annuaire n'a pas pu être lu : 88, et un nouveau calcul le lendemain. Si deux sociétés fictives « Marmotte Alsace » et « Mondial Marmotte », du même gérant et du même département, correspondent toutes deux à la fiche « Marmotte Strasbourg » : ambiguïté, **65**, et l'équipe tranche. Une fiche « France Déménagement » ne correspond à aucune société « France Déménagement Group » du registre : aucun mot distinctif. Une note plafonnée reste dans le cycle de recalcul (point 6) : un déménageur qui s'inscrit au registre retrouve sa note. Le détail de la note garde la note avant plafond (`details.registerCap`).

**6. Fraîcheur de 90 jours (15/10/2026).** Pourquoi : une note montrée au client doit dire l'état récent de l'entreprise, pas celui d'il y a six mois. Désormais :

- le planificateur recalcule tout déménageur montré au client : partenaires en ligne, Labels actifs, et **toute note fiable de plus de 75** (avant : 85 et plus), ainsi que toute note **plafonnée par le registre** (un déménageur qui s'inscrit retrouve sa note), quand sa note a plus de 90 jours. Les plus anciennes d'abord, 250 au plus par passage quotidien : environ 850 notes sur 90 jours, soit un rattrapage en 4 jours, puis une dizaine par jour. Un seul passage par 24 h, même quand l'application redémarre plusieurs fois par jour (pas de passage au démarrage si le dernier date de moins de 20 h). Les fiches créées par l'outil « Vérifier un déménageur » restent hors du planificateur ; la pause après relances épuisées ne change pas ;
- ce recalcul **relit le registre des entreprises** : il ne reprend une fiche Pappers que si elle a moins de **7 jours** (`PAPPERS_QUARTERLY_MAX_AGE_DAYS`), c'est-à-dire payée par une tentative du même recalcul. Le filet en cas de panne, et les autres déclencheurs, gardent 120 jours ;
- l'analyse d'un devis reprend la note en base d'un déménageur déjà noté jusqu'à **90 jours** (180 avant), le cycle de recalcul.

L'outil « Vérifier un déménageur » garde son propre délai : une note de plus de 30 jours y est recalculée en arrière-plan.

**7. La méthode suivie, enregistrée avec chaque note (15/10/2026).** Pourquoi : pour relire une note des mois plus tard, il faut savoir comment chaque critère a été obtenu, pas seulement son chiffre. Chaque note enregistre, critère par critère, la méthode réellement suivie : financier (score natif du registre, formule sur les bilans, sans chiffres, bilan de plus de 24 mois, bilan déposé par le déménageur), juridique, registre des transporteurs (inscrit, plafond, autre SIREN, registre ou annuaire illisible), Google, réputation, vigilance (modèle OpenAI ou Anthropic, ou mots-clés avec la raison du repli) et lecture des avis (complète ou non). C'est lu par l'équipe dans le back-office, jamais montré au client. Ce dépôt n'en publie pas le texte (ce sont des phrases d'écran, sans effet sur la note) ; il expose les éléments qui le fondent dans `details` : `financialAssessment`, `registerCap`, `vigilance`, `sitrJuridicalVerdict`, `googleTrade`, et les avertissements de `reliabilityDetails.warnings`.
