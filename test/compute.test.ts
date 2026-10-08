import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { createFixtureProviders, loadFixtures } from "../src/adapters/fixture-providers.js";
import { computeScore, GOOGLE_NOT_PROVEN_ERROR, scoreMover, type ScoringInput } from "../src/compute.js";
import type { RegistrySnapshot } from "../src/ports.js";
import { google, NOW, pappers, reviewsOf, reviewsSnapshot, sitr } from "./helpers.js";

function registry(partial: Partial<RegistrySnapshot> = {}): RegistrySnapshot {
  return { pappers: pappers(), transportRegister: sitr(), sireneClosed: false, ...partial };
}

function input(partial: Partial<ScoringInput> = {}): ScoringInput {
  return { registry: registry(), google: google(), reviews: reviewsSnapshot(reviewsOf(30)), now: NOW, ...partial };
}

describe("orchestration stricte", () => {
  it("trois sources présentes : une note fiable, avec ses cinq composantes", async () => {
    const r = await computeScore(input());
    // 80×0,125 + 100×0,125 + 100×0,2 + 100×0,2 + 100×0,35 = 97,5 → 98
    assert.equal(r.globalScore, 98);
    assert.equal(r.isReliable, true);
    assert.equal(r.reliabilityError, null);
    assert.equal(r.reputation.windowMonths, 12);
  });

  it("registre en panne : pas de note, et l'erreur dit laquelle", async () => {
    const r = await computeScore(
      input({ registry: registry({ pappers: pappers({ available: false, companyFound: false, financialScore: null, juridicalScore: null, error: "HTTP 503", errorKind: "http_error" }) }) }),
    );
    assert.equal(r.globalScore, null);
    assert.equal(r.isReliable, false);
    assert.match(r.reliabilityError ?? "", /Registre: HTTP 503/);
    assert.deepEqual(r.reliabilityDetails.missingComponents, ["financial", "juridical"]);
    assert.equal(r.details.financialFallbackApplied, false, "une panne n'a jamais de valeur de repli");
  });

  it("avis non collectés : pas de note, même si Google donne 4,9", async () => {
    const r = await computeScore(input({ reviews: reviewsSnapshot([], { available: false, error: "quota dépassé" }) }));
    assert.equal(r.globalScore, null);
    assert.deepEqual(r.reliabilityDetails.missingComponents, ["reputation", "vigilance"]);
    assert.match(r.reliabilityError ?? "", /Avis: quota dépassé/);
  });

  it("exception n° 1 : registre répondu sans bilan → financier 50, note fiable", async () => {
    const r = await computeScore(input({ registry: registry({ pappers: pappers({ financialScore: null }) }) }));
    assert.equal(r.components.financial, 50);
    assert.equal(r.details.financialFallbackApplied, true);
    assert.equal(r.isReliable, true);
  });

  it("exception n° 2 : fiche Google sans note → 50, note fiable", async () => {
    const r = await computeScore(input({ google: google({ rating: null, ratingCount: 0 }) }));
    assert.equal(r.components.google, 50);
    assert.equal(r.details.googleFallbackApplied, true);
    assert.equal(r.isReliable, true);
  });

  it("hors registre des transporteurs, ou fermée à Sirene : juridique à 0", async () => {
    const off = await computeScore(input({ registry: registry({ transportRegister: sitr({ inMarchandises: false, marchandises: null, matched: false, matchKind: "none" }) }) }));
    assert.equal(off.components.juridical, 0);
    assert.equal(off.details.sitrJuridicalVerdict, "zero");
    const closed = await computeScore(input({ registry: registry({ sireneClosed: true }) }));
    assert.equal(closed.components.juridical, 0);
  });

  it("bilan téléversé : appliqué, sauf si le registre a publié plus récent", async () => {
    const applied = await computeScore(input({ financialOverride: { computedScore: 64, dateCloture: "2025-12-31" } }));
    assert.equal(applied.components.financial, 64);
    const superseded = await computeScore(
      input({
        registry: registry({ pappers: pappers({ financialScore: 72, finances: [{ date_de_cloture_exercice: "2026-06-30" }] }) }),
        financialOverride: { computedScore: 64, dateCloture: "2025-12-31" },
      }),
    );
    assert.equal(superseded.components.financial, 72);
    assert.equal(superseded.details.financialOverrideSupersededByRegistry, true);
  });

  it("la santé de l'entreprise est extraite du registre et le motif principal est calculé", async () => {
    const r = await computeScore(
      input({ registry: registry({ pappers: pappers({ raw: { procedure_collective_en_cours: true, procedures_collectives: [{ type: "Redressement judiciaire" }] } }) }) }),
    );
    assert.equal(r.companyHealth.fragile, true);
    assert.equal(r.motif.axis, "financial");
  });
});

describe("avec les ports (données de démonstration)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const fixtures = loadFixtures(join(here, "..", "fixtures"));
  const providers = createFixtureProviders(fixtures);
  const run = async (id: string, options = {}) => {
    const fixture = fixtures.find((f) => f.mover.id === id);
    assert.ok(fixture);
    return scoreMover(fixture.mover, providers, { now: new Date(fixture.asOf), ...options });
  };

  it("les quatre cas de démonstration donnent le résultat documenté dans le README", async () => {
    assert.equal((await run("demo-confirme")).globalScore, 88);
    const dyn = await run("demo-dynamique");
    assert.equal(dyn.globalScore, 79);
    assert.equal(dyn.reputation.windowMonths, 24);
    assert.equal(dyn.details.financialFallbackApplied, true);
    const fragile = await run("demo-fragile");
    assert.equal(fragile.companyHealth.fragile, true);
    assert.equal(fragile.components.juridical, 0);
    assert.equal((await run("demo-sans-fiche")).globalScore, null);
  });

  it("fiche Google non prouvée : ni Google ni avis interrogés, pas de note globale", async () => {
    const r = await run("demo-confirme", { withoutGoogle: true });
    assert.equal(r.globalScore, null);
    assert.equal(r.reliabilityDetails.criticalSources.google.error, GOOGLE_NOT_PROVEN_ERROR);
    assert.equal(r.components.financial, 98, "les sous-scores du registre restent visibles");
  });
});
