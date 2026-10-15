import { extractCompanyHealth, type CompanyHealth } from "./company-health.js";
import { shouldSupersedeOverride } from "./financial-override.js";
import {
  assessLegacyFinancial,
  buildStrictGlobalScore,
  computeLegacyGoogleScore,
  financialScoreForGlobal,
  googleScoreForGlobal,
  labelFromScore,
  LEGACY_DEFAULT_CONFIG,
  type LegacyFinancialAssessment,
} from "./formulas.js";
import type { LlmClient } from "./llm/client.js";
import { assessGoogleTrade, type GoogleTradeVerdict } from "./google-trade.js";
import { motifPrincipal, type Motif } from "./motif.js";
import {
  classifyUnreliability,
  companyVerdictList,
  googleFailure,
  pappersFailure,
  SEARCHAPI_INCOMPLETE_ERROR,
  searchApiFailure,
} from "./outage-policy.js";
import type { RegistrySnapshot, ScoringProviders } from "./ports.js";
import {
  applyRegisterCap,
  findSitrSuccessorCandidates,
  identityFromRegistry,
  knownPersonsFromRegistry,
  REGISTER_ABSENT_MAX_SCORE,
  registerSuccessorWarnings,
  type SitrSuccessorCandidate,
} from "./register-cap.js";
import { deriveReputationSnapshot, deriveVigilanceSnapshot } from "./reputation.js";
import { selectReviewsWindow } from "./review-window.js";
import { applyClosedToJuridicalScore, applySitrToJuridicalScore, sitrJuridicalVerdict, type SitrJuridicalVerdict } from "./sitr-juridical.js";
import { sirenFromMover, transportRegisterSnapshotSchema } from "./transport-register.js";
import type {
  GoogleSnapshot,
  MoverIdentity,
  ReliabilityDetails,
  ReputationSnapshot,
  ReviewsSnapshot,
  ScoringComponentScores,
  VigilanceSnapshot,
} from "./types.js";

/**
 * Orchestration STRICTE : trois instantanés en entrée, un résultat en sortie.
 * Aucune entrée/sortie ici — les appels réseau sont derrière les ports
 * (`ports.ts`), la base derrière l'appelant.
 *
 * Règle « pas de note inventée » : si l'une des trois sources critiques
 * (registre des entreprises, fiche Google, collecte des avis) manque, il n'y a
 * PAS de note globale (`globalScore = null`, `isReliable = false`) et
 * `reliabilityError` dit pourquoi. Les sous-scores disponibles restent visibles
 * pour l'audit, mais ne recomposent jamais une note « partielle ».
 *
 * Exactement deux exceptions, à 50, uniquement quand la source a répondu :
 * financier sans bilan publié, fiche Google sans aucune note.
 *
 * Une fiche Google « hors métier » (ses avis ne parlent pas de déménagement,
 * `google-trade.ts`) n'est pas celle d'un déménageur : sa composante Google est
 * retirée, et il n'y a pas de note globale.
 *
 * Depuis le 14/10/2026, chaque échec dit sa nature (`outage-policy.ts`) : panne
 * technique ou verdict de fond. Une collecte d'avis amputée est une panne : elle
 * ne note pas.
 *
 * Depuis le 14/10/2026 (version `legacy-compatible-v2`) : le bilan est lu à la
 * date du calcul (exercice le plus récent ; plus de 24 mois = pas de chiffres),
 * et une absence confirmée au registre des transporteurs plafonne la note à 65,
 * sauf si l'entreprise y figure sous un autre SIREN, ou si l'annuaire du registre
 * n'a pas pu être lu (`register-cap.ts`).
 */

export const ALGORITHM_VERSION = "legacy-compatible-v2";

export interface FinancialOverrideInput {
  computedScore: number;
  /** Clôture de l'exercice du bilan téléversé (`YYYY-MM-DD`). */
  dateCloture: string;
}

