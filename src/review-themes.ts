import { completeJsonWithFallback, REVIEWS_LLM_PRICES_USD_PER_M, type LlmClient } from "./llm/client.js";
import { detectFakeReviews } from "./reputation.js";
import type { GoogleReview } from "./types.js";

/**
 * « Ce que disent les avis » sur la fiche du déménageur : les thèmes POSITIFS
 * les plus cités dans ses avis Google des 24 derniers mois, avec leur nombre.
 * La vigilance (`reputation.ts`) ne repère que les catégories négatives ; ceci
 * est une passe de plus sur les mêmes avis.
 *
 * Règles (engagement public envers les clients) :
 * 1. liste fermée de thèmes, tous positifs ; jamais un thème négatif ;
 * 2. seuls les avis authentiques (même détection que la note) de 4 étoiles et plus,
 *    datés des 24 mois qui précèdent la lecture des avis ;
 * 3. un thème compte des AVIS (un avis qui le cite trois fois compte une fois) ;
 * 4. au plus 4 thèmes, chacun cité dans au moins 3 avis ;
 * 5. aucune citation de texte d'avis n'est gardée ni montrée.
 *
 * Deux méthodes, même liste de thèmes : `mots_cles` (gratuite, déterministe, celle
 * par défaut) et `ia` (le même appel au modèle que la vigilance).
 */

export type ReviewThemeId =
  | "ponctualite"
  | "soin"
  | "equipe_sympathique"
  | "professionnalisme"
  | "efficacite"
  | "rapport_qualite_prix"
  | "reactivite"
  | "organisation";

export type ReviewThemeMethod = "mots_cles" | "ia";

/**
 * Les thèmes et leurs motifs. Les motifs s'appliquent à un texte en minuscules,
 * sans accents, apostrophes droites (`normalizeReviewText`).
 */
