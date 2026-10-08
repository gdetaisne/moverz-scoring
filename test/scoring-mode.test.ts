import assert from "node:assert/strict";
import test from "node:test";

import { planInscriptionScoring, scoringGoogleMode, shouldLaunchMissingScore } from "../src/scoring-mode.js";

test("sa fiche confirmée par lui : la note compte Google, quel que soit le rattachement du dépôt", () => {
  assert.equal(scoringGoogleMode({ identityMatched: false, googlePlaceConfirmation: "CONFIRMED" }), "with_google");
  assert.equal(scoringGoogleMode({ identityMatched: null, googlePlaceConfirmation: "CONFIRMED" }), "with_google");
});

test("fiche reconnue par le rattachement du dépôt : avec Google", () => {
  assert.equal(scoringGoogleMode({ identityMatched: true, googlePlaceConfirmation: null }), "with_google");
});

test("fiche non prouvée, constat absent, litige ou « pas de fiche » : sans Google", () => {
  assert.equal(scoringGoogleMode({ identityMatched: false, googlePlaceConfirmation: null }), "without_google");
  assert.equal(scoringGoogleMode({ identityMatched: undefined, googlePlaceConfirmation: undefined }), "without_google");
  assert.equal(scoringGoogleMode({ identityMatched: false, googlePlaceConfirmation: "DISPUTED" }), "without_google");
  assert.equal(scoringGoogleMode({ identityMatched: true, googlePlaceConfirmation: "NONE" }), "without_google");
});

test("création d'un dossier : la note part toujours, sans Google si la fiche n'est pas prouvée", () => {
  assert.deepEqual(
    planInscriptionScoring({ identityMatched: true, googlePlaceConfirmation: null, hasScore: false }),
    { launch: true, withoutGoogle: false }
  );
  assert.deepEqual(
    planInscriptionScoring({ identityMatched: true, googlePlaceConfirmation: null, hasScore: true }),
    { launch: true, withoutGoogle: false },
    "fiche prouvée : la note est recalculée, comme avant"
  );
  assert.deepEqual(
    planInscriptionScoring({ identityMatched: false, googlePlaceConfirmation: null, hasScore: false }),
    { launch: true, withoutGoogle: true }
  );
});

test("fiche non prouvée et note déjà en base : la note est gardée, pas remplacée par une note sans Google", () => {
  assert.deepEqual(
    planInscriptionScoring({ identityMatched: false, googlePlaceConfirmation: null, hasScore: true }),
    { launch: false, reason: "note_gardee" }
  );
});

test("dossier déjà ouvert : la note part seulement si aucun calcul n'a jamais été lancé", () => {
  assert.equal(shouldLaunchMissingScore({ hasScore: false, lastScoringStatus: "NEVER" }), true);
  assert.equal(shouldLaunchMissingScore({ hasScore: true, lastScoringStatus: "NEVER" }), false);
  assert.equal(
    shouldLaunchMissingScore({ hasScore: false, lastScoringStatus: "FAILED" }),
    false,
    "un échec ne repart pas à chaque visite : c'est un geste explicite de l'équipe"
  );
  assert.equal(shouldLaunchMissingScore({ hasScore: false, lastScoringStatus: "PENDING" }), false);
  assert.equal(shouldLaunchMissingScore({ hasScore: false, lastScoringStatus: undefined }), false);
});