export interface ScoringInput {
  registry: RegistrySnapshot;
  google: GoogleSnapshot;
  reviews: ReviewsSnapshot;
  financialOverride?: FinancialOverrideInput | null;
  /** Modèles de langage pour la vigilance ; absents = heuristique seule, résultat déterministe. */
  llm?: readonly LlmClient[];
  now?: Date;
  /**
   * Identité de la fiche (nom, lieu, SIREN) : sert à chercher, en cas d'absence au
   * registre des transporteurs, si l'entreprise y figure sous un autre SIREN. Absente :
   * la recherche se fait avec les seuls noms et lieux du registre des entreprises.
   */
  mover?: Pick<MoverIdentity, "companyName" | "siren" | "siret" | "city" | "postalCode"> | null;
}

export interface ScoringResult {
  algorithmVersion: string;
  components: ScoringComponentScores;
  globalScore: number | null;
  globalLabel: string | null;
  isReliable: boolean;
  reliabilityError: string | null;
  reliabilityDetails: ReliabilityDetails;
  weights: Record<string, number>;
  reputation: ReputationSnapshot;
  vigilance: VigilanceSnapshot;
  companyHealth: CompanyHealth;
  /** Le motif qui coûte le plus de points (vide sans composante). */
  motif: Motif;
  details: {
    financialFallbackApplied: boolean;
    googleFallbackApplied: boolean;
    financialOverrideApplied: boolean;
    financialOverrideSupersededByRegistry: boolean;
    sitrJuridicalVerdict: SitrJuridicalVerdict;
    sireneClosed: boolean;
    /**
     * Plafond à 65 d'une absence confirmée au registre des transporteurs (14/10/2026).
     * `uncappedScore` : la note avant plafond (null sans plafond) ; `successors` : les
     * autres SIREN trouvés au registre (null : recherche sans objet ou impossible).
     */
    registerCap: {
      capped: boolean;
      maxScore: number;
      uncappedScore: number | null;
      successors: SitrSuccessorCandidate[] | null;
    };
    /** Lecture du bilan à la date du calcul (null : score natif du registre, ou registre absent). */
    financialAssessment: Pick<LegacyFinancialAssessment, "status" | "latestClosure"> | null;
    /** La fiche Google décrit-elle un déménageur ? `offTrade` = non : note non fiable. Null sans avis collectés. */
    googleTrade: GoogleTradeVerdict | null;
    /** Méthode réellement utilisée par la vigilance, et raison d'un repli sur les mots-clés. */
    vigilance: { method: VigilanceSnapshot["method"] | null; fallbackReason: string | null; llmFallback: boolean };
  };
}

function emptyReputation(explanation: string): ReputationSnapshot {
  return {
    source: "reviews_pattern",
    negativeMentions: 0,
    reputationScore: null,
    authenticCount: 0,
    suspiciousCount: 0,
    negativeRatio: 0,
    explanation,
  };
}

function emptyVigilance(): VigilanceSnapshot {
  return { source: "vigilance_categories", vigilanceScore: null, categories: [], totalAuthenticReviews: 0 };
}

/** Date de clôture la plus récente publiée au registre (sert à détrôner un bilan téléversé plus ancien). */
export function latestClosureDate(finances: Array<Record<string, unknown>> | null | undefined): Date | null {
  if (!Array.isArray(finances)) return null;
  let best: Date | null = null;
  for (const exercise of finances) {
    const rawDate =
      typeof exercise.date_de_cloture_exercice === "string"
        ? exercise.date_de_cloture_exercice
        : typeof exercise.date_cloture === "string"
          ? exercise.date_cloture
          : null;
    let parsed: Date | null = rawDate && !Number.isNaN(new Date(rawDate).getTime()) ? new Date(rawDate) : null;
    if (!parsed && typeof exercise.annee === "number") parsed = new Date(Date.UTC(exercise.annee, 11, 31));
    if (parsed && (!best || parsed > best)) best = parsed;
  }
  return best;
}

/** Annuaire du registre illisible pendant la recherche d'un autre SIREN : pas de plafond, calcul à refaire. */
export const SITR_DIRECTORY_UNREAD_WARNING = "sitr_successor_lookup_failed:no_cap";

/**
 * L'entreprise absente du registre des transporteurs y figure-t-elle sous un autre
 * SIREN ? Null si l'annuaire du registre n'a pas été fourni (lecture impossible).
 */
