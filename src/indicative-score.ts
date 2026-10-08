import { LEGACY_DEFAULT_CONFIG } from "./formulas.js";
import type { ScoreAxis } from "./types.js";

/**
 * La note INDICATIVE d'une entreprise inconnue (analyse d'un devis reçu
 * ailleurs) — à ne pas confondre avec le score Moverz.
 *
 * Mêmes formules, mêmes poids. Mais on ne passe pas par `buildStrictGlobalScore` :
 * pour un déménageur que nous n'avons jamais noté, réputation et vigilance
 * n'existent pas encore. On renormalise donc sur les axes disponibles (la somme
 * de leurs poids redevient 1), on exige au moins deux axes, et le libellé dit
 * exactement sur quoi la note repose. Jamais « note Moverz » sous les yeux du
 * client : c'est une indication, pas le score.
 */

export const MIN_SCORE_AXES = 2;

/**
 * Entreprise cessée, radiée ou en procédure collective en cours : note
 * plafonnée à 49, sous la bande « Correct » (50). Elle ne doit pas ressortir
 * correcte grâce à de bons avis Google.
 */
export const FRAGILE_COMPANY_SCORE_CAP = 49;

const AXES: Array<{ key: ScoreAxis; label: string; weight: number }> = [
  { key: "financial", label: "Santé financière", weight: LEGACY_DEFAULT_CONFIG.weightFinancier },
  { key: "juridical", label: "Situation juridique", weight: LEGACY_DEFAULT_CONFIG.weightJuridique },
  { key: "google", label: "Avis Google", weight: LEGACY_DEFAULT_CONFIG.weightGoogle },
  { key: "reputation", label: "Réputation (analyse des avis)", weight: LEGACY_DEFAULT_CONFIG.weightReputation },
  { key: "vigilance", label: "Vigilance (analyse des avis)", weight: LEGACY_DEFAULT_CONFIG.weightVigilance },
];

export type ScoreInputs = Record<ScoreAxis, number | null>;

export type IndicativeScore = {
  value: number | null;
  label: string | null;
  axes: Array<{ key: ScoreAxis; label: string; value: number }>;
};

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function computeIndicativeScore(inputs: ScoreInputs, options: { fragile?: boolean } = {}): IndicativeScore {
  const available = AXES.flatMap((axis) => {
    const raw = inputs[axis.key];
    return raw == null || !Number.isFinite(raw) ? [] : [{ ...axis, value: clamp(raw) }];
  });
  const axes = available.map(({ key, label, value }) => ({ key, label, value }));

  if (available.length < MIN_SCORE_AXES) return { value: null, label: null, axes };

  const totalWeight = available.reduce((sum, axis) => sum + axis.weight, 0);
  const weighted = available.reduce((sum, axis) => sum + axis.value * axis.weight, 0) / totalWeight;
  let value = clamp(weighted);
  if (options.fragile) value = Math.min(value, FRAGILE_COMPANY_SCORE_CAP);

  const criteria = available.map((axis) => `${axis.label.charAt(0).toLowerCase()}${axis.label.slice(1)}`).join(", ");
  return { value, label: `Note indicative sur 100, d'après les données publiques disponibles (${criteria})`, axes };
}
