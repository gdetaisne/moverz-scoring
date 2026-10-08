import { LABEL_MIN_SCORE } from "./label.js";

/**
 * Qui entre dans la liste montrée au client. Le client compare jusqu'à 10 devis,
 * prix fermes, et choisit lui-même ; la liste est classée par prix (ou par avis
 * Google), jamais par le score. Le score FILTRE : il ne classe pas.
 *
 * Mécanique interne, pas une promesse : les places sont réparties en deux
 * catégories, 4 « Confirmés » et 6 « Dynamiques ». Une place qu'une catégorie ne
 * remplit pas revient à l'autre.
 *
 * C'est le SEUL endroit qui décide si un déménageur est Confirmé, Dynamique ou
 * absent. Une note non fiable n'entre jamais.
 */

export type MoverListCategory = "confirme" | "dynamique";

export const MOVER_LIST_SLOTS: Record<MoverListCategory, number> = { confirme: 4, dynamique: 6 };

/** Confirmé : note fiable ≥ 85 — le seuil du label Excellent. */
export const MOVER_LIST_CONFIRME_MIN_SCORE = LABEL_MIN_SCORE;

/**
 * Dynamique : note fiable STRICTEMENT supérieure à 75 (76 à 84). C'est la
 * promesse publique : « seuls les déménageurs notés plus de 75/100 vous sont
 * présentés ». Une note de 75 n'entre pas.
 *
 * Avant le 02/10/2026 : de 70 à 84 (règle provisoire du lancement). Le seuil a
 * été relevé pour que la règle du code dise exactement la promesse écrite au
 * client. Le label « Bon » (70 à 84) n'a pas bougé : c'est un autre seuil.
 * Le registre des transporteurs n'entre pas dans ce seuil : il agit déjà sur
 * la note (juridique à 0) et sur le label.
 */
export const MOVER_LIST_DYNAMIQUE_ABOVE_SCORE = 75;

/** Seuil du label « Bon » (70-84), distinct du seuil d'entrée dans la liste. */
export const BON_MIN_SCORE = 70;

function reliableScore(input: { scoreGlobal: number | null | undefined; isReliable: boolean | null | undefined }): number | null {
  if (input.isReliable !== true) return null;
  const score = input.scoreGlobal;
  return typeof score === "number" && Number.isFinite(score) ? score : null;
}

/**
 * `enrolled` : un déménageur inscrit et actif chez Moverz est toujours dans la
 * liste — Confirmé si sa note fiable atteint 85, Dynamique sinon. Sa catégorie
 * ne fait alors que choisir sa place ; elle ne lui donne pas de label.
 */
export function resolveMoverListCategory(input: {
  scoreGlobal: number | null | undefined;
  isReliable: boolean | null | undefined;
  enrolled?: boolean;
}): MoverListCategory | null {
  const score = reliableScore(input);
  if (score !== null && score >= MOVER_LIST_CONFIRME_MIN_SCORE) return "confirme";
  if (input.enrolled === true) return "dynamique";
  if (score !== null && score > MOVER_LIST_DYNAMIQUE_ABOVE_SCORE) return "dynamique";
  return null;
}

/**
 * Le label affiché sur une ligne : seulement pour une note fiable d'au moins
 * 70 — jamais « Correct » ni « Fragile » sous les yeux du client.
 */
export function moverListLabelScore(input: {
  scoreGlobal: number | null | undefined;
  isReliable: boolean | null | undefined;
}): number | null {
  const score = reliableScore(input);
  return score !== null && score >= BON_MIN_SCORE ? score : null;
}

/** « Sous Bon » = pas de note fiable d'au moins 70 : la publication passe sous l'œil de l'équipe. */
export function isUnderBon(input: { scoreGlobal: number | null | undefined; isReliable: boolean | null | undefined }): boolean {
  return moverListLabelScore(input) === null;
}

/**
 * Les exclusions qui passent AVANT la note, pour toute ligne de la liste : une
 * entreprise fermée au répertoire Sirene, cessée, radiée ou en procédure
 * collective n'est jamais proposée, quelle que soit sa note (même critère que
 * le label). Ensuite seulement, il faut une catégorie. (La couverture
 * géographique et l'ordre de service, propres au produit, ne sont pas ici.)
 */
export function moverListExclusionReason(candidate: {
  archived?: boolean;
  blacklisted: boolean;
  companyClosed: boolean;
  companyFragile: boolean;
  scoreGlobal: number | null | undefined;
  isReliable: boolean | null | undefined;
  enrolled?: boolean;
}): "archived" | "blacklisted" | "company-closed" | "company-fragile" | "no-category" | null {
  if (candidate.archived) return "archived";
  if (candidate.blacklisted) return "blacklisted";
  if (candidate.companyClosed) return "company-closed";
  if (candidate.companyFragile) return "company-fragile";
  if (!resolveMoverListCategory(candidate)) return "no-category";
  return null;
}