export function lookupSitrSuccessors(input: Pick<ScoringInput, "registry" | "mover">): SitrSuccessorCandidate[] | null {
  const directory = input.registry.transportRegisterDirectory;
  if (directory == null) return null;
  const raw = input.registry.pappers.raw;
  const fromRegistry = identityFromRegistry(raw);
  const register = transportRegisterSnapshotSchema.safeParse(input.registry.transportRegister).data;
  const mover = input.mover ?? null;
  return findSitrSuccessorCandidates({
    directory,
    ownSiren: (mover ? sirenFromMover(mover) : null) ?? register?.siren ?? null,
    names: [mover?.companyName, ...fromRegistry.names],
    places: [{ postalCode: mover?.postalCode, commune: mover?.city }, ...fromRegistry.places],
    managers: knownPersonsFromRegistry(raw),
  });
}

export async function computeScore(input: ScoringInput): Promise<ScoringResult> {
  const now = input.now ?? new Date();
  const { pappers, transportRegister } = input.registry;
  const { google, reviews } = input;
  const warnings: string[] = [];

  // Les avis ne comptent que s'ils viennent de la fiche trouvée ET ont été collectés
  // en entier : une collecte amputée (pagination perdue) est une panne, pas une
  // fiche à moins d'avis (14/10/2026).
  const reviewsIncomplete = reviews.available && reviews.incomplete;
  const reviewsUsable = google.available && reviews.available && !reviewsIncomplete;
  const reviewsError = reviewsIncomplete ? SEARCHAPI_INCOMPLETE_ERROR : reviews.error;
  const window = reviewsUsable ? selectReviewsWindow(reviews.reviews, now) : null;
  if (reviewsIncomplete) warnings.push("reviews_incomplete:treated_as_outage");

  const reputation: ReputationSnapshot = window
    ? {
        ...deriveReputationSnapshot(window.reviews),
        windowMonths: window.windowMonths,
        reviewsCount12m: window.reviewsCount12m,
        reviewsCount24m: window.reviewsCount24m,
      }
    : emptyReputation("Avis indisponibles — réputation non calculable");

  const vigilance: VigilanceSnapshot = window
    ? {
        ...(await deriveVigilanceSnapshot(window.reviews, { llm: input.llm })),
        windowMonths: window.windowMonths,
        reviewsCount12m: window.reviewsCount12m,
        reviewsCount24m: window.reviewsCount24m,
      }
    : emptyVigilance();

  // Google — exception n° 2 : fiche trouvée sans note = 50.
  const googleForGlobal = googleScoreForGlobal({
    available: google.available,
    computed: computeLegacyGoogleScore(google.rating, google.ratingCount, google.businessStatus, LEGACY_DEFAULT_CONFIG),
  });
  if (googleForGlobal.fallbackApplied) warnings.push("google_fallback_applied:no_rating");

  // Financier — bilan téléversé, sauf si le registre en publie un plus récent ; exception n° 1 sinon.
  let override = input.financialOverride ?? null;
  let overrideSuperseded = false;
  if (override && pappers.available && shouldSupersedeOverride(new Date(override.dateCloture), latestClosureDate(pappers.finances))) {
    override = null;
    overrideSuperseded = true;
    warnings.push("financial_override_superseded:registry_more_recent");
  }
  // Depuis le 14/10/2026 : la note heuristique se recalcule à la date du calcul, pas
  // à celle de l'appel au registre (fiche en cache) : exercice le plus récent, et un
  // bilan clôturé il y a plus de 24 mois compte comme « pas de chiffres » (50).
  const financialAssessment =
    pappers.available && pappers.financialSource !== "pappers_native" ? assessLegacyFinancial(pappers.finances, now) : null;
  const financial = financialScoreForGlobal({
    registryAvailable: pappers.available,
    computed: pappers.financialSource === "pappers_native" ? pappers.financialScore : (financialAssessment?.score ?? null),
    overrideScore: override?.computedScore ?? null,
  });
  if (financial.fallbackApplied) {
    warnings.push(
      financialAssessment?.status === "stale"
        ? `financial_fallback_applied:stale_accounts:${financialAssessment.latestClosure ?? "?"}`
        : "financial_fallback_applied:no_published_accounts",
    );
  }

  // Fiche hors métier — jugée sur tous les avis collectés (24 mois), pas sur la fenêtre.
  const googleTrade = reviewsUsable ? assessGoogleTrade(reviews.reviews, google.name ?? null) : null;
  if (googleTrade?.offTrade) warnings.push(`google_fiche_off_trade:${Math.round((googleTrade.ratio ?? 0) * 100)}%`);

  // Juridique — le registre des transporteurs et l'état Sirene peuvent l'écraser à 0.
  const sitrVerdict = sitrJuridicalVerdict(transportRegister);
  const sireneClosed = input.registry.sireneClosed === true;
  let juridical = pappers.available ? applySitrToJuridicalScore(pappers.juridicalScore, transportRegister) : null;
  juridical = applyClosedToJuridicalScore(juridical, sireneClosed);
  if (transportRegister == null) warnings.push("sitr_lookup_failed");
  if (sitrVerdict === "zero") warnings.push("sitr_juridical_zero:not_on_transport_register");
  if (sireneClosed) warnings.push("company_closed_in_sirene");

  const strict = buildStrictGlobalScore({
    financial: financial.score,
    juridical,
    google: googleTrade?.offTrade ? null : googleForGlobal.score,
    reputation: reviewsUsable ? reputation.reputationScore : null,
    vigilance: reviewsUsable ? vigilance.vigilanceScore : null,
    config: LEGACY_DEFAULT_CONFIG,
  });

  // Absence confirmée au registre des transporteurs (Guillaume, 14/10/2026) : note
  // globale plafonnée à 65, sauf si l'entreprise y figure sous un autre SIREN
  // (signalée à l'équipe pour revue). Un registre illisible ne pénalise pas, ni un
  // annuaire illisible (15/10/2026 : en production, le calcul est refait 24 h plus tard).
  // Un SEUL autre SIREN lève le plafond ; plusieurs = ambiguïté, le plafond reste
  // (15/10/2026 : un même réseau rapprochait plusieurs fiches de trois sociétés).
  // Une société sœur (même gérant, même commune, aucun mot du nom en commun) ne lève
  // rien : fiche à vérifier, `sitr_successor_to_review:<siren>` (option A, 15/10/2026).
  const capVerdict: SitrJuridicalVerdict = transportRegister == null ? "unknown" : sitrVerdict;
  const sitrSuccessors = capVerdict === "zero" ? lookupSitrSuccessors(input) : null;
  if (capVerdict === "zero" && sitrSuccessors == null) warnings.push(SITR_DIRECTORY_UNREAD_WARNING);
  const uncappedScore = strict.globalScore;
  const registerCap = applyRegisterCap({ globalScore: strict.globalScore, verdict: capVerdict, successors: sitrSuccessors });
  warnings.push(...registerSuccessorWarnings(sitrSuccessors));
  if (registerCap.capped) {
    warnings.push(`sitr_register_cap:${REGISTER_ABSENT_MAX_SCORE}`);
    strict.globalScore = registerCap.score;
    strict.globalLabel = labelFromScore(registerCap.score);
  }

  const isReliable = strict.globalScore !== null;
  const registryHealth = pappers.available ? extractCompanyHealth(pappers.raw) : null;
  const failures = {
    registry: pappersFailure(pappers),
    google: googleFailure(google),
    // Sans fiche Google, c'est Google qui porte la cause, pas la collecte.
    reviews: google.available ? searchApiFailure({ available: reviewsUsable, error: reviewsError }) : null,
  };
  const reliabilityError = isReliable
    ? null
    : [
        !pappers.available ? `Registre: ${pappers.error ?? "indisponible"}` : null,
        !google.available ? `Google: ${google.error ?? "indisponible"}` : null,
        google.available && !reviewsUsable ? `Avis: ${reviewsError ?? "indisponibles"}` : null,
        googleTrade?.offTrade
          ? `Fiche Google hors métier : ${googleTrade.tradeReviews}/${googleTrade.textReviews} avis parlent de déménagement (« ${googleTrade.ficheName ?? "sans nom"} »)`
          : `Composants manquants: ${strict.missingComponents.join(", ")}`,
      ]
        .filter(Boolean)
        .join(" | ");

  return {
    algorithmVersion: ALGORITHM_VERSION,
    components: strict.components,
    globalScore: strict.globalScore,
    globalLabel: strict.globalLabel,
    isReliable,
    reliabilityError,
    reliabilityDetails: {
      criticalSources: {
        registry: { ok: pappers.available, error: pappers.error, failure: failures.registry },
        google: { ok: google.available, error: google.error, failure: failures.google },
        reviews: {
          ok: reviewsUsable,
          error: reviewsUsable ? null : (reviewsError ?? "fiche Google indisponible"),
          failure: failures.reviews,
        },
      },
      missingComponents: strict.missingComponents,
      warnings,
      failureKind: classifyUnreliability({
        isReliable,
        sources: [failures.registry, failures.google, failures.reviews],
        // Tout constat de fond interdit de garder l'ancienne note, même si une
        // source est en panne le même jour.
        verdicts: companyVerdictList({
          googleOffTrade: googleTrade?.offTrade === true,
          companyClosed: sireneClosed || (registryHealth != null && (registryHealth.cessee || registryHealth.radiee)),
          collectiveProcedure: registryHealth?.procedureCollectiveEnCours === true,
          transportRegisterZero: sitrVerdict === "zero",
        }),
      }),
    },
    weights: strict.weights,
    reputation,
    vigilance,
    companyHealth: extractCompanyHealth(pappers.raw),
    motif: motifPrincipal(strict.components),
    details: {
      financialFallbackApplied: financial.fallbackApplied,
      googleFallbackApplied: googleForGlobal.fallbackApplied,
      financialOverrideApplied: financial.overrideApplied,
      financialOverrideSupersededByRegistry: overrideSuperseded,
      sitrJuridicalVerdict: sitrVerdict,
      sireneClosed,
      registerCap: {
        capped: registerCap.capped,
        maxScore: REGISTER_ABSENT_MAX_SCORE,
        uncappedScore: registerCap.capped ? uncappedScore : null,
        successors: sitrSuccessors,
      },
      financialAssessment: financialAssessment
        ? { status: financialAssessment.status, latestClosure: financialAssessment.latestClosure }
        : null,
      googleTrade,
      vigilance: {
        method: vigilance.method ?? null,
        fallbackReason: vigilance.fallbackReason ?? null,
        llmFallback: vigilance.llmFallback === true,
      },
    },
  };
}

