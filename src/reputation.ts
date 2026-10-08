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
    keywords: ["surfacturation", "supplément", "montant", "devis", "coût", "tarif", "arnaque"],
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

/**
 * L'heuristique de repli, volontairement pessimiste :
 *  - « préoccupation » = tout avis de 4★ ou moins (un 4★ qui dit « un meuble
 *    rayé » compte) ;
 *  - « Autres problèmes » n'a pas de mots-clés : elle compte TOUTES les
 *    préoccupations, y compris des 4★ élogieux ;
 *  - les mots-clés sont des sous-chaînes : « vol » attrape aussi « volume ».
 * Ce sont des limites connues, assumées : sans modèle, mieux vaut une
 * vigilance trop sévère qu'un incident manqué. Dès qu'un modèle répond, sa
 * classification remplace cette heuristique.
 */
function buildHeuristicVigilance(authentic: GoogleReview[]): VigilanceCategoryResult[] {
  const concerns = authentic.filter((review) => (review.rating ?? 0) <= 4);
  return VIGILANCE_CATEGORIES.map((category) => {
    const matched = category.keywords.length
      ? concerns.filter((review) =>
          category.keywords.some((keyword) => review.text.toLowerCase().includes(keyword.toLowerCase())),
        )
      : concerns;
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
  if (concerns.length > 0 && options.llm && options.llm.length > 0) {
    const answer = await completeJsonWithFallback(options.llm, buildVigilancePrompt(concerns), { maxTokens: 1200 });
    const fromLlm = answer ? categoriesFromLlmAnswer(answer.json, concerns.length, authentic.length) : null;
    if (fromLlm) {
      categories = fromLlm;
      method = "llm";
    }
  }

  return {
    source: "vigilance_categories",
    vigilanceScore: clamp(categories.reduce((sum, category) => sum + category.score * category.weight, 0)),
    categories,
    totalAuthenticReviews: authentic.length,
    method,
  };
}
