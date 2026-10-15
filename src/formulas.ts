/**
 * Les cinq formules du score Moverz, leurs poids et la règle stricte du score
 * global. Aucune dépendance : c'est le fichier à lire en premier.
 *
 *   financier 12,5 % · juridique 12,5 % · Google 20 % · réputation 20 % · vigilance 35 %
 *
 * Pourquoi ces poids : voir docs/METIER.md.
 */
export interface LegacyScoringConfig {
  weightFinancier: number;
  weightJuridique: number;
  weightGoogle: number;
  weightReputation: number;
  weightVigilance: number;
  juriMalusPerRecent: number;
  juriMalusPerOld: number;
  juriMalusGravity: number;
  juriRecentThresholdYears: number;
  googleMinReviewsForFullScore: number;
  googleLowVolumeMaxScore: number;
  defaultFinancialScore: number;
  defaultReputationScore: number;
  defaultVigilanceScore: number;
}

export const LEGACY_DEFAULT_CONFIG: LegacyScoringConfig = {
  weightFinancier: 0.125,
  weightJuridique: 0.125,
  weightGoogle: 0.2,
  weightReputation: 0.2,
  weightVigilance: 0.35,
  juriMalusPerRecent: 25,
  juriMalusPerOld: 10,
  juriMalusGravity: 15,
  juriRecentThresholdYears: 3,
  googleMinReviewsForFullScore: 20,
  googleLowVolumeMaxScore: 75,
  defaultFinancialScore: 50,
  defaultReputationScore: 50,
  defaultVigilanceScore: 50,
};

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function labelFromScore(score: number | null) {
  if (score === null) return null;
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Bon";
  if (score >= 50) return "Correct";
  if (score >= 30) return "Fragile";
  return "Critique";
}

type FinancialExercise = {
  annee?: number;
  chiffre_affaires: number | null;
  resultat: number | null;
  fonds_propres: number | null;
  tresorerie: number | null;
  dettes_financieres: number | null;
  taux_croissance_chiffre_affaires?: number | null;
};

function scoreResultat(latest: FinancialExercise, prev: FinancialExercise | null) {
  const resultat = latest.resultat;
  if (resultat == null) return 10;
  const ca = latest.chiffre_affaires;
  if (resultat > 0) {
    if (ca && ca > 0) {
      const margin = resultat / ca;
      if (margin > 0.05) return 25;
      if (margin > 0.02) return 22;
      return 18;
    }
    return 20;
  }
  if (ca && ca > 0) {
    const lossRate = Math.abs(resultat) / ca;
    if (lossRate < 0.03) return 10;
    if (lossRate < 0.1) return 5;
    return 2;
  }
  if (resultat > -10_000) return 8;
  if (resultat > -50_000) return 4;
  if (prev && prev.resultat != null && resultat > prev.resultat) return 5;
  return 1;
}

function scoreFondsPropres(latest: FinancialExercise) {
  const fp = latest.fonds_propres;
  if (fp == null) return 10;
  if (fp > 100_000) return 25;
  if (fp > 50_000) return 22;
  if (fp > 10_000) return 18;
  if (fp > 0) return 12;
  if (fp > -20_000) return 5;
  return 1;
}

function scoreTresorerie(latest: FinancialExercise) {
  const tr = latest.tresorerie;
  if (tr == null) return 8;
  if (tr > 50_000) return 20;
  if (tr > 10_000) return 16;
  if (tr > 1_000) return 12;
  if (tr > 0) return 7;
  return 2;
}

function scoreEndettement(latest: FinancialExercise) {
  const dettes = latest.dettes_financieres;
  const fp = latest.fonds_propres;
  if (dettes == null && fp == null) return 7;
  if (dettes == null || dettes === 0) return 15;
  if (fp != null && fp > 0) {
    const ratio = dettes / fp;
    if (ratio < 0.3) return 13;
    if (ratio < 0.7) return 10;
    if (ratio < 1) return 7;
    if (ratio < 2) return 4;
    return 1;
  }
  if (fp != null && fp <= 0) return 0;
  return 5;
}

