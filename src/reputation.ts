import { completeJsonWithFallback, type LlmClient } from "./llm/client.js";
import type { GoogleReview, ReputationSnapshot, VigilanceCategoryResult, VigilanceSnapshot } from "./types.js";

/**
 * Réputation et vigilance : deux lectures des MÊMES avis Google (collecte
 * paginée, fenêtre 12 ou 24 mois, voir `review-window.ts`).
 *
 *  - Réputation : la part d'avis négatifs parmi les avis authentiques, plafonnée
 *    selon le volume.
 *  - Vigilance : ce qui est reproché, en six catégories. La casse et le vol
 *    pèsent 30 % chacun : ce sont les deux incidents que le client ne peut ni
 *    rattraper ni compenser le jour J (voir docs/METIER.md).
 */

export const VIGILANCE_CATEGORIES: ReadonlyArray<{
  id: string;
  label: string;
  weight: number;
  keywords: string[];
}> = [
  {
    id: "casse_degradation",
    label: "Casse et dégradation",
    weight: 0.3,
    keywords: ["casse", "cassé", "brisé", "abîmé", "dégradé", "rayé", "détérioré", "endommagé"],
  },
  {
    id: "vol",
    label: "Vol signalé",
    weight: 0.3,
    keywords: ["vol", "volé", "disparu", "manquant", "soustrait", "dérobé", "stolen", "missing"],
  },
  {
    id: "calendrier",
    label: "Calendrier non respecté",
    weight: 0.1,
    keywords: ["retard", "en retard", "pas livré", "délai", "attente", "livraison tardive"],
  },
  {
    id: "prix_modifie",
    label: "Prix modifié",
    weight: 0.1,
    // « devis » et « tarif » seuls ne sont plus des incidents (14/10/2026) :
    // « plusieurs devis », « préparation du devis » décrivent un parcours normal.
    keywords: ["surfacturation", "supplément", "montant", "coût", "arnaque"],
  },
  {
    id: "personnel",
    label: "Personnel désagréable",
    weight: 0.1,
    keywords: ["impoli", "désagréable", "agressif", "irrespectueux", "malpoli", "grossier", "attitude"],
  },
  {
    id: "autres",
    label: "Autres problèmes",
    weight: 0.1,
    keywords: [],
  },
];

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Trois signaux, et un avis en cumule au moins deux pour être écarté : texte de
 * moins de dix mots, 5★ d'un auteur qui a déjà noté cette entreprise, 5★ sans
 * aucun texte.
 *
 * Un quatrième signal a été retiré le 09/09/2026 : « 5★ dans une semaine comptant
 * au moins trois avis 5★ ». C'était un seuil ABSOLU, donc il se déclenchait
 * mécaniquement chez qui reçoit beaucoup d'avis — un déménageur à 200 avis par an
 * en reçoit quatre par semaine en moyenne. Combiné au signal « moins de dix
 * mots », qui se déclenche sur « Super, je recommande ! », il rendait suspecte
 * toute critique courte et positive d'une entreprise active. Mesuré sur un panel
 * de plusieurs centaines de fiches : 65 % des fiches à vingt avis ou plus étaient
 * signalées, contre 31 % des petites. Après retrait : 44 % contre 25 %.
 *
 * Ce que le signal dit désormais, et rien de plus : une part notable des avis
 * n'apporte pas d'information. Ce n'est ni une fraude constatée, ni un jugement
 * sur l'entreprise.
 */
export function detectFakeReviews(reviews: GoogleReview[]) {
  const authorCount = new Map<string, number>();
  for (const review of reviews) {
    const key = review.author.toLowerCase().trim();
    authorCount.set(key, (authorCount.get(key) ?? 0) + 1);
  }

  return reviews.map((review) => {
    let suspiciousScore = 0;
    const wordCount = review.text.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount < 10) suspiciousScore += 1;

    const key = review.author.toLowerCase().trim();
    if ((review.rating ?? 0) === 5 && (authorCount.get(key) ?? 0) > 1) suspiciousScore += 1;

    if ((review.rating ?? 0) === 5 && wordCount === 0) suspiciousScore += 1;
    return { ...review, suspicious: suspiciousScore >= 2 };
  });
}

