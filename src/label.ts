/**
 * Le label « Excellent » : score fiable ≥ 85, et des conditions qu'aucun score
 * ne rachète. L'ordre des tests est l'ordre des priorités : une exclusion passe
 * avant une donnée manquante, une donnée manquante avant un seuil.
 */

export const LABEL_MIN_SCORE = 85;

export type LabelStatus = "ACTIVE" | "INACTIVE" | "TEMPORARILY_UNAVAILABLE";

export type LabelReason =
  | "eligible"
  | "mover_excluded"
  | "company_not_active"
  | "not_on_transport_register"
  | "score_missing"
  | "score_not_reliable"
  | "email_missing"
  | "score_below_excellent";

function isExcellentLabel(label: string | null) {
  return (label || "").trim().toLowerCase() === "excellent";
}

function scoreIsExcellent(score: number | null, label: string | null) {
  return typeof score === "number" && score >= LABEL_MIN_SCORE && (!label || isExcellentLabel(label));
}

export function evaluateLabelStatus(input: {
  blacklisted: boolean;
  optOut: boolean;
  /**
   * Pas d'Excellent qu'on ne peut pas joindre. Sans adresse mail, le label
   * attend — statut temporaire, pas une perte.
   */
  hasEmail?: boolean;
  /**
   * Un Excellent est au registre des transporteurs. Absent = pas de licence de
   * transport : refusé, quel que soit le score. Indéfini (registre jamais lu) =
   * on ne tranche pas.
   */
  onTransportRegister?: boolean;
  /** Cessée, radiée ou en procédure collective : un score élevé ne rachète pas une société morte. */
  companyFragile?: boolean;
  current: { scoreGlobal: number | null; scoreGlobalLabel: string | null; isReliable: boolean } | null;
}): { status: LabelStatus; eligible: boolean; reason: LabelReason } {
  if (input.blacklisted || input.optOut) return { status: "INACTIVE", eligible: false, reason: "mover_excluded" };
  if (input.companyFragile === true) return { status: "INACTIVE", eligible: false, reason: "company_not_active" };
  if (input.onTransportRegister === false) {
    return { status: "INACTIVE", eligible: false, reason: "not_on_transport_register" };
  }
  if (!input.current) return { status: "TEMPORARILY_UNAVAILABLE", eligible: false, reason: "score_missing" };
  if (!input.current.isReliable) {
    return { status: "TEMPORARILY_UNAVAILABLE", eligible: false, reason: "score_not_reliable" };
  }
  if (input.hasEmail === false) return { status: "TEMPORARILY_UNAVAILABLE", eligible: false, reason: "email_missing" };
  if (!scoreIsExcellent(input.current.scoreGlobal, input.current.scoreGlobalLabel)) {
    return { status: "INACTIVE", eligible: false, reason: "score_below_excellent" };
  }
  return { status: "ACTIVE", eligible: true, reason: "eligible" };
}
