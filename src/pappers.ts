import { computeLegacyFinancialScore, computeLegacyJuridicalScore } from "./formulas.js";
import type { PappersErrorKind, PappersFinancialSource, PappersSnapshot } from "./types.js";

/**
 * Lecture de la réponse Pappers (API v2, `/entreprise`) — sans l'appel HTTP.
 *
 * Ce qui est appelé en production : `GET /v2/entreprise?siren=…&champs_supplementaires=decisions`.
 * Pappers facture chaque champ supplémentaire : un appel à 8 champs coûte ~11
 * crédits contre ~3 pour le seul champ dont le score a besoin. `decisions`
 * alimente le juridique et n'existe qu'en supplément ; tout le reste (finances,
 * statut RCS, entreprise cessée, procédures collectives, publications BODACC)
 * arrive dans la réponse de base.
 */

/**
 * Paramètre d'identification à envoyer. Un SIRET compte 14 chiffres : une valeur
 * de 9 chiffres saisie dans le champ SIRET est un SIREN, et Pappers refuse
 * `siret=<9 chiffres>` en HTTP 400 (constaté sur une poignée de fiches réelles).
 * Une valeur ni à 14 ni à 9 chiffres est ignorée au profit du SIREN.
 */
export function pappersLookupParam(input: {
  siret: string | null | undefined;
  siren: string | null | undefined;
}): { param: "siret" | "siren"; value: string } | null {
  const siret = (input.siret ?? "").replace(/\D+/g, "");
  const siren = (input.siren ?? "").replace(/\D+/g, "");
  if (siret.length === 14) return { param: "siret", value: siret };
  if (siren.length === 9) return { param: "siren", value: siren };
  if (siret.length === 9) return { param: "siren", value: siret };
  return null;
}

/** Le scoring financier natif de Pappers est sur 20 : ramené sur 100. */
export function mapNativeFinancialScore(score20: number | null): number | null {
  if (score20 == null || Number.isNaN(score20)) return null;
  return Math.max(0, Math.min(100, Math.round(score20 * 5)));
}

/**
 * Les décisions de justice, plus une décision synthétique « procédure collective
 * en cours » quand Pappers en signale une : une procédure ouverte cette année n'a
 * pas toujours encore de décision publiée, elle doit peser quand même (malus
 * d'une décision récente, −25). L'exclusion franche de ces entreprises ne passe
 * pas par la note mais par `company-health.ts` (label et liste).
 */
export function buildPappersDecisions(raw: Record<string, unknown>, now: Date = new Date()) {
  const decisions = Array.isArray(raw.decisions) ? (raw.decisions as Array<Record<string, unknown>>).slice() : [];
  if (raw.procedure_collective_en_cours === true) {
    const procedures = Array.isArray(raw.procedures_collectives)
      ? (raw.procedures_collectives as Array<Record<string, unknown>>)
      : [];
    decisions.unshift({
      juridiction: "Tribunal de commerce",
      dispositif: "Procédure collective en cours",
      date: procedures[0] && typeof procedures[0].date_debut === "string" ? procedures[0].date_debut : now.toISOString(),
    });
  }
  return decisions;
}

export function emptyPappersSnapshot(
  overrides: Partial<PappersSnapshot> & { error: string; errorKind: PappersErrorKind },
): PappersSnapshot {
  return {
    available: false,
    companyFound: false,
    source: "pappers",
    fetchedAt: null,
    financialScore: null,
    financialSource: null,
    juridicalScore: null,
    decisions: [],
    finances: [],
    raw: null,
    httpStatus: null,
    ...overrides,
  };
}

/**
 * Réponse brute → instantané. Financier : le scoring natif s'il existe, sinon
 * notre formule sur les bilans, sinon `null` (le score global appliquera alors
 * l'exception « pas de bilan publié » = 50, puisque le registre a répondu).
 */
export function buildPappersSnapshot(
  raw: Record<string, unknown>,
  options: { httpStatus?: number; now?: Date } = {},
): PappersSnapshot {
  const now = options.now ?? new Date();
  const finances = Array.isArray(raw.finances) ? (raw.finances as Array<Record<string, unknown>>) : [];
  const decisions = buildPappersDecisions(raw, now);

  const native =
    raw.scoring_financier && typeof raw.scoring_financier === "object"
      ? (raw.scoring_financier as Record<string, unknown>).score
      : null;
  const nativeFin = mapNativeFinancialScore(typeof native === "number" ? native : null);

  let financialScore: number | null = null;
  let financialSource: PappersFinancialSource | null = null;
  if (nativeFin != null) {
    financialScore = nativeFin;
    financialSource = "pappers_native";
  } else {
    const heuristic = computeLegacyFinancialScore(finances);
    if (heuristic != null) {
      financialScore = heuristic;
      financialSource = "pappers_heuristic";
    }
  }

  return {
    available: true,
    companyFound: true,
    source: "pappers",
    fetchedAt: now.toISOString(),
    financialScore,
    financialSource,
    juridicalScore: computeLegacyJuridicalScore(decisions, undefined, now),
    decisions,
    finances,
    raw,
    error: null,
    errorKind: null,
    httpStatus: options.httpStatus ?? 200,
  };
}