/**
 * Plafonds de volume : 100 % d'avis positifs sur 4 avis ne vaut pas 100 % sur
 * 80. Moins de 5 avis authentiques : 60 au plus ; moins de 10 : 75 ; moins de
 * 25 : 88. Au-delà, un petit bonus de constance (+3 dès 25, +5 au-delà de 50).
 */
export function reputationVolumeCap(authenticCount: number): number {
  if (authenticCount < 5) return 60;
  if (authenticCount < 10) return 75;
  if (authenticCount < 25) return 88;
  return 100;
}

export function deriveReputationSnapshot(reviews: GoogleReview[]): ReputationSnapshot {
  const withFakeDetection = detectFakeReviews(reviews);
  const suspicious = withFakeDetection.filter((review) => review.suspicious);
  const authentic = withFakeDetection.filter((review) => !review.suspicious);

  if (authentic.length === 0) {
    return {
      source: "reviews_pattern",
      negativeMentions: 0,
      reputationScore: 50,
      authenticCount: 0,
      suspiciousCount: suspicious.length,
      negativeRatio: 0,
      positiveCount: 0,
      explanation: "Aucun avis authentique détecté",
    };
  }

  const positiveCount = authentic.filter((review) => (review.rating ?? 0) >= 4).length;
  const negativeCount = authentic.filter((review) => (review.rating ?? 0) <= 3).length;
  const negativeRatio = negativeCount / authentic.length;
  let score = Math.round((1 - negativeRatio) * 100);

  score = Math.min(score, reputationVolumeCap(authentic.length));
  if (authentic.length > 50) score = Math.min(100, score + 5);
  else if (authentic.length >= 25) score = Math.min(100, score + 3);

  return {
    source: "reviews_pattern",
    negativeMentions: negativeCount,
    reputationScore: clamp(score),
    authenticCount: authentic.length,
    suspiciousCount: suspicious.length,
    negativeRatio: Math.round(negativeRatio * 100) / 100,
    positiveCount,
    explanation: `${positiveCount} avis positifs / ${authentic.length} avis authentiques (${suspicious.length} suspects exclus)`,
  };
}

/**
 * Seuils publics de l'axe vigilance, par catégorie : moins de 1 % des avis
 * authentiques = 100, de 1 à 3 % inclus = 50, plus de 3 % = 0. Ce sont des
 * PROPORTIONS, pas des comptes : un déménageur qui fait 400 chantiers par an
 * n'est pas puni d'avoir plus d'avis qu'un artisan qui en fait 30.
 */
export function categoryScore(reviewCount: number, authenticTotal: number) {
  if (reviewCount === 0 || authenticTotal === 0) return { score: 100, status: "ok" as const, ratio: 0 };
  const ratio = reviewCount / authenticTotal;
  if (ratio < 0.01) return { score: 100, status: "ok" as const, ratio };
  if (ratio <= 0.03) return { score: 50, status: "warning" as const, ratio };
  return { score: 0, status: "alert" as const, ratio };
}

/** La consigne envoyée au modèle : catégories fixes, avis numérotés, réponse JSON. */
export function buildVigilancePrompt(concerns: GoogleReview[]): string {
  const reviewsText = concerns
    .map((review, index) => `Avis ${index + 1} (${review.rating ?? "?"}★, ${review.relativeTime}): "${review.text}"`)
    .join("\n");
  const categoriesDesc = VIGILANCE_CATEGORIES.map((category) => `- "${category.id}" : ${category.label}`).join("\n");

  return `Tu es un analyste qualité déménagement.
Catégorise les avis négatifs suivants dans les catégories fixes.

CATÉGORIES:
${categoriesDesc}

AVIS:
${reviewsText}

Réponds UNIQUEMENT en JSON:
{
  "classifications":[
    {"categoryId":"casse_degradation","reviewNumbers":[1,4],"evidence":["..."] }
  ]
}`;
}