function scoreTendance(latest: FinancialExercise, prev: FinancialExercise | null) {
  if (!prev) return 7;
  let caUp: boolean | null = null;
  let resultUp: boolean | null = null;

  if (
    latest.chiffre_affaires != null &&
    prev.chiffre_affaires != null &&
    prev.chiffre_affaires !== 0
  ) {
    const growth = (latest.chiffre_affaires - prev.chiffre_affaires) / Math.abs(prev.chiffre_affaires);
    caUp = growth > 0.02;
  } else if (latest.taux_croissance_chiffre_affaires != null) {
    caUp = latest.taux_croissance_chiffre_affaires > 2;
  }
  if (latest.resultat != null && prev.resultat != null) {
    resultUp = latest.resultat > prev.resultat;
  }

  if (caUp === true && resultUp === true) return 15;
  if ((caUp === true && resultUp === null) || (caUp === null && resultUp === true)) return 12;
  if ((caUp === true && resultUp === false) || (caUp === false && resultUp === true)) return 9;
  if (caUp === false && resultUp === false) return 3;
  if ((caUp === null && resultUp === false) || (caUp === false && resultUp === null)) return 5;
  return 7;
}

/**
 * Champs d'un exercice que l'exercice précédent peut compléter quand le registre
 * ne les donne pas (Guillaume, 14/10/2026). Jamais le résultat : un résultat
 * absent reste absent, il ne prend pas celui de l'année d'avant.
 */
const FINANCIAL_FILLABLE_FIELDS = ["chiffre_affaires", "fonds_propres", "tresorerie", "dettes_financieres"] as const;

/**
 * Un bilan dont l'exercice le plus récent a clôturé il y a plus de 24 mois (à la
 * date du calcul) ne dit plus rien de la santé actuelle de l'entreprise : on le
 * traite comme « pas de chiffres », financier neutre 50. Sans plancher : un vieux
 * mauvais bilan devient 50 lui aussi (Guillaume a refusé le plancher, 14/10/2026).
 */
export const FINANCIAL_STALE_MONTHS = 24;