export const REVIEW_THEMES: ReadonlyArray<{ id: ReviewThemeId; label: string; describe: string; patterns: RegExp[] }> = [
  {
    id: "ponctualite",
    label: "Ponctuels",
    describe: "ponctualité, à l'heure, dans les temps",
    patterns: [/ponctu(?:el|elle|els|elles)\b/, /\b(?:pile )?a l'heure\b/, /\ben avance\b/, /\bdans les temps\b/, /\brespect (?:des|de l'|du) (?:horaires?|heure|delais?|planning)\b/],
  },
  {
    id: "soin",
    label: "Soigneux avec les meubles",
    describe: "soin des meubles et des affaires, rien de cassé",
    patterns: [
      /\bsoigneu(?:x|se|ses|sement)\b/,
      /\bavec (?:beaucoup de |grand )?soin\b/,
      /\b(?:pris|prennent|prend|prendre) (?:grand |bien )?soin\b/,
      /\bprecautionneu(?:x|se|ses|sement)\b/,
      /\bminutieu(?:x|se|ses|sement)\b/,
      /\bavec delicatesse\b/,
      /\b(?:rien|aucun objet|aucun meuble) (?:de |d')?(?:casse|abime|endommage)s?\b/,
      /\b(?:aucune|sans) casse\b/,
      /\b(?:aucun|sans) (?:degat|dommage)s?\b/,
      /\bbien (?:protege|emballe)(?:e|s|es)?\b/,
    ],
  },
  {
    id: "equipe_sympathique",
    label: "Équipe sympathique",
    describe: "équipe sympathique, aimable, souriante",
    patterns: [
      /\bsympa(?:s|thique|thiques)?\b/,
      /\bsouriant(?:e|s|es)?\b/,
      /\baimables?\b/,
      /\bgentil(?:le|les|s|lesse)?\b/,
      /\bbonne humeur\b/,
      /\bchaleureu(?:x|se|ses)\b/,
      /\bcourtois(?:e|es)?\b/,
      /\bbienveillant(?:e|s|es)?\b/,
      /\bconvivia(?:l|le|ux|les|lite)\b/,
    ],
  },
  {
    id: "professionnalisme",
    label: "Professionnels",
    describe: "professionnalisme, sérieux",
    patterns: [/\bprofessionn(?:el|elle|els|elles)\b/, /\bserieu(?:se|ses)\b/, /\b(?:tres|super|vraiment|equipe|des) pros?\b/],
  },
  {
    id: "efficacite",
    label: "Efficaces et rapides",
    describe: "efficacité, rapidité du travail",
    patterns: [/\befficaces?\b/, /\brapid(?:e|es|ement)\b/],
  },
  {
    id: "rapport_qualite_prix",
    label: "Bon rapport qualité-prix",
    describe: "prix correct, bon rapport qualité-prix, prix respecté",
    patterns: [
      /\brapport qualite ?[-/]? ?prix\b/,
      /\bqualite ?[-/] ?prix\b/,
      /\b(?:prix|tarifs?) (?:tres )?(?:raisonnables?|corrects?|attractifs?|competitifs?|honnetes?|abordables?|imbattables?)\b/,
      /\b(?:tres |a )?bon prix\b/,
      /\babordables?\b/,
      /\b(?:devis|prix|tarif) (?:a ete |a bien ete |bien )?respecte\b/,
      /\bpas de (?:mauvaise )?surprises?\b/,
    ],
  },
  {
    id: "reactivite",
    label: "Réactifs et à l'écoute",
    describe: "réactivité, écoute, disponibilité",
    patterns: [/\breacti(?:f|fs|ve|ves)\b/, /\ba l'ecoute\b/, /\bdisponibles?\b/, /\barrangeant(?:e|s|es)?\b/, /\bflexibles?\b/, /\bcomprehensi(?:f|fs|ve|ves)\b/],
  },
  {
    id: "organisation",
    label: "Bien organisés",
    describe: "organisation, préparation du déménagement",
    patterns: [/\bbien organise(?:e|s|es)?\b/, /\b(?:bonne|excellente|super|parfaite|tres bonne) organisation\b/, /\borganisation (?:parfaite|impeccable|excellente|au top)\b/],
  },
];

/** Un thème n'est montré que s'il est cité dans au moins 3 avis… */
export const REVIEW_THEME_MIN_MENTIONS = 3;
/** …et la fiche en montre au plus 4. */
export const REVIEW_THEMES_MAX = 4;
/** La fenêtre des avis lus : les 24 mois qui précèdent leur lecture. */
export const REVIEW_THEMES_WINDOW_MONTHS = 24;
/** Note minimale d'un avis lu : seuls les avis positifs portent un thème positif. */
export const REVIEW_THEMES_MIN_RATING = 4;

const THEME_IDS = new Set<string>(REVIEW_THEMES.map((theme) => theme.id));

export function reviewThemeLabel(id: string): string | null {
  return REVIEW_THEMES.find((theme) => theme.id === id)?.label ?? null;
}

export function normalizeReviewText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘`´]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Une négation dans les trois mots qui précèdent : « pas très soigneux », « n'étaient pas
 * à l'heure ». Les noms (« ponctualité », « professionnalisme ») ne sont pas des motifs :
 * « ponctualité à revoir » n'est pas un compliment. Une réserve juste après le mot
 * (« rapides mais à revoir », « soigneux, bémol ») l'écarte aussi.
 */
const NEGATION_BEFORE = /\b(?:pas|peu|jamais|aucun|aucune|manque|manquait|ni|guere|plus)\b/;
const RESERVE_AFTER = /^[\s,.;:!-]*(?:\S+\s+){0,2}?(?:a revoir|a ameliorer|laisse a desirer|bemol|discutable|pas du tout|pas vraiment|pas tres)\b/;

function matchesPositively(text: string, pattern: RegExp): boolean {
  const global = new RegExp(pattern.source, "g");
  for (const match of text.matchAll(global)) {
    const start = match.index ?? 0;
    const before = text.slice(0, start).split(" ").slice(-4).join(" ");
    const after = text.slice(start + match[0].length, start + match[0].length + 40);
    if (!NEGATION_BEFORE.test(before) && !RESERVE_AFTER.test(after)) return true;
  }
  return false;
}

/** Les thèmes cités par un avis (par mots-clés), chacun une fois. */
export function themesOfReviewText(text: string): ReviewThemeId[] {
  const normalized = normalizeReviewText(text);
  if (!normalized) return [];
  return REVIEW_THEMES.filter((theme) => theme.patterns.some((pattern) => matchesPositively(normalized, pattern))).map(
    (theme) => theme.id,
  );
}

function windowStart(reference: Date): Date {
  const start = new Date(reference);
  start.setMonth(start.getMonth() - REVIEW_THEMES_WINDOW_MONTHS);
  return start;
}

/**
 * Les avis lus : authentiques (`detectFakeReviews`, comme la note), de 4 étoiles et
 * plus, avec un texte, et DATÉS dans les 24 mois qui précèdent `reference` (la date de
 * lecture des avis). Un avis sans date est écarté : on ne pourrait pas dire « des 24
 * derniers mois ».
 */
export function reviewsForThemes(reviews: GoogleReview[], reference: Date): GoogleReview[] {
  const start = windowStart(reference).getTime();
  const end = reference.getTime();
  return detectFakeReviews(reviews).filter((review) => {
    if (review.suspicious) return false;
    if ((review.rating ?? 0) < REVIEW_THEMES_MIN_RATING) return false;
    if (!review.text?.trim()) return false;
    const at = review.isoDate ? new Date(review.isoDate).getTime() : Number.NaN;
    return Number.isFinite(at) && at >= start && at <= end + 24 * 3600 * 1000;
  });
}

/**
 * Les avis datés des 24 mois qui précèdent `reference`, toutes notes confondues : la
 * base de la part d'avis positifs de la fiche.
 */
export function reviewsWithin24Months(reviews: GoogleReview[], reference: Date): GoogleReview[] {
  const start = windowStart(reference).getTime();
  const end = reference.getTime() + 24 * 3600 * 1000;
  return reviews.filter((review) => {
    const at = review.isoDate ? new Date(review.isoDate).getTime() : Number.NaN;
    return Number.isFinite(at) && at >= start && at <= end;
  });
}

export type ReviewThemeCount = { id: ReviewThemeId; count: number };

/** Garde les thèmes cités au moins 3 fois, les plus cités d'abord, au plus 4. */
export function topReviewThemes(counts: Partial<Record<string, number>>): ReviewThemeCount[] {
  const order = REVIEW_THEMES.map((theme) => theme.id);
  return order
    .map((id) => ({ id, count: Math.floor(counts[id] ?? 0) }))
    .filter((entry) => entry.count >= REVIEW_THEME_MIN_MENTIONS)
    .sort((a, b) => b.count - a.count || order.indexOf(a.id) - order.indexOf(b.id))
    .slice(0, REVIEW_THEMES_MAX);
}

/** Méthode `mots_cles` : nombre d'avis qui citent chaque thème. */
export function countThemesByKeywords(reviews: GoogleReview[]): Record<ReviewThemeId, number> {
  const counts = Object.fromEntries(REVIEW_THEMES.map((theme) => [theme.id, 0])) as Record<ReviewThemeId, number>;
  for (const review of reviews) {
    for (const id of themesOfReviewText(review.text)) counts[id] += 1;
  }
  return counts;
}

// ─── Méthode `ia` ────────────────────────────────────────────────────────────

/** Avis par appel : assez pour amortir la consigne, assez peu pour une réponse courte. */
export const REVIEW_THEMES_IA_CHUNK = 60;
/** Un avis trop long est coupé : le thème se lit dans les premières phrases. */
const REVIEW_TEXT_MAX_CHARS = 600;

export function buildThemesPrompt(reviews: GoogleReview[]): string {
  const themes = REVIEW_THEMES.map((theme) => `- "${theme.id}" : ${theme.label} (${theme.describe})`).join("\n");
  const lines = reviews
    .map((review, index) => `Avis ${index + 1} (${review.rating ?? "?"}★) : "${review.text.replace(/\s+/g, " ").slice(0, REVIEW_TEXT_MAX_CHARS)}"`)
    .join("\n");
  return `Tu es un analyste qualité déménagement.
Pour chacun des thèmes POSITIFS ci-dessous, liste les numéros des avis qui félicitent EXPLICITEMENT le déménageur sur ce point.
Un avis peut porter plusieurs thèmes. N'invente rien : un avis qui ne parle pas d'un thème n'y figure pas ; une critique n'est jamais un thème positif.

THÈMES :
${themes}

AVIS :
${lines}

Réponds UNIQUEMENT en JSON :
{"themes":[{"themeId":"ponctualite","reviewNumbers":[1,4]}]}`;
}

/** Lit la réponse du modèle : identifiants de la liste fermée, numéros d'avis valides, sans doublon. */
export function parseThemesAnswer(json: unknown, reviewCount: number): Record<ReviewThemeId, Set<number>> {
  const out = Object.fromEntries(REVIEW_THEMES.map((theme) => [theme.id, new Set<number>()])) as Record<ReviewThemeId, Set<number>>;
  const entries = json && typeof json === "object" ? (json as { themes?: unknown }).themes : null;
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const { themeId, reviewNumbers } = entry as { themeId?: unknown; reviewNumbers?: unknown };
    if (typeof themeId !== "string" || !THEME_IDS.has(themeId) || !Array.isArray(reviewNumbers)) continue;
    for (const n of reviewNumbers) {
      if (typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= reviewCount) out[themeId as ReviewThemeId].add(n);
    }
  }
  return out;
}

export type IaThemesResult = {
  counts: Record<ReviewThemeId, number>;
  calls: number;
  failedCalls: number;
  usage: { inputTokens: number; outputTokens: number };
  /** Le modèle qui a réellement répondu (le dernier paquet) : OpenAI ou, à défaut, Claude. */
  model: string | null;
};

/** Méthode `ia` : le même modèle que la vigilance, par paquets de 60 avis. Null si un appel n'a pas abouti. */
export async function countThemesWithAi(
  reviews: GoogleReview[],
  clients: readonly LlmClient[],
): Promise<IaThemesResult | null> {
  const counts = Object.fromEntries(REVIEW_THEMES.map((theme) => [theme.id, 0])) as Record<ReviewThemeId, number>;
  const usage = { inputTokens: 0, outputTokens: 0 };
  let calls = 0;
  let failedCalls = 0;
  let model: string | null = null;
  for (let start = 0; start < reviews.length; start += REVIEW_THEMES_IA_CHUNK) {
    const chunk = reviews.slice(start, start + REVIEW_THEMES_IA_CHUNK);
    calls += 1;
    const answer = await completeJsonWithFallback(clients, buildThemesPrompt(chunk), { maxTokens: 800 });
    if (!answer) {
      failedCalls += 1;
      continue;
    }
    model = answer.model;
    if (answer.usage) {
      usage.inputTokens += answer.usage.inputTokens;
      usage.outputTokens += answer.usage.outputTokens;
    }
    const sets = parseThemesAnswer(answer.json, chunk.length);
    for (const theme of REVIEW_THEMES) counts[theme.id] += sets[theme.id].size;
  }
  // Un paquet perdu fausserait les comptes vers le bas : tout ou rien.
  if (calls === 0 || failedCalls > 0) return null;
  return { counts, calls, failedCalls, usage, model };
}

// ─── Estimation de coût (méthode `ia`) ──────────────────────────────────────

/** Environ 3,5 caractères par jeton pour du français ; la consigne compte ~350 jetons par appel. */
export function estimateThemesTokens(reviews: GoogleReview[]): { calls: number; inputTokens: number; outputTokens: number } {
  const calls = Math.ceil(reviews.length / REVIEW_THEMES_IA_CHUNK);
  const chars = reviews.reduce((sum, review) => sum + Math.min(review.text.length, REVIEW_TEXT_MAX_CHARS) + 20, 0);
  return { calls, inputTokens: Math.ceil(chars / 3.5) + calls * 350, outputTokens: calls * 150 };
}

export function estimateCostUsd(tokens: { inputTokens: number; outputTokens: number }, provider: "openai" | "anthropic"): number {
  const price = REVIEWS_LLM_PRICES_USD_PER_M[provider];
  return (tokens.inputTokens * price.input + tokens.outputTokens * price.output) / 1_000_000;
}
