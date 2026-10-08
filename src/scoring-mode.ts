/**
 * Avec ou sans Google : la réputation Google ne compte que si la fiche est
 * PROUVÉE comme celle du déménageur — il l'a confirmée lui-même, ou le
 * rattachement automatique l'a reconnue (même nom, adresse, téléphone ou site
 * que le registre). Sinon la note se calcule sans Google : ni la fiche
 * rattachée par nous, ni une recherche par le nom. Jamais la réputation d'un
 * autre.
 *
 * Sans Google, la politique stricte (`compute.ts`) ne donne PAS de note
 * globale : Google est une source exigée. Restent les sous-scores financier et
 * juridique, et la note est « non fiable ».
 */

/** La réponse du déménageur sur sa fiche Google. */
export const GOOGLE_FICHE_CONFIRMED = "CONFIRMED";
export const GOOGLE_FICHE_NONE = "NONE";

export type ScoringGoogleMode = "with_google" | "without_google";

export function scoringGoogleMode(input: {
  /** Le rattachement automatique a reconnu la fiche Google. */
  identityMatched: boolean | null | undefined;
  /** `CONFIRMED`, `NONE`, `DISPUTED` ou nul. */
  googlePlaceConfirmation: string | null | undefined;
}): ScoringGoogleMode {
  if (input.googlePlaceConfirmation === GOOGLE_FICHE_CONFIRMED) return "with_google";
  if (input.googlePlaceConfirmation === GOOGLE_FICHE_NONE) return "without_google";
  return input.identityMatched === true ? "with_google" : "without_google";
}

export type InscriptionScoringPlan = { launch: true; withoutGoogle: boolean } | { launch: false; reason: "note_gardee" };

/**
 * À la création d'un dossier, la note part toujours, sauf dans un cas : fiche
 * Google non prouvée ET une note déjà en base. Celle-là est gardée (dans le
 * doute, on garde) plutôt que remplacée par une note sans Google, moins
 * complète ; quand il confirmera sa fiche, la note sera relancée avec elle.
 */
export function planInscriptionScoring(input: {
  identityMatched: boolean | null | undefined;
  googlePlaceConfirmation: string | null | undefined;
  hasScore: boolean;
}): InscriptionScoringPlan {
  const mode = scoringGoogleMode(input);
  if (mode === "with_google") return { launch: true, withoutGoogle: false };
  if (input.hasScore) return { launch: false, reason: "note_gardee" };
  return { launch: true, withoutGoogle: true };
}

/**
 * Un dossier déjà ouvert dont la note n'a JAMAIS été lancée : elle part au
 * passage. Un calcul tombé en échec, lui, ne repart pas tout seul à chaque
 * visite : c'est un geste explicite de l'équipe.
 */
export function shouldLaunchMissingScore(input: { hasScore: boolean; lastScoringStatus: string | null | undefined }): boolean {
  return !input.hasScore && input.lastScoringStatus === "NEVER";
}
