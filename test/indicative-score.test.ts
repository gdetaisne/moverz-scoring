import assert from "node:assert/strict";
import test from "node:test";
import { computeIndicativeScore } from "../src/indicative-score.js";

const none = { financial: null, juridical: null, google: null, reputation: null, vigilance: null };

test("note renormalisée sur les seuls axes disponibles (poids 0,125 / 0,125 / 0,2)", () => {
  // (80 × 0,125 + 100 × 0,125 + 90 × 0,2) / 0,45 = 90 : un axe absent ne tire pas la note vers 0.
  const score = computeIndicativeScore({ ...none, financial: 80, juridical: 100, google: 90 });
  assert.equal(score.value, 90);
  assert.deepEqual(score.axes, [
    { key: "financial", label: "Santé financière", value: 80 },
    { key: "juridical", label: "Situation juridique", value: 100 },
    { key: "google", label: "Avis Google", value: 90 },
  ]);
  assert.match(score.label ?? "", /^Note indicative sur 100/);
  assert.doesNotMatch(score.label ?? "", /Moverz/i);
});

test("la comparaison avec le calcul strict : cinq axes pondérés comme le scoring Moverz", () => {
  const score = computeIndicativeScore({ financial: 60, juridical: 100, google: 80, reputation: 70, vigilance: 90 });
  // 60×0,125 + 100×0,125 + 80×0,2 + 70×0,2 + 90×0,35 = 7,5 + 12,5 + 16 + 14 + 31,5 = 81,5 → 82
  assert.equal(score.value, 82);
});

test("deux axes suffisent, un seul non : pas de note sur une seule donnée", () => {
  // (50 × 0,125 + 100 × 0,2) / 0,325 = 80,77 → 81
  assert.equal(computeIndicativeScore({ ...none, financial: 50, google: 100 }).value, 81);
  const single = computeIndicativeScore({ ...none, google: 100 });
  assert.equal(single.value, null);
  assert.equal(single.label, null);
  assert.deepEqual(single.axes, [{ key: "google", label: "Avis Google", value: 100 }]);
  assert.equal(computeIndicativeScore(none).value, null);
});

test("entreprise fragile : note plafonnée à 49", () => {
  const score = computeIndicativeScore({ ...none, financial: 90, juridical: 0, google: 100 }, { fragile: true });
  assert.ok((score.value ?? 100) <= 49);
  assert.equal(computeIndicativeScore({ ...none, financial: 20, google: 20 }, { fragile: true }).value, 20);
});

test("valeurs hors bornes ramenées dans 0-100", () => {
  assert.equal(computeIndicativeScore({ ...none, financial: 150, google: -20 }).axes.map((a) => a.value).join(), "100,0");
});
