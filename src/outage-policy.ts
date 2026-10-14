/**
 * MVZ-2230 (décision de Guillaume, 14/10/2026) — **une panne n'efface plus une
 * bonne note.**
 *
 * Avant : un calcul dont une source critique (Pappers, Google, lecture des avis)
 * était en panne écrasait la note courante par « pas de note » : le déménageur
 * sortait de l'annuaire et de la liste, son Label passait « temporairement
 * indisponible », et rien ne relançait le calcul.
 *
 * Désormais, deux familles d'échec :
 *  - la **panne technique** (réseau, HTTP, quota, délai dépassé, clé absente,
 *    lecture d'avis coupée) ne dit rien de l'entreprise. Si la note courante est
 *    fiable et a moins de 90 jours, elle est **conservée** ; l'échec est tracé dans
 *    l'historique et le calcul est relancé environ 24 h plus tard, trois fois au
 *    plus de suite, puis la note reste et l'équipe est alertée. Sans note fiable
 *    récente à garder, la note est remplacée mais le calcul est relancé de même.
 *    Après trois relances sans succès, le planificateur trimestriel attend 90 jours
 *    depuis la dernière tentative ;
 *  - le **verdict de fond** (entreprise introuvable, fiche Google non prouvée,
 *    absente, sans correspondance ou hors métier…) remplace la note comme avant.
 *
 * Fonctions pures : testées dans `test/outage-policy.test.ts`. La persistance (note
 * conservée, ligne d'historique, relance programmée) vit dans le produit ; elle
 * est décrite dans docs/architecture.md.
 */
import { isInfrastructureFailure } from "./pappers-cache.js";
import type { PappersSnapshot, SourceFailureKind } from "./types.js";

/**
 * Une note fiable plus vieille que cela n'est plus conservée face à une panne.
 * 120 jours = le cycle de recalcul de 90 jours, plus 30 jours de relances : le
 * recalcul trimestriel d'une note de 90 jours peut encore la garder.
 */
export const KEPT_SCORE_MAX_AGE_DAYS = 120;
/** Délai avant la relance d'un calcul tombé en panne. */
export const OUTAGE_RETRY_DELAY_MS = 24 * 60 * 60 * 1000;
/** Relances consécutives au plus ; au-delà, la note reste et l'équipe est alertée. */
export const OUTAGE_MAX_CONSECUTIVE_RETRIES = 3;

export const SEARCHAPI_INCOMPLETE_ERROR =
  "Lecture des avis amputée (pagination SearchAPI perdue) : panne, pas une note";
export const SEARCHAPI_NEEDS_PLACE_ERROR = "placeId indisponible (Google Places prérequis pour SearchAPI)";

/**
 * Pappers : panne si l'appel n'a pas abouti (réseau, délai, HTTP 429/5xx/401/403,
 * clé absente). Un HTTP 400 (demande refusée) ou une réponse JSON illisible sont
 * des erreurs définitives : relancer ne changerait rien, ce n'est pas une panne.
 */
export function pappersFailure(
  pappers: Pick<PappersSnapshot, "available" | "errorKind"> & Partial<Pick<PappersSnapshot, "httpStatus" | "error">>,
): SourceFailureKind | null {
  if (pappers.available) return null;
  if (pappers.errorKind === "http_error" && (pappers.httpStatus === 400 || /JSON invalide/i.test(pappers.error ?? ""))) {
    return "verdict";
  }
  return isInfrastructureFailure(pappers as PappersSnapshot) ? "outage" : "verdict";
}

/**
 * Constats de fond qui ne dépendent pas d'une source en panne : ils interdisent
 * de garder l'ancienne note, même si Google ou les avis sont en panne le même jour.
 */
export type CompanyVerdicts = {
  /** Fiche Google hors métier. */
  googleOffTrade: boolean;
  /** Entreprise fermée (état administratif Sirene, ou cessée / radiée selon Pappers). */
  companyClosed: boolean;
  /** Procédure collective en cours, annoncée par Pappers. */
  collectiveProcedure: boolean;
  /** Absente du registre des transporteurs (juridique à 0). */
  transportRegisterZero: boolean;
};

export function companyVerdictList(verdicts: CompanyVerdicts): boolean[] {
  return [verdicts.googleOffTrade, verdicts.companyClosed, verdicts.collectiveProcedure, verdicts.transportRegisterZero];
}

/**
 * Google Places : les constats de fond sont connus (fiche non prouvée, absente
 * selon le déménageur, recherche sans résultat ou sans correspondance, fiche
 * inexistante — HTTP 404). Tout le reste (HTTP 400 — Google le rend aussi pour
 * une clé invalide —, 401/403/429/5xx, erreur réseau, délai, clé absente) est une
 * panne.
 */
const GOOGLE_VERDICT_PATTERNS: RegExp[] = [
  /pas encore prouvée/i,
  /pas de fiche google/i,
  /aucun place/i,
  /recherche trop courte/i,
  /query google places vide/i,
  /HTTP 404\b/,
];

export function googleFailure(google: { available: boolean; error: string | null }): SourceFailureKind | null {
  if (google.available) return null;
  const error = google.error ?? "";
  return GOOGLE_VERDICT_PATTERNS.some((pattern) => pattern.test(error)) ? "verdict" : "outage";
}

/**
 * Lecture des avis (SearchAPI) : toute indisponibilité est une panne (HTTP,
 * quota, réseau, délai, lecture amputée), sauf quand elle découle de l'absence
 * de fiche Google — c'est alors Google qui porte la cause.
 */