/** Minuscules, apostrophes unifiées, accents GARDÉS ; même longueur que `foldText`. */
function lowerText(text: string): string {
  return Array.from(text.normalize("NFC"))
    .map((c) => {
      const lower = c.toLowerCase();
      return lower.length === c.length ? lower : c;
    })
    .join("")
    .replace(/[’`]/g, "'");
}

/**
 * Minuscules, sans accents, apostrophes unifiées : « Volée » et « volee » se lisent pareil.
 * Caractère par caractère : le texte replié garde la longueur du texte en minuscules
 * (`lowerText`), pour relire l'accent d'une occurrence.
 */
function foldText(text: string): string {
  return Array.from(lowerText(text))
    .map((c) => {
      const bare = c.normalize("NFD").replace(/\p{M}/gu, "");
      return bare.length === c.length ? bare : c;
    })
    .join("");
}

/**
 * Un mot-clé se cherche comme MOT, pas comme bout de mot : « vol » ne doit pas trouver
 * « volume » ni « volontiers » (avant le 08/10/2026, une simple recherche de sous-chaîne
 * gonflait la catégorie vol, qui pèse 0,3 de la vigilance). Accents ignorés, et accords
 * tolérés (« cassé » trouve « cassées », « vol » trouve « vols » et « volé »).
 */
function keywordPattern(keyword: string): RegExp {
  const escaped = foldText(keyword).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?:e|s|es)?(?![\\p{L}\\p{N}])`, "gu");
}

const ONE_WORD = "\\p{L}+";

const NEGATOR = `(?:(?:aucune?s?|sans(?!\\s+(?:parler|compter|oublier)(?![\\p{L}]))|zero|0|pas\\s+(?:de|un|une|le\\s+moindre|la\\s+moindre)|rien\\s+de|ni|jamais(?:\\s+(?:de|en))?|point\\s+de|nul(?:le)?)\\s+|(?:pas|rien|jamais)\\s+d'\\s*)`;

/**
 * Une tournure niée n'est pas un incident (Guillaume, 14/10/2026) :
 * « rien de cassé », « aucun objet manquant », « sans casse », « jamais en retard ».
 * Règles lues sur le texte qui PRÉCÈDE immédiatement le mot-clé (texte replié), coupé à
 * la dernière ponctuation forte ou au dernier « mais / sauf / par contre / cependant / en
 * revanche » : « pas de casse mais du retard » garde le retard.
 *
 * Relecture du 15/10/2026 : la négation ne porte que sur le mot-clé qui la suit
 * directement (« sans casse »), ou, à un mot de distance, sur un participe ou un adjectif
 * (« aucun objet manquant », « rien de vraiment cassé ») — jamais sur un nom (« zéro
 * respect, retard énorme » est un retard). « Sans parler / compter / oublier » ne nie rien.
 */
export const VIGILANCE_NEGATION_RULES: ReadonlyArray<{ id: string; pattern: RegExp; participleOnly?: boolean }> = [
  {
    // pas de casse, sans casse, rien d'abîmé, ni casse, zéro casse, jamais de retard
    id: "negateur_juste_avant",
    pattern: new RegExp(`(?<![\\p{L}])${NEGATOR}$`, "u"),
  },
  {
    // aucun objet cassé, aucun carton manquant : un mot entre les deux, participe seulement
    id: "negateur_un_mot_avant",
    pattern: new RegExp(`(?<![\\p{L}])${NEGATOR}${ONE_WORD}\\s+$`, "u"),
    participleOnly: true,
  },
  {
    // rien n'a été cassé, aucun meuble n'a été abîmé
    id: "rien_n_a_ete",
    pattern: new RegExp(
      `(?<![\\p{L}])(?:rien|aucune?s?|personne)\\s+(?:${ONE_WORD}\\s+){0,2}n'(?:a|ont|est|sont|etait|etaient|avons|avions)\\s+(?:(?:ete|eu|pas|jamais|rien)\\s+){0,2}(?:${ONE_WORD}\\s+)?$`,
      "u",
    ),
  },
  {
    // pas cassé, pas été abîmé, jamais en retard
    id: "pas_juste_avant",
    pattern: new RegExp(`(?<![\\p{L}])(?:pas|jamais)\\s+(?:ete\\s+|eu\\s+de\\s+|du\\s+tout\\s+)?$`, "u"),
  },
];

/**
 * Expressions positives (14/10/2026) qui contiennent un mot-clé : « dans les délais »,
 * « délais respectés », « au-delà de mes attentes », « devis respecté », « tarif
 * raisonnable ». L'occurrence est neutralisée si l'expression la couvre entièrement.
 */
export const VIGILANCE_POSITIVE_EXPRESSIONS: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  {
    id: "delais_respectes",
    pattern:
      /(?:respect(?:e|ant|es)?\s+(?:des|du|les|le|de\s+ses|de\s+leurs)\s+delais?|delais?\s+(?:(?:ont|a|sont|est|etaient|etait|ete|bien|tres|parfaitement|totalement|toujours|ont\s+ete|a\s+ete)\s+){0,3}(?:respecte|tenu|court|rapide|record|annonce|imparti|convenu|prevu|raisonnable|correct)\w*|dans\s+(?:les|le|des|un|de\s+tres\s+|de\s+)\s*(?:\p{L}+\s+)?delais?|en\s+un\s+(?:\p{L}+\s+)?delai|rien\s+a\s+redire\s+sur\s+les\s+delais)/gu,
  },
  {
    id: "attentes_esperances",
    pattern: /(?:mes|nos|vos|ses|leurs|les|toutes\s+(?:mes|nos|vos|les))\s+attentes/gu,
  },
  {
    id: "prix_respecte",
    pattern:
      /(?:respect(?:e|ant)?\s+(?:du|le|des)\s+(?:devis|tarifs?|montant|cout)|conforme\s+(?:au|aux)\s+(?:devis|tarifs?)|(?:devis|tarifs?|montant|cout|couts)\s+(?:(?:prealable|initial|annonce|a|ont|est|sont|etait|ete|bien|tres|parfaitement|totalement|largement|tout\s+a\s+fait|a\s+ete)\s+){0,3}(?:respecte|tenu|raisonnable|correct|competitif|attractif|abordable|honnete|interessant|imbattable|clair|detaille|precis|gratuit|rapide|reactif|transparent|juste|maitrise|conforme|abordables?|tres\s+bien)\w*|devis\s+en\s+\d+\s*h)/gu,
  },
];