/** Date de clôture d'un exercice (date explicite, sinon le 31/12 de l'année). */
export function financialClosureDate(exercise: Record<string, unknown>): Date | null {
  const raw =
    typeof exercise.date_de_cloture_exercice === "string"
      ? exercise.date_de_cloture_exercice
      : typeof exercise.date_cloture === "string"
        ? exercise.date_cloture
        : null;
  if (raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (typeof exercise.annee === "number") return new Date(Date.UTC(exercise.annee, 11, 31));
  return null;
}

/** Exercices du plus récent au plus ancien ; ceux sans date gardent leur ordre, à la fin. */
function sortExercisesByClosure(finances: Array<Record<string, unknown>>) {
  const dated = finances.map((ex, index) => ({ ex, index, d: financialClosureDate(ex) }));
  return dated
    .sort((a, b) => {
      if (a.d && b.d) return b.d.getTime() - a.d.getTime() || a.index - b.index;
      if (a.d) return -1;
      if (b.d) return 1;
      return a.index - b.index;
    })
    .map((x) => x.ex);
}

/**
 * Note financière sur 100 à partir des bilans publiés : résultat /25, fonds
 * propres /25, trésorerie /20, endettement /15, tendance /15. `null` si aucun
 * chiffre exploitable : on ne note pas une entreprise sur du vide.
 *
 * Depuis le 14/10/2026 (Guillaume) : toujours l'exercice le plus récent. Avant,
 * on prenait « le plus rempli des trois derniers », qui pouvait noter une
 * entreprise sur un bilan vieux de plusieurs années alors qu'un plus récent était
 * publié. Les champs manquants du plus récent se complètent avec l'exercice
 * précédent (jamais le résultat) ; la tendance compare les valeurs propres des
 * deux exercices.
 *
 * Ne regarde pas l'âge du bilan : voir `assessLegacyFinancial`.
 */
export function computeLegacyFinancialScore(finances: Array<Record<string, unknown>>) {
  if (!Array.isArray(finances) || finances.length === 0) return null;
  const sorted = sortExercisesByClosure(finances);
  const own = sorted[0] as unknown as FinancialExercise;
  const prev = sorted.length > 1 ? (sorted[1] as unknown as FinancialExercise) : null;
  const latest: FinancialExercise = { ...own };
  if (prev) {
    for (const key of FINANCIAL_FILLABLE_FIELDS) {
      if (latest[key] == null && prev[key] != null) latest[key] = prev[key];
    }
  }
  const hasAnyData = [
    latest.resultat,
    latest.fonds_propres,
    latest.tresorerie,
    latest.chiffre_affaires,
    latest.dettes_financieres,
  ].some((v) => v != null);
  if (!hasAnyData) return null;

  const score =
    scoreResultat(latest, prev) +
    scoreFondsPropres(latest) +
    scoreTresorerie(latest) +
    scoreEndettement(latest) +
    scoreTendance(own, prev);
  return clamp(score);
}

export type LegacyFinancialAssessment = {
  /** Null : pas de chiffres exploitables, ou bilan trop ancien. */
  score: number | null;
  /** `scored` : note calculée ; `no_data` : aucun chiffre ; `stale` : bilan de plus de 24 mois. */
  status: "scored" | "no_data" | "stale";
  /** Clôture de l'exercice le plus récent (AAAA-MM-JJ), si connue. */
  latestClosure: string | null;
};

/**
 * La note financière à la date `now`, bilan trop ancien compris (14/10/2026).
 * `stale` donne `score: null` : `financialScoreForGlobal` applique alors la
 * neutralité (50), comme pour une entreprise qui ne publie pas ses comptes.
 */
export function assessLegacyFinancial(
  finances: Array<Record<string, unknown>> | null | undefined,
  now: Date = new Date(),
): LegacyFinancialAssessment {
  const list = Array.isArray(finances) ? finances : [];
  if (list.length === 0) return { score: null, status: "no_data", latestClosure: null };
  const latestDate = financialClosureDate(sortExercisesByClosure(list)[0]);
  const latestClosure = latestDate ? latestDate.toISOString().slice(0, 10) : null;
  if (latestDate) {
    const staleBefore = new Date(now.getTime());
    staleBefore.setUTCMonth(staleBefore.getUTCMonth() - FINANCIAL_STALE_MONTHS);
    if (latestDate < staleBefore) return { score: null, status: "stale", latestClosure };
  }
  const score = computeLegacyFinancialScore(list);
  return { score, status: score == null ? "no_data" : "scored", latestClosure };
}

// Sans accents : le texte est replié avant comparaison (« Procédure » = « procedure »).
// « procedure collective » couvre la décision synthétique posée quand le registre
// signale une procédure en cours (corrigé le 08/10/2026 : elle ne prenait pas le
// malus de gravité).
const GRAVE_KEYWORDS = [
  "procedure collective",
  "liquidation",
  "condamnation",
  "redressement",
  "sauvegarde",
  "faillite",
  "dissolution",
];

function isGraveDecision(dispositif: unknown) {
  if (typeof dispositif !== "string") return false;
  const lower = dispositif.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  return GRAVE_KEYWORDS.some((kw) => lower.includes(kw));
}

/** Une décision sans date lisible est traitée comme récente : dans le doute, on ne minimise pas. */
function isRecentDecision(dateValue: unknown, thresholdYears: number, now: Date) {
  if (typeof dateValue !== "string") return true;
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return true;
  const cutoff = new Date(now);
  cutoff.setFullYear(cutoff.getFullYear() - thresholdYears);
  return d >= cutoff;
}

/**
 * 100 moins un malus par décision de justice où l'entreprise est défenderesse :
 * 25 si elle a moins de 3 ans, 10 sinon, +15 si le dispositif contient un mot
 * grave (liquidation, redressement…). Une décision où l'entreprise attaque ne
 * compte pas : réclamer son dû n'est pas un signal de risque.
 */
export function computeLegacyJuridicalScore(
  decisions: Array<Record<string, unknown>>,
  cfg: LegacyScoringConfig = LEGACY_DEFAULT_CONFIG,
  now: Date = new Date()
) {
  if (!Array.isArray(decisions) || decisions.length === 0) return 100;
  let score = 100;
  for (const d of decisions) {
    const isAttacking =
      typeof d.position === "string" && d.position.toLowerCase() === "attaque";
    if (isAttacking) continue;
    const recent = isRecentDecision(d.date, cfg.juriRecentThresholdYears, now);
    const grave = isGraveDecision(d.dispositif);
    const baseMalus = recent ? cfg.juriMalusPerRecent : cfg.juriMalusPerOld;
    const totalMalus = baseMalus + (grave ? cfg.juriMalusGravity : 0);
    score -= totalMalus;
  }
  return clamp(score);
}

/**
 * (note / 5) × 100, plus un bonus de volume (max +10), plafonné selon le nombre
 * d'avis (`googleVolumeCap`) : un 5/5 sur 6 avis ne vaut pas un 4,7 sur 300.
 */
export function computeLegacyGoogleScore(
  googleRating: number | null,
  googleReviewsCount: number | null,
  // Le businessStatus n'est plus utilisé dans le calcul : le score Google reflète
  // la note agrégée de la fiche (tous les avis). Le statut reste exposé dans le
  // snapshot providers pour que l'opérateur voie si une fiche est fermée.
  _googleBusinessStatus: string | null,
  cfg: LegacyScoringConfig = LEGACY_DEFAULT_CONFIG
): number | null {
  if (googleRating == null) return null;
  const ratingScore = (Math.max(0, Math.min(5, googleRating)) / 5) * 100;
  const reviews = Number(googleReviewsCount ?? 0);
  const volumeBonus = Math.min(
    10,
    (reviews / Math.max(1, cfg.googleMinReviewsForFullScore)) * 10
  );
  const score = Math.min(100, ratingScore + volumeBonus);
  return clamp(Math.min(score, googleVolumeCap(reviews, cfg)));
}

/**
 * Plafond de la note Google selon le nombre d'avis, progressif (Guillaume,
 * 14/10/2026) : 75 jusqu'à 10 avis, puis 75 + 2,5 par avis au-delà de 10, plus
 * de plafond à partir de 20. Avant : 75 sous 20 avis, puis rien — 19 avis
 * plafonnaient à 75 et 20 avis à 100, une marche de 25 points pour un avis.
 */
export const GOOGLE_CAP_RAMP_START_REVIEWS = 10;

export function googleVolumeCap(reviews: number, cfg: LegacyScoringConfig = LEGACY_DEFAULT_CONFIG): number {
  const full = cfg.googleMinReviewsForFullScore;
  if (reviews >= full) return 100;
  if (reviews <= GOOGLE_CAP_RAMP_START_REVIEWS) return cfg.googleLowVolumeMaxScore;
  const span = full - GOOGLE_CAP_RAMP_START_REVIEWS;
  return cfg.googleLowVolumeMaxScore + ((100 - cfg.googleLowVolumeMaxScore) * (reviews - GOOGLE_CAP_RAMP_START_REVIEWS)) / span;
}

/**
 * Les DEUX seules exceptions à « pas de note inventée » valent 50/100, et
 * seulement quand la source a répondu :
 *  - financier : le registre a trouvé l'entreprise mais elle ne publie pas de
 *    bilan (TPE, comptes confidentiels), ou son dernier bilan a clôturé il y a
 *    plus de 24 mois (`assessLegacyFinancial`, depuis le 14/10/2026) ;
 *  - Google : la fiche existe mais n'a encore aucune note.
 * 50 est la neutralité : ni bonus, ni sanction pour une absence qui n'est pas
 * une faute. Une source en panne, elle, n'a jamais de valeur de repli.
 */
export const NEUTRAL_FALLBACK_SCORE = 50;

/**
 * Exception n° 1 — financier. Un bilan téléversé par le déménageur et validé
 * (voir `financial-override.ts`) passe avant tout ; sinon la note du registre ;
 * sinon 50 si le registre a répondu ; sinon rien.
 */
export function financialScoreForGlobal(input: {
  registryAvailable: boolean;
  computed: number | null;
  overrideScore?: number | null;
}): { score: number | null; fallbackApplied: boolean; overrideApplied: boolean } {
  if (input.overrideScore != null) {
    return { score: clamp(input.overrideScore), fallbackApplied: false, overrideApplied: true };
  }
  if (!input.registryAvailable) return { score: null, fallbackApplied: false, overrideApplied: false };
  if (input.computed != null) return { score: input.computed, fallbackApplied: false, overrideApplied: false };
  return { score: NEUTRAL_FALLBACK_SCORE, fallbackApplied: true, overrideApplied: false };
}

/**
 * Exception n° 2 — Google. Fiche trouvée mais sans note (0 avis) : 50/100,
 * comme le financier sans bilan. Une fiche introuvable reste bloquante.
 */
export function googleScoreForGlobal(input: {
  available: boolean;
  computed: number | null;
}): { score: number | null; fallbackApplied: boolean } {
  if (!input.available) return { score: null, fallbackApplied: false };
  if (input.computed != null) return { score: input.computed, fallbackApplied: false };
  return { score: NEUTRAL_FALLBACK_SCORE, fallbackApplied: true };
}

/**
 * Calcule le score global selon la politique STRICT :
 * - Un composant manquant (=== null) n'est JAMAIS remplacé par une valeur par défaut.
 * - `globalScore` est calculé uniquement si tous les composants listés dans
 *   `requiredForGlobal` sont présents.
 * - Sinon, `globalScore = null` et la liste des composants manquants est
 *   retournée pour que l'orchestrateur construise une erreur de fiabilité.
 */
export function buildStrictGlobalScore(input: {
  financial: number | null;
  juridical: number | null;
  google: number | null;
  reputation: number | null;
  vigilance: number | null;
  requiredForGlobal?: Array<
    "financial" | "juridical" | "google" | "reputation" | "vigilance"
  >;
  config?: LegacyScoringConfig;
}) {
  const cfg = input.config ?? LEGACY_DEFAULT_CONFIG;
  const required =
    input.requiredForGlobal ??
    ["financial", "juridical", "google", "reputation", "vigilance"];

  const components = {
    financial: input.financial == null ? null : clamp(input.financial),
    juridical: input.juridical == null ? null : clamp(input.juridical),
    google: input.google == null ? null : clamp(input.google),
    reputation: input.reputation == null ? null : clamp(input.reputation),
    vigilance: input.vigilance == null ? null : clamp(input.vigilance),
  };

  const weights = {
    financial: cfg.weightFinancier,
    juridical: cfg.weightJuridique,
    google: cfg.weightGoogle,
    reputation: cfg.weightReputation,
    vigilance: cfg.weightVigilance,
  };

  const missingComponents = required.filter((key) => components[key] == null);

  if (missingComponents.length > 0) {
    return {
      components,
      globalScore: null as number | null,
      globalLabel: null as string | null,
      weights,
      missingComponents,
    };
  }

  const raw =
    (components.financial as number) * cfg.weightFinancier +
    (components.juridical as number) * cfg.weightJuridique +
    (components.google as number) * cfg.weightGoogle +
    (components.reputation as number) * cfg.weightReputation +
    (components.vigilance as number) * cfg.weightVigilance;

  const globalScore = clamp(raw);
  return {
    components,
    globalScore: globalScore as number | null,
    globalLabel: labelFromScore(globalScore),
    weights,
    missingComponents,
  };
}