// ─── Avec les ports ─────────────────────────────────────────────────────────

/** Le motif écrit quand la fiche Google n'est pas encore prouvée comme celle du déménageur. */
export const GOOGLE_NOT_PROVEN_ERROR = "Fiche Google pas encore prouvée comme la sienne : note calculée sans Google";

function unavailableReviews(error: string): ReviewsSnapshot {
  return { available: false, fetchedAt: null, reviews: [], incomplete: false, error };
}

function unavailableGoogle(error: string): GoogleSnapshot {
  return {
    available: false,
    source: "google_places",
    placeId: null,
    rating: null,
    ratingCount: null,
    businessStatus: null,
    reviews: [],
    error,
  };
}

/**
 * Registre et fiche Google en parallèle ; les avis ensuite (ils dépendent de la
 * fiche trouvée). `withoutGoogle` : la fiche n'est pas prouvée, on n'interroge
 * ni Google ni les avis — et la règle stricte refusera la note globale.
 */
export async function scoreMover(
  mover: MoverIdentity,
  providers: ScoringProviders,
  options: { withoutGoogle?: boolean; financialOverride?: FinancialOverrideInput | null; llm?: readonly LlmClient[]; now?: Date } = {},
): Promise<ScoringResult> {
  const [registry, google] = await Promise.all([
    providers.registry.fetchRegistry(mover),
    options.withoutGoogle ? Promise.resolve(unavailableGoogle(GOOGLE_NOT_PROVEN_ERROR)) : providers.places.fetchPlace(mover),
  ]);
  const reviews =
    google.available && google.placeId
      ? await providers.reviews.fetchReviews(google.placeId)
      : unavailableReviews("fiche Google indisponible : collecte des avis impossible");

  return computeScore({
    registry,
    google,
    reviews,
    financialOverride: options.financialOverride,
    llm: options.llm,
    now: options.now,
    mover,
  });
}
