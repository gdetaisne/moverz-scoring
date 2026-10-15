/**
 * Types du moteur de score. Aucune dépendance à une base de données : le
 * déménageur est décrit par le strict minimum dont le calcul a besoin.
 */

/** Le déménageur tel que le moteur le voit (dans le produit, une ligne de base bien plus large). */
export interface MoverIdentity {
  id: string;
  companyName: string;
  siren: string | null;
  siret: string | null;
  city: string | null;
  postalCode: string | null;
  /** Fiche Google déjà rattachée (évite une recherche par le nom à chaque calcul). */
  googlePlaceId: string | null;
}

export type ScoreAxis = "financial" | "juridical" | "google" | "reputation" | "vigilance";

export interface ScoringComponentScores {
  financial: number | null;
  juridical: number | null;
  google: number | null;
  reputation: number | null;
  vigilance: number | null;
}

// ─── Registre des entreprises (Pappers API v2) ─────────────────────────────

export type PappersErrorKind =
  | "missing_key"
  | "missing_identifier"
  | "not_found"
  | "http_error"
  | "network"
  | "timeout";

/** `pappers_native` : scoring financier fourni par Pappers ; `pappers_heuristic` : notre formule sur les bilans. */
export type PappersFinancialSource = "pappers_native" | "pappers_heuristic";

export interface PappersSnapshot {
  available: boolean;
  companyFound: boolean;
  source: "pappers";
  /** Date de l'appel payé (sert au cache de 120 jours). */
  fetchedAt: string | null;
  financialScore: number | null;
  financialSource: PappersFinancialSource | null;
  juridicalScore: number | null;
  decisions: Array<Record<string, unknown>>;
  finances: Array<Record<string, unknown>>;
  raw: unknown;
  error: string | null;
  errorKind: PappersErrorKind | null;
  httpStatus: number | null;
}

// ─── Google ─────────────────────────────────────────────────────────────────

export interface GoogleReview {
  author: string;
  rating: number | null;
  text: string;
  relativeTime: string;
  isoDate?: string;
  suspicious?: boolean;
}

export interface GoogleSnapshot {
  available: boolean;
  source: "google_places";
  placeId: string | null;
  /** Nom affiché de la fiche (Google Places `displayName.text`) : sert à juger son métier. */
  name?: string | null;
  rating: number | null;
  ratingCount: number | null;
  businessStatus: string | null;
  reviews: GoogleReview[];
  error: string | null;
}

/** La collecte paginée des avis (Google Places n'en rend que 5 : insuffisant). */
export interface ReviewsSnapshot {
  available: boolean;
  fetchedAt: string | null;
  reviews: GoogleReview[];
  /** Lecture amputée par le fournisseur (page pleine sans suite) : avis manquants probables. */
  incomplete: boolean;
  error: string | null;
}

// ─── Axes dérivés des avis ──────────────────────────────────────────────────

export interface ReputationSnapshot {
  source: "reviews_pattern";
  negativeMentions: number;
  reputationScore: number | null;
  authenticCount: number;
  suspiciousCount: number;
  negativeRatio: number;
  positiveCount?: number;
  explanation: string;
  /** Fenêtre réellement utilisée : 12 mois, ou 24 si moins de 12 avis récents. */
  windowMonths?: 12 | 24;
  reviewsCount12m?: number;
  reviewsCount24m?: number;
}

export interface VigilanceCategoryResult {
  id: string;
  label: string;
  weight: number;
  reviewCount: number;
  ratio: number;
  score: number;
  status: "ok" | "warning" | "alert";
  evidence: string[];
}

export interface VigilanceSnapshot {
  source: "vigilance_categories";
  vigilanceScore: number | null;
  categories: VigilanceCategoryResult[];
  totalAuthenticReviews: number;
  /** `llm` si la classification d'un modèle a remplacé l'heuristique par mots-clés. */
  method?: "keywords" | "llm";
  /**
   * Pourquoi les mots-clés ont servi alors qu'un modèle pouvait être appelé :
   * `llm_failed: …` (modèle en échec, délai dépassé, réponse illisible) ou
   * `no_llm_configured`. Null sinon (depuis le 14/10/2026).
   */
  fallbackReason?: string | null;
  /** Vrai quand un modèle fourni a échoué et que les mots-clés l'ont remplacé. */
  llmFallback?: boolean;
  /** Aucun avis retenu : vigilance neutre 50 (depuis le 14/10/2026 ; 100 avant). */
  noReviews?: boolean;
  windowMonths?: 12 | 24;
  reviewsCount12m?: number;
  reviewsCount24m?: number;
}

// ─── Résultat ───────────────────────────────────────────────────────────────

/**
 * Pourquoi une source critique manque (depuis le 14/10/2026) : `outage` = panne
 * technique (réseau, HTTP, quota, délai, clé absente, lecture d'avis amputée),
 * qui ne dit rien de l'entreprise ; `verdict` = constat de fond (entreprise
 * introuvable, fiche Google non prouvée, absente, sans correspondance, hors métier).
 */
export type SourceFailureKind = "outage" | "verdict";

export interface CriticalSourceStatus {
  ok: boolean;
  error: string | null;
  failure?: SourceFailureKind | null;
}

export interface ReliabilityDetails {
  criticalSources: {
    registry: CriticalSourceStatus;
    google: CriticalSourceStatus;
    reviews: CriticalSourceStatus;
  };
  missingComponents: ScoreAxis[];
  warnings: string[];
  /** Nature de l'échec d'une note non fiable (`src/outage-policy.ts`) ; null pour une note fiable. */
  failureKind?: SourceFailureKind | null;
}
