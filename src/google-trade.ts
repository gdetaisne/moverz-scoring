import type { GoogleReview } from "./types.js";

/**
 * La fiche Google rattachée est-elle celle d'un déménageur ? (règle ajoutée le 08/10/2026)
 *
 * Deux chemins pouvaient rattacher à un déménageur la fiche Google d'un autre métier, qui
 * était ensuite notée comme la sienne :
 *  - l'adresse partagée : une paroisse installée à la même adresse que l'entreprise ;
 *  - la confirmation par le déménageur lui-même, qui avait désigné la fiche d'un promoteur
 *    immobilier.
 * Ni la preuve par l'adresse ni la confirmation ne disent quel MÉTIER la fiche décrit ; ses
 * avis, si.
 *
 * Règle : parmi les avis qui ont un vrai texte (plus de 30 caractères), la part qui parle du
 * métier (déménagement, cartons, camion, meubles, garde-meuble, débarras…). Sur au moins
 * 5 avis à texte, la fiche est « hors métier » — et la note n'est pas fiable — sous 10 %, ou
 * sous 20 % quand le NOM de la fiche ne dit rien du métier.
 *
 * Seuils mesurés le 08/10/2026 sur les 1 259 notes fiables de la production : un seuil unique
 * ne sépare pas (la paroisse était à 11 %, un vrai déménageur à 14 %) ; le nom de la fiche,
 * si. Le vocabulaire est volontairement large : garde-meubles, débarras et box restent dans
 * le métier — les garder ou non dans la liste est une question de positionnement, pas de
 * rattachement.
 */
export const TRADE_MIN_TEXT_REVIEWS = 5;
export const TRADE_MIN_RATIO = 0.1;
/** Seuil relevé quand le nom de la fiche ne contient aucun mot du métier. */
export const TRADE_MIN_RATIO_UNNAMED = 0.2;
const MIN_TEXT_LENGTH = 30;

// Racines repliées (minuscules, sans accents), cherchées en début de mot : « meuble »
// trouve « meubles » et « garde-meuble », jamais « immeuble ».
const TRADE_STEMS = [
  "demenag", "emmenag", "carton", "camion", "meuble", "monte-meuble", "piano", "debarras",
  "garde-meuble", "stockage", "entrepos", "emballe", "emballage", "manutention", "frigo",
  "lave-linge", "canape", "armoire", "commode", "mover", "moving", "removal",
];
const TRADE_PATTERN = new RegExp(`(?<![\\p{L}\\p{N}])(?:${TRADE_STEMS.join("|")})`, "u");

// Ce que le NOM d'une fiche de déménageur contient presque toujours. Pas « transport » ni
// « transfert » : une société de navettes de passagers et de bagages n'est pas un déménageur.
const TRADE_NAME_STEMS = [
  "demenag", "demeco", "monte-meuble", "monte meuble", "garde-meuble", "garde meuble", "debarras",
  "box", "stockage", "mover", "moving", "removal", "relocation",
];
const TRADE_NAME_PATTERN = new RegExp(`(?<![\\p{L}\\p{N}])(?:${TRADE_NAME_STEMS.join("|")})`, "u");

function foldText(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function reviewMentionsTrade(text: string): boolean {
  return TRADE_PATTERN.test(foldText(text));
}

export function ficheNameMentionsTrade(name: string | null | undefined): boolean {
  return typeof name === "string" && TRADE_NAME_PATTERN.test(foldText(name));
}

export interface GoogleTradeVerdict {
  textReviews: number;
  tradeReviews: number;
  ratio: number | null;
  ficheName: string | null;
  ficheNameMentionsTrade: boolean;
  /** Vrai seulement sur un échantillon suffisant : sans avis à lire, on ne tranche pas. */
  offTrade: boolean;
}

/**
 * Jugé sur TOUS les avis lus (24 mois), pas sur la fenêtre de la réputation : le métier d'une
 * fiche ne dépend pas de la récence de ses avis, et une fenêtre de 12 mois trop maigre
 * condamnait de vrais déménageurs (simulation du 08/10/2026).
 */
export function assessGoogleTrade(reviews: GoogleReview[], ficheName: string | null): GoogleTradeVerdict {
  const texts = reviews.map((review) => review.text?.trim() ?? "").filter((text) => text.length > MIN_TEXT_LENGTH);
  const tradeReviews = texts.filter(reviewMentionsTrade).length;
  const ratio = texts.length > 0 ? tradeReviews / texts.length : null;
  const named = ficheNameMentionsTrade(ficheName);
  const threshold = named ? TRADE_MIN_RATIO : TRADE_MIN_RATIO_UNNAMED;
  return {
    textReviews: texts.length,
    tradeReviews,
    ratio: ratio == null ? null : Math.round(ratio * 100) / 100,
    ficheName,
    ficheNameMentionsTrade: named,
    offTrade: texts.length >= TRADE_MIN_TEXT_REVIEWS && ratio != null && ratio < threshold,
  };
}

/** Le nom de la fiche tel que Google Places le rend (`details.displayName.text`). */
export function readGoogleFicheName(raw: unknown): string | null {
  const details = (raw as { details?: { displayName?: { text?: unknown } } } | null)?.details;
  const text = details?.displayName?.text;
  return typeof text === "string" && text.trim() ? text.trim() : null;
}