const NEGATION_LOOKBEHIND_CHARS = 70;
const POSITIVE_WINDOW_CHARS = 60;

/** Ce qui arrête la portée d'une négation : ponctuation forte, ou une conjonction d'opposition. */
const NEGATION_BARRIER = /(?:[.!?;:]|(?<![\p{L}])(?:mais|sauf|cependant|par\s+contre|en\s+revanche|toutefois|pourtant)(?![\p{L}]))/gu;

/**
 * Une expression positive (« délai annoncé ») ne vaut rien si la suite de la phrase la
 * contredit : « n'a pas été respecté », « non respecté », « dépassé ».
 */
const POSITIVE_CONTRADICTED = /(?:pas\s+(?:ete\s+)?(?:respecte|tenu)|non\s+(?:respecte|tenu)|depasse|pas\s+du\s+tout\s+respecte)/u;

/** Participe ou adjectif (« cassé », « abîmées », « manquant », « disparu », « soustrait ») et non un nom. */
function isParticipleForm(lowerSegment: string): boolean {
  return /(?:é|ée|és|ées|ant|ants|ante|antes|u|ue|us|ues|ait|aite|aits|aites)$/u.test(lowerSegment);
}

function cutAtLastBarrier(text: string): string {
  let last = -1;
  const barrier = new RegExp(NEGATION_BARRIER.source, "gu");
  let match: RegExpExecArray | null;
  while ((match = barrier.exec(text))) last = match.index + match[0].length;
  return last >= 0 ? text.slice(last) : text;
}

/**
 * L'occurrence en `index` (longueur `length`) est-elle niée, ou prise dans une expression
 * positive ? `lower` : le même texte, en minuscules mais avec ses accents (même longueur),
 * pour distinguer « cassé » de « casse » ; sans lui, aucune occurrence n'est un participe.
 */
