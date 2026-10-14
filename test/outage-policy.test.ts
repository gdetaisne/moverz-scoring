import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyUnreliability,
  companyVerdictList,
  countConsecutiveOutages,
  freshComponentsWorse,
  decideOutageHandling,
  googleFailure,
  KEPT_SCORE_MAX_AGE_DAYS,
  OUTAGE_MAX_CONSECUTIVE_RETRIES,
  OUTAGE_RETRY_DELAY_MS,
  pappersFailure,
  SEARCHAPI_INCOMPLETE_ERROR,
  SEARCHAPI_NEEDS_PLACE_ERROR,
  searchApiFailure,
} from "../src/outage-policy.js";

/** MVZ-2230 (14/10/2026) — une panne n'efface plus une bonne note. */

const NOW = new Date("2026-10-14T10:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const goodNote = (ageDays: number) => ({ scoreGlobal: 84, isReliable: true, computedAt: new Date(NOW.getTime() - ageDays * DAY) });

test("Pappers : réseau, délai, HTTP et clé absente sont des pannes ; entreprise introuvable ou sans identifiant, des verdicts", () => {
  for (const kind of ["network", "timeout", "http_error", "missing_key"] as const) {
    assert.equal(pappersFailure({ available: false, errorKind: kind }), "outage", kind);
  }
  for (const kind of ["not_found", "missing_identifier"] as const) {
    assert.equal(pappersFailure({ available: false, errorKind: kind }), "verdict", kind);
  }
  // HTTP 400 et JSON illisible : erreurs définitives, pas des pannes (pas de relance).
  assert.equal(pappersFailure({ available: false, errorKind: "http_error", httpStatus: 400, error: "Pappers HTTP 400" }), "verdict");
  assert.equal(pappersFailure({ available: false, errorKind: "http_error", httpStatus: 200, error: "Pappers JSON invalide: Unexpected token" }), "verdict");
  for (const status of [429, 500, 503, 401]) {
    assert.equal(pappersFailure({ available: false, errorKind: "http_error", httpStatus: status, error: `Pappers HTTP ${status}` }), "outage", String(status));
  }
  assert.equal(pappersFailure({ available: true, errorKind: null }), null);
});

test("Google : quota, HTTP 5xx/401/403/400, réseau, clé absente = panne ; fiche non prouvée, absente, sans correspondance, 404 = verdict", () => {
  const outage = [
    "Google places details HTTP 429",
    "Google searchText HTTP 503",
    "Google places details HTTP 403",
    "Google places details HTTP 400",
    "fetch failed",
    "The operation was aborted due to timeout",
    "GOOGLE_PLACES_API_KEY manquante",
  ];
  for (const error of outage) assert.equal(googleFailure({ available: false, error }), "outage", error);
  const verdict = [
    "Fiche Google pas encore prouvée comme la sienne : note calculée sans Google",
    "Pas de fiche Google, selon le déménageur",
    "Aucun place Google trouvé",
    'Aucun place matche strictement (nom+localisation) pour "Déménagements Exemple"',
    "Google places details HTTP 404",
  ];
  for (const error of verdict) assert.equal(googleFailure({ available: false, error }), "verdict", error);
  assert.equal(googleFailure({ available: true, error: null }), null);
});

test("lecture des avis : HTTP, quota et lecture amputée sont des pannes ; l'absence de fiche Google est portée par Google", () => {
  assert.equal(searchApiFailure({ available: false, error: "SearchAPI HTTP 500" }), "outage");
  assert.equal(searchApiFailure({ available: false, error: "SearchAPI error: Your account has run out of searches" }), "outage");
  assert.equal(searchApiFailure({ available: false, error: SEARCHAPI_INCOMPLETE_ERROR }), "outage");
  assert.equal(searchApiFailure({ available: false, error: SEARCHAPI_NEEDS_PLACE_ERROR }), null);
  assert.equal(searchApiFailure({ available: true, error: null }), null);
});

test("nature de l'échec : panne seulement sans aucun verdict ; un verdict l'emporte toujours", () => {
  assert.equal(classifyUnreliability({ isReliable: true, sources: ["outage"], verdicts: [] }), null);
  assert.equal(classifyUnreliability({ isReliable: false, sources: [null, "outage", null], verdicts: [false] }), "outage");
  assert.equal(classifyUnreliability({ isReliable: false, sources: ["outage", "verdict", null], verdicts: [] }), "verdict");
  // Fiche Google hors métier : verdict, même si Pappers est en panne au même moment.
  assert.equal(classifyUnreliability({ isReliable: false, sources: ["outage", null, null], verdicts: [true] }), "verdict");
  // Entreprise fermée, procédure collective, absente du registre des transporteurs :
  // verdicts, même avec Google en panne le même jour.
  const none = { googleOffTrade: false, companyClosed: false, collectiveProcedure: false, transportRegisterZero: false };
  assert.equal(classifyUnreliability({ isReliable: false, sources: [null, "outage", null], verdicts: companyVerdictList(none) }), "outage");
  for (const key of Object.keys(none) as Array<keyof typeof none>) {
    assert.equal(
      classifyUnreliability({ isReliable: false, sources: [null, "outage", "outage"], verdicts: companyVerdictList({ ...none, [key]: true }) }),
      "verdict",
      key,
    );
  }
  // Composante manquante sans source en panne : verdict.
  assert.equal(classifyUnreliability({ isReliable: false, sources: [null, null, null], verdicts: [] }), "verdict");
});

test("panne + note fiable de moins de 120 jours : la note est conservée et une relance part 24 h plus tard", () => {
  const decision = decideOutageHandling({
    isReliable: false,
    failureKind: "outage",
    current: goodNote(30),
    consecutiveOutages: 0,
    now: NOW,
  });
  assert.deepEqual(decision, {
    action: "keep",
    retryNumber: 1,
    retryAt: new Date(NOW.getTime() + OUTAGE_RETRY_DELAY_MS),
    exhausted: false,
  });
});

test("composantes fraîches pires que celles de la note gardée : la note est remplacée (et relancée)", () => {
  const current = { ...goodNote(10), scoreFinancial: 70, scoreJuridical: 100 };
  const base = { isReliable: false, failureKind: "outage" as const, current, consecutiveOutages: 0, now: NOW };
  const worseJuridical = decideOutageHandling({ ...base, fresh: { financial: 70, juridical: 0 } });
  assert.equal(worseJuridical.action, "replace");
  assert.equal(worseJuridical.action === "replace" && worseJuridical.reason, "fresh_components_worse");
  assert.equal(worseJuridical.action === "replace" && "retryNumber" in worseJuridical && worseJuridical.retryNumber, 1);
  assert.equal(decideOutageHandling({ ...base, fresh: { financial: 55, juridical: 100 } }).action, "replace");
  assert.equal(decideOutageHandling({ ...base, fresh: { financial: 70, juridical: 100 } }).action, "keep", "égales : gardée");
  assert.equal(decideOutageHandling({ ...base, fresh: { financial: 90, juridical: 100 } }).action, "keep", "meilleures : gardée");
  assert.equal(decideOutageHandling({ ...base, fresh: { financial: null, juridical: null } }).action, "keep", "registre en panne : rien à comparer");
  assert.equal(freshComponentsWorse({ ...goodNote(1) }, { financial: 10, juridical: 10 }), false, "note gardée sans composantes : pas de comparaison");
});

test("trois relances d'affilée : la note reste, plus de relance automatique (alerte)", () => {
  const decision = decideOutageHandling({
    isReliable: false,
    failureKind: "outage",
    current: goodNote(5),
    consecutiveOutages: OUTAGE_MAX_CONSECUTIVE_RETRIES,
    now: NOW,
  });
  assert.deepEqual(decision, { action: "keep", retryNumber: null, retryAt: null, exhausted: true });
  const third = decideOutageHandling({ isReliable: false, failureKind: "outage", current: goodNote(5), consecutiveOutages: 2, now: NOW });
  assert.equal(third.action === "keep" && third.retryNumber, 3);
});

test("verdict de fond, note trop vieille, absente ou non fiable : la note est remplacée comme avant", () => {
  const base = { isReliable: false, consecutiveOutages: 0, now: NOW };
  assert.deepEqual(decideOutageHandling({ ...base, failureKind: "verdict", current: goodNote(1) }), { action: "replace", reason: "verdict" });
  assert.deepEqual(decideOutageHandling({ ...base, failureKind: null, current: goodNote(1) }), { action: "replace", reason: "verdict" });
  // Panne sans note fiable récente à garder : remplacée, mais relancée (décision du 14/10/2026).
  const relance = {
    action: "replace",
    reason: "no_kept_score",
    retryNumber: 1,
    retryAt: new Date(NOW.getTime() + OUTAGE_RETRY_DELAY_MS),
    exhausted: false,
  };
  assert.deepEqual(decideOutageHandling({ ...base, failureKind: "outage", current: goodNote(KEPT_SCORE_MAX_AGE_DAYS) }), relance);
  assert.deepEqual(decideOutageHandling({ ...base, failureKind: "outage", current: null }), relance);
  assert.deepEqual(decideOutageHandling({ ...base, failureKind: "outage", current: { ...goodNote(1), isReliable: false } }), relance);
  assert.deepEqual(decideOutageHandling({ ...base, failureKind: "outage", current: { ...goodNote(1), scoreGlobal: null } }), relance);
  assert.deepEqual(
    decideOutageHandling({ isReliable: true, failureKind: null, current: goodNote(1), consecutiveOutages: 0, now: NOW }),
    { action: "replace", reason: "reliable" },
  );
});

test("panne sans note à garder, trois fois d'affilée : plus de relance (même compteur que la note conservée)", () => {
  assert.deepEqual(
    decideOutageHandling({ isReliable: false, failureKind: "outage", current: null, consecutiveOutages: OUTAGE_MAX_CONSECUTIVE_RETRIES, now: NOW }),
    { action: "replace", reason: "no_kept_score", retryNumber: null, retryAt: null, exhausted: true },
  );
});

test("relances consécutives : comptées sur l'historique, du plus récent, jusqu'au premier calcul normal", () => {
  const kept = { details: { outageKept: { retryNumber: 1 } } };
  const normal = { details: { weightedSum: 80 } };
  const replaced = { details: { outageRetry: { retryNumber: 2 } } };
  assert.equal(countConsecutiveOutages([replaced, kept, replaced, normal]), 3, "note conservée ou remplacée : même compteur");
  assert.equal(countConsecutiveOutages([]), 0);
  assert.equal(countConsecutiveOutages([kept, kept, normal, kept]), 2);
  assert.equal(countConsecutiveOutages([normal, kept]), 0);
  assert.equal(countConsecutiveOutages([{ details: null }, kept]), 0);
});
