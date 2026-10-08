import { LEGACY_DEFAULT_CONFIG } from "./formulas.js";
import type { ScoreAxis } from "./types.js";

/**
 * « Pourquoi ma note est-elle basse ? »
 *
 * Il n'y a pas de réponse unique : cinq composantes tirent ensemble. On retient
 * celle qui coûte le plus de points au total, c'est-à-dire le plus grand
 * `poids × (100 − composante)` — pas la composante la plus basse. Un juridique à
 * 40 coûte 7,5 points (12,5 %) ; une vigilance à 60 en coûte 14 (35 %).
 *
 * C'est une attribution, pas une cause. L'écart avec le deuxième motif dit si
 * elle explique quelque chose : sous 3 points, une seule raison n'explique pas
 * la note, et il faut le dire à l'entreprise qui conteste.
 */

export const MOTIF_LABELS: Record<ScoreAxis, string> = {
  financial: "santé financière",
  juridical: "situation juridique",
  google: "note et volume Google",
  reputation: "profil des avis",
  vigilance: "incidents signalés dans les avis",
};

const WEIGHTS: Record<ScoreAxis, number> = {
  financial: LEGACY_DEFAULT_CONFIG.weightFinancier,
  juridical: LEGACY_DEFAULT_CONFIG.weightJuridique,
  google: LEGACY_DEFAULT_CONFIG.weightGoogle,
  reputation: LEGACY_DEFAULT_CONFIG.weightReputation,
  vigilance: LEGACY_DEFAULT_CONFIG.weightVigilance,
};

export type Components = Partial<Record<ScoreAxis, number | null>>;

export type Motif = { axis: ScoreAxis | null; motif: string; perte: number; ecartSecond: number };

/** Une composante absente n'est pas un zéro : sinon toute donnée manquante deviendrait le motif. */
export function motifPrincipal(c: Components): Motif {
  const pertes = (Object.keys(WEIGHTS) as ScoreAxis[])
    .filter((k) => typeof c[k] === "number")
    .map((k) => ({ k, perte: WEIGHTS[k] * (100 - (c[k] as number)) }))
    .sort((a, b) => b.perte - a.perte);
  if (!pertes.length) return { axis: null, motif: "", perte: 0, ecartSecond: 0 };
  const [premier, second] = pertes;
  return {
    axis: premier.k,
    motif: MOTIF_LABELS[premier.k],
    perte: Math.round(premier.perte * 10) / 10,
    ecartSecond: second ? Math.round((premier.perte - second.perte) * 10) / 10 : premier.perte,
  };
}