export function isNeutralisedOccurrence(folded: string, index: number, length: number, lower?: string): boolean {
  const before = cutAtLastBarrier(folded.slice(Math.max(0, index - NEGATION_LOOKBEHIND_CHARS), index));
  const participle = lower != null && isParticipleForm(lower.slice(index, index + length));
  if (VIGILANCE_NEGATION_RULES.some((rule) => (participle || !rule.participleOnly) && rule.pattern.test(before))) return true;
  const sentenceAfter = folded.slice(index + length, index + length + POSITIVE_WINDOW_CHARS).split(/[.!?;]/u)[0] ?? "";
  if (POSITIVE_CONTRADICTED.test(sentenceAfter)) return false;
  const start = Math.max(0, index - POSITIVE_WINDOW_CHARS);
  const around = folded.slice(start, index + length + POSITIVE_WINDOW_CHARS);
  for (const expression of VIGILANCE_POSITIVE_EXPRESSIONS) {
    const pattern = new RegExp(expression.pattern.source, "gu");
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(around))) {
      const from = start + match.index;
      const to = from + match[0].length;
      if (from <= index && to >= index + length) return true;
      if (match[0].length === 0) pattern.lastIndex += 1;
    }
  }
  return false;
}

/** Vrai si le texte (replié) contient au moins une occurrence d'un mot-clé qui n'est ni niée ni positive. */
function hasRealIncident(folded: string, lower: string, patterns: RegExp[]): boolean {
  for (const pattern of patterns) {
    const global = new RegExp(pattern.source, "gu");
    let match: RegExpExecArray | null;
    while ((match = global.exec(folded))) {
      if (!isNeutralisedOccurrence(folded, match.index, match[0].length, lower)) return true;
    }
  }
  return false;
}

const CATEGORY_PATTERNS = new Map(
  VIGILANCE_CATEGORIES.map((category) => [category.id, category.keywords.map(keywordPattern)]),
);

/**
 * L'heuristique de repli, quand aucun modèle ne répond :
 *  - les catégories à mots-clés lisent les avis de 4★ ou moins (un 4★ qui dit
 *    « un meuble rayé » compte) ;
 *  - « Autres problèmes » ne compte que les avis négatifs (3★ ou moins, même
 *    seuil que la réputation) qu'aucune autre catégorie n'a retenus.
 * Corrigé le 08/10/2026 : avant, « Autres problèmes » comptait tous les avis de
 * 4★ ou moins, élogieux compris, et les mots-clés étaient des sous-chaînes
 * (« vol » attrapait « volume »). Mesuré en production : 49 déménageurs étaient
 * pénalisés à tort sous le seuil de 75.
 *
 * Depuis le 14/10/2026 : une occurrence niée (« rien de cassé ») ou prise dans
 * une expression positive (« dans les délais ») ne compte pas
 * (`isNeutralisedOccurrence`). Relu le 15/10/2026 : une négation s'arrête à
 * « mais », « sauf », « par contre »… et ne couvre pas un vrai incident ; une
 * expression positive contredite (« délai annoncé non respecté ») ne neutralise rien.
 */
export function buildHeuristicVigilance(authentic: GoogleReview[]): VigilanceCategoryResult[] {
  const concerns = authentic.filter((review) => (review.rating ?? 0) <= 4);
  const folded = new Map(concerns.map((review) => [review, foldText(review.text)]));
  const lowered = new Map(concerns.map((review) => [review, lowerText(review.text)]));
  const matchedByKeyword = new Set<GoogleReview>();
  const keywordMatches = new Map<string, GoogleReview[]>();
  for (const category of VIGILANCE_CATEGORIES) {
    const patterns = CATEGORY_PATTERNS.get(category.id) ?? [];
    if (patterns.length === 0) continue;
    const matched = concerns.filter((review) => hasRealIncident(folded.get(review) ?? "", lowered.get(review) ?? "", patterns));
    matched.forEach((review) => matchedByKeyword.add(review));
    keywordMatches.set(category.id, matched);
  }

  return VIGILANCE_CATEGORIES.map((category) => {
    const matched =
      keywordMatches.get(category.id) ??
      concerns.filter((review) => (review.rating ?? 0) <= 3 && !matchedByKeyword.has(review));
    const uniqueMatched = Array.from(
      new Map(matched.map((review) => [`${review.author}|${review.text.slice(0, 60)}`, review])).values(),
    );
    const scoreInfo = categoryScore(uniqueMatched.length, Math.max(authentic.length, 1));
    return {
      id: category.id,
      label: category.label,
      weight: category.weight,
      reviewCount: uniqueMatched.length,
      ratio: scoreInfo.ratio,
      score: scoreInfo.score,
      status: scoreInfo.status,
      evidence: uniqueMatched.slice(0, 3).map((review) => review.text.slice(0, 220)),
    };
  });
}