export function searchApiFailure(searchapi: { available: boolean; error: string | null }): SourceFailureKind | null {
  if (searchapi.available) return null;
  if ((searchapi.error ?? "").startsWith("placeId indisponible")) return null;
  return "outage";
}

/**
 * Nature de l'échec d'une note non fiable : `outage` seulement si au moins une
 * source est en panne ET qu'aucun constat de fond n'est en cause. Un verdict
 * (source au verdict de fond, fiche hors métier, ou composante manquante sans
 * source en panne) l'emporte toujours.
 */
export function classifyUnreliability(input: {
  isReliable: boolean;
  sources: Array<SourceFailureKind | null>;
  /** Constats de fond indépendants des sources (fiche Google hors métier…). */
  verdicts: boolean[];
}): SourceFailureKind | null {
  if (input.isReliable) return null;
  if (input.verdicts.some(Boolean)) return "verdict";
  if (input.sources.includes("verdict")) return "verdict";
  if (input.sources.includes("outage")) return "outage";
  return "verdict";
}

export type CurrentScoreForPolicy = {
  scoreGlobal: number | null;
  isReliable: boolean;
  computedAt: Date;
  /** Composantes de la note gardée (absentes : pas de comparaison). */
  scoreFinancial?: number | null;
  scoreJuridical?: number | null;
} | null;

/** Composantes fraîchement obtenues par le calcul en panne (registre, Pappers). */
export type FreshComponents = { financial: number | null; juridical: number | null };

/**
 * Vrai si une composante fraîche est pire que celle de la note gardée : la
 * situation de l'entreprise s'est dégradée, la note ne peut pas être gardée.
 */
export function freshComponentsWorse(current: CurrentScoreForPolicy, fresh: FreshComponents | undefined): boolean {
  if (!current || !fresh) return false;
  const worse = (now: number | null, kept: number | null | undefined) => now != null && kept != null && now < kept;
  return worse(fresh.financial, current.scoreFinancial) || worse(fresh.juridical, current.scoreJuridical);
}

/** Relance programmée après une panne (null quand les relances sont épuisées). */
export type OutageRetry = {
  /** Numéro de cette relance (1 à 3), ou null quand les relances sont épuisées. */
  retryNumber: number | null;
  retryAt: Date | null;
  exhausted: boolean;
};

export type OutageDecision =
  | { action: "replace"; reason: "reliable" | "verdict" }
  /**
   * Panne sans note fiable récente à garder, ou composantes fraîches pires que
   * celles de la note gardée : la note est remplacée, mais le calcul est relancé.
   */
  | ({ action: "replace"; reason: "no_kept_score" | "fresh_components_worse" } & OutageRetry)
  | ({ action: "keep" } & OutageRetry);

export function keptScoreStillValid(current: CurrentScoreForPolicy, now: Date): boolean {
  if (!current || !current.isReliable || current.scoreGlobal == null) return false;
  const ageMs = now.getTime() - current.computedAt.getTime();
  return ageMs < KEPT_SCORE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
}

/** Relance suivante, ou épuisement après `OUTAGE_MAX_CONSECUTIVE_RETRIES` pannes d'affilée. */
export function nextOutageRetry(consecutiveOutages: number, now: Date): OutageRetry {
  if (consecutiveOutages >= OUTAGE_MAX_CONSECUTIVE_RETRIES) {
    return { retryNumber: null, retryAt: null, exhausted: true };
  }
  return {
    retryNumber: consecutiveOutages + 1,
    retryAt: new Date(now.getTime() + OUTAGE_RETRY_DELAY_MS),
    exhausted: false,
  };
}

/**
 * Ce que devient la note courante après un calcul.
 *
 * `consecutiveOutages` : nombre de calculs immédiatement précédents (historique,
 * du plus récent au plus ancien) tombés en panne — note conservée ou non. Même
 * compteur pour les deux cas : 3 relances d'affilée au plus, puis alerte.
 */
export function decideOutageHandling(input: {
  isReliable: boolean;
  failureKind: SourceFailureKind | null | undefined;
  current: CurrentScoreForPolicy;
  consecutiveOutages: number;
  now: Date;
  fresh?: FreshComponents;
}): OutageDecision {
  if (input.isReliable) return { action: "replace", reason: "reliable" };
  if (input.failureKind !== "outage") return { action: "replace", reason: "verdict" };
  const retry = nextOutageRetry(input.consecutiveOutages, input.now);
  if (!keptScoreStillValid(input.current, input.now)) return { action: "replace", reason: "no_kept_score", ...retry };
  if (freshComponentsWorse(input.current, input.fresh)) return { action: "replace", reason: "fresh_components_worse", ...retry };
  return { action: "keep", ...retry };
}

/**
 * Compte, du plus récent au plus ancien, les calculs d'affilée tombés en panne
 * (`details.outageKept` : note conservée ; `details.outageRetry` : note remplacée
 * mais calcul relancé). Le premier calcul normal arrête le compte.
 */
export function countConsecutiveOutages(history: Array<{ details: unknown }>): number {
  let count = 0;
  for (const row of history) {
    const details = row.details as { outageKept?: unknown; outageRetry?: unknown } | null;
    const marked = [details?.outageKept, details?.outageRetry].some((value) => value && typeof value === "object");
    if (!marked) break;
    count += 1;
  }
  return count;
}

/**
 * Après 3 relances d'affilée sans succès, le planificateur trimestriel laisse le
 * déménageur jusqu'au cycle suivant : 90 jours comptés depuis la dernière
 * tentative. Une demande manuelle passe toujours.
 */
export const OUTAGE_EXHAUSTED_COOLDOWN_DAYS = 90;