/**
 * Relit la réponse du modèle sans lui faire confiance : catégories de la liste
 * fermée seulement, numéros d'avis dans les bornes, chaque avis compté une fois.
 * `null` si la réponse n'a pas la forme attendue (on garde alors l'heuristique).
 */
export function categoriesFromLlmAnswer(
  json: unknown,
  concernsCount: number,
  authenticTotal: number,
): VigilanceCategoryResult[] | null {
  const classifications =
    json && typeof json === "object" ? (json as { classifications?: unknown }).classifications : undefined;
  if (!Array.isArray(classifications)) return null;

  return VIGILANCE_CATEGORIES.map((category) => {
    const reviewNumbers = new Set<number>();
    const evidence: string[] = [];
    for (const entry of classifications) {
      if (!entry || typeof entry !== "object") continue;
      const { categoryId, reviewNumbers: numbers, evidence: items } = entry as {
        categoryId?: unknown;
        reviewNumbers?: unknown;
        evidence?: unknown;
      };
      if (categoryId !== category.id) continue;
      for (const n of Array.isArray(numbers) ? numbers : []) {
        if (typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= concernsCount) reviewNumbers.add(n);
      }
      for (const item of Array.isArray(items) ? items : []) {
        if (typeof item === "string" && item.trim()) evidence.push(item.trim());
      }
    }
    const scoreInfo = categoryScore(reviewNumbers.size, Math.max(authenticTotal, 1));
    return {
      id: category.id,
      label: category.label,
      weight: category.weight,
      reviewCount: reviewNumbers.size,
      ratio: scoreInfo.ratio,
      score: scoreInfo.score,
      status: scoreInfo.status,
      evidence: evidence.slice(0, 3),
    };
  });
}

/**
 * Vigilance d'une fiche dont aucun avis n'est retenu (Guillaume, 14/10/2026) :
 * on ne sait rien des incidents, la vigilance est neutre (50), comme le financier
 * sans bilan. Avant : 100, une absence d'avis valait un sans-faute.
 */
export const VIGILANCE_NO_REVIEWS_SCORE = 50;

/**
 * Vigilance = somme pondérée des six catégories. Heuristique par mots-clés
 * d'abord ; si des modèles sont fournis et que l'un répond une classification
 * lisible, elle remplace l'heuristique. Sans modèle, le résultat est complet
 * et déterministe.
 */
export async function deriveVigilanceSnapshot(
  reviews: GoogleReview[],
  options: { llm?: readonly LlmClient[] } = {},
): Promise<VigilanceSnapshot> {
  const authentic = detectFakeReviews(reviews).filter((review) => !review.suspicious);
  const concerns = authentic.filter((review) => (review.rating ?? 0) <= 4);

  let categories = buildHeuristicVigilance(authentic);
  let method: VigilanceSnapshot["method"] = "keywords";
  // Depuis le 14/10/2026 : un modèle en échec (délai, réseau, réponse illisible)
  // ne fait jamais échouer le calcul ; le repli sur les mots-clés est tracé.
  let fallbackReason: string | null = null;
  let llmFallback = false;
  if (concerns.length > 0 && options.llm && options.llm.length > 0) {
    const answer = await completeJsonWithFallback(options.llm, buildVigilancePrompt(concerns), { maxTokens: 1200 });
    const fromLlm = answer ? categoriesFromLlmAnswer(answer.json, concerns.length, authentic.length) : null;
    if (fromLlm) {
      categories = fromLlm;
      method = "llm";
    } else {
      llmFallback = true;
      fallbackReason = answer ? "llm_failed: réponse inexploitable" : "llm_failed: aucun modèle n'a répondu";
    }
  } else if (concerns.length > 0) {
    fallbackReason = "no_llm_configured";
  }

  const noReviews = authentic.length === 0;
  const vigilanceScore = noReviews
    ? VIGILANCE_NO_REVIEWS_SCORE
    : clamp(categories.reduce((sum, category) => sum + category.score * category.weight, 0));

  return {
    source: "vigilance_categories",
    vigilanceScore,
    categories,
    totalAuthenticReviews: authentic.length,
    method,
    fallbackReason,
    llmFallback,
    noReviews,
  };
}
