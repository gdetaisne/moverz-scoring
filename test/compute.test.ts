import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { createFixtureProviders, loadFixtures } from "../src/adapters/fixture-providers.js";
import { computeScore, GOOGLE_NOT_PROVEN_ERROR, scoreMover, SITR_DIRECTORY_UNREAD_WARNING, type ScoringInput } from "../src/compute.js";
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

  it("fiche Google hors métier : composante Google retirée, pas de note, et la raison", async () => {
    const offTrade = reviewsOf(30, { text: "Syndic réactif, les charges de la copropriété sont enfin claires et bien suivies." });
    const r = await computeScore(input({ google: google({ name: "Cabinet Gestion Exemple" }), reviews: reviewsSnapshot(offTrade) }));
    assert.equal(r.globalScore, null);
    assert.equal(r.isReliable, false);
    assert.equal(r.components.google, null);
    assert.equal(r.details.googleTrade?.offTrade, true);
    assert.match(r.reliabilityError ?? "", /Fiche Google hors métier : 0\/30 avis/);
    assert.ok(r.reliabilityDetails.warnings.includes("google_fiche_off_trade:0%"));
    assert.equal(r.components.reputation, 100, "les autres sous-scores restent visibles pour l'audit");
  });

  it("fiche de déménageur : le verdict métier est gardé, la note reste fiable", async () => {
    const r = await computeScore(input({ google: google({ name: "Déménagements Exemple" }) }));
    assert.equal(r.details.googleTrade?.offTrade, false);
    assert.equal(r.isReliable, true);
  });

  it("panne ou verdict (14/10/2026) : chaque échec dit sa nature", async () => {
    const reliable = await computeScore(input());
    assert.equal(reliable.reliabilityDetails.failureKind, null);

    const registryDown = await computeScore(
      input({ registry: registry({ pappers: pappers({ available: false, companyFound: false, financialScore: null, juridicalScore: null, error: "HTTP 503", errorKind: "http_error" }) }) }),
    );
    assert.equal(registryDown.reliabilityDetails.criticalSources.registry.failure, "outage");
    assert.equal(registryDown.reliabilityDetails.failureKind, "outage");

    const notFound = await computeScore(
      input({ registry: registry({ pappers: pappers({ available: false, companyFound: false, financialScore: null, juridicalScore: null, error: "introuvable", errorKind: "not_found" }) }) }),
    );
    assert.equal(notFound.reliabilityDetails.failureKind, "verdict");

    const quota = await computeScore(input({ reviews: reviewsSnapshot([], { available: false, error: "quota dépassé" }) }));
    assert.equal(quota.reliabilityDetails.failureKind, "outage");

    const offTrade = reviewsOf(30, { text: "Syndic réactif, les charges de la copropriété sont enfin claires et bien suivies." });
    const horsMetier = await computeScore(input({ google: google({ name: "Cabinet Gestion Exemple" }), reviews: reviewsSnapshot(offTrade) }));
    assert.equal(horsMetier.reliabilityDetails.failureKind, "verdict");
  });

  it("entreprise fermée, procédure collective, hors registre des transporteurs : verdicts, même avec les avis en panne", async () => {
    const reviewsDown = reviewsSnapshot([], { available: false, error: "HTTP 503" });
    const closed = await computeScore(input({ reviews: reviewsDown, registry: registry({ sireneClosed: true }) }));
    assert.equal(closed.reliabilityDetails.failureKind, "verdict");
    const procedure = await computeScore(
      input({ reviews: reviewsDown, registry: registry({ pappers: pappers({ raw: { procedure_collective_en_cours: true } }) }) }),
    );
    assert.equal(procedure.reliabilityDetails.failureKind, "verdict");
    const offRegister = await computeScore(
      input({ reviews: reviewsDown, registry: registry({ transportRegister: sitr({ inMarchandises: false, marchandises: null, matched: false, matchKind: "none" }) }) }),
    );
    assert.equal(offRegister.reliabilityDetails.failureKind, "verdict");
    const healthy = await computeScore(input({ reviews: reviewsDown }));
    assert.equal(healthy.reliabilityDetails.failureKind, "outage");
  });

  it("collecte d'avis amputée (14/10/2026) : pas de note, c'est une panne", async () => {
    const r = await computeScore(input({ reviews: reviewsSnapshot(reviewsOf(10), { incomplete: true }) }));
    assert.equal(r.globalScore, null);
    assert.equal(r.isReliable, false);
    assert.deepEqual(r.reliabilityDetails.missingComponents, ["reputation", "vigilance"]);
    assert.equal(r.reliabilityDetails.criticalSources.reviews.failure, "outage");
    assert.equal(r.reliabilityDetails.failureKind, "outage");
    assert.match(r.reliabilityError ?? "", /Avis: Lecture des avis amputée/);
  });

  it("la méthode de la vigilance est écrite dans le détail", async () => {
    const r = await computeScore(input());
    assert.deepEqual(r.details.vigilance, { method: "keywords", fallbackReason: null, llmFallback: false });
  });

  it("la santé de l'entreprise est extraite du registre et le motif principal est calculé", async () => {
    const r = await computeScore(
      input({ registry: registry({ pappers: pappers({ raw: { procedure_collective_en_cours: true, procedures_collectives: [{ type: "Redressement judiciaire" }] } }) }) }),
    );
    assert.equal(r.companyHealth.fragile, true);
    assert.equal(r.motif.axis, "financial");
  });
});

describe("règles du 14/10/2026 dans l'orchestration", () => {
  const offRegister = () => sitr({ inMarchandises: false, marchandises: null, matched: false, matchKind: "none" });
  // Note avant plafond : 100×0,125 + 0×0,125 + 100×0,2 + 100×0,2 + 100×0,35 = 87,5 → 88.
  const strong = (registryPartial: Partial<RegistrySnapshot>) =>
    input({ registry: registry({ pappers: pappers({ financialScore: 100 }), ...registryPartial }) });
  const directoryEntry = {
    siren: "900000002",
    raisonSociale: "DEMENAGEMENTS EXEMPLE",
    postalCode: "69007",
    commune: "LYON",
    manager: "LEBLANC MARC",
    register: "marchandises" as const,
  };

  it("version des règles : legacy-compatible-v2", async () => {
    assert.equal((await computeScore(input())).algorithmVersion, "legacy-compatible-v2");
  });

  it("absence confirmée au registre des transporteurs : note plafonnée à 65", async () => {
    const r = await computeScore(strong({ transportRegister: offRegister(), transportRegisterDirectory: [] }));
    assert.equal(r.globalScore, 65);
    assert.equal(r.globalLabel, "Correct");
    assert.deepEqual(r.details.registerCap, { capped: true, maxScore: 65, uncappedScore: 88, successors: [] });
    assert.ok(r.reliabilityDetails.warnings.includes("sitr_register_cap:65"));
  });

  it("annuaire du registre non lu (15/10/2026) : la recherche est impossible, pas de plafond, et l'avertissement le dit", async () => {
    const r = await computeScore(strong({ transportRegister: offRegister() }));
    assert.equal(r.globalScore, 88);
    assert.equal(r.details.registerCap.capped, false);
    assert.equal(r.details.registerCap.successors, null);
    assert.ok(r.reliabilityDetails.warnings.includes(SITR_DIRECTORY_UNREAD_WARNING));
    assert.equal(SITR_DIRECTORY_UNREAD_WARNING, "sitr_successor_lookup_failed:no_cap");
  });

  it("l'entreprise figure au registre sous un autre SIREN (même nom, même lieu) : pas de plafond, l'équipe est alertée", async () => {
    const r = await computeScore({
      ...strong({
        pappers: pappers({ financialScore: 100, raw: { siren: "123456789", nom_entreprise: "DEMENAGEMENTS EXEMPLE" } }),
        transportRegister: offRegister(),
        transportRegisterDirectory: [directoryEntry],
      }),
      mover: { companyName: "Déménagements Exemple", siren: "123456789", siret: null, city: "Lyon", postalCode: "69007" },
    });
    assert.equal(r.globalScore, 88);
    assert.equal(r.details.registerCap.capped, false);
    assert.deepEqual(r.details.registerCap.successors?.map((c) => [c.siren, c.reason]), [["900000002", "same_name_same_place"]]);
    assert.ok(r.reliabilityDetails.warnings.includes("sitr_successor_candidate:900000002"));
  });

  it("deux autres SIREN plausibles (15/10/2026) : ambigu, le plafond reste, l'avertissement les nomme", async () => {
    const r = await computeScore({
      ...strong({
        pappers: pappers({ financialScore: 100, raw: { siren: "123456789", nom_entreprise: "DEMENAGEMENTS EXEMPLE" } }),
        transportRegister: offRegister(),
        transportRegisterDirectory: [directoryEntry, { ...directoryEntry, siren: "900000003", postalCode: "69003" }],
      }),
      mover: { companyName: "Déménagements Exemple", siren: "123456789", siret: null, city: "Lyon", postalCode: "69007" },
    });
    assert.equal(r.globalScore, 65);
    assert.equal(r.details.registerCap.capped, true);
    assert.ok(r.reliabilityDetails.warnings.includes("sitr_successor_ambiguous:900000002+900000003"));
    assert.ok(!r.reliabilityDetails.warnings.some((w) => w.startsWith("sitr_successor_candidate:")));
  });

  it("registre des transporteurs illisible : aucune pénalité", async () => {
    const r = await computeScore(strong({ transportRegister: null }));
    assert.equal(r.details.registerCap.capped, false);
    assert.ok(r.reliabilityDetails.warnings.includes("sitr_lookup_failed"));
    assert.equal(r.globalScore, 100);
  });

  it("bilan de plus de 24 mois à la date du calcul : financier 50, et la raison", async () => {
    const old = [{ annee: 2023, date_de_cloture_exercice: "2023-12-31", chiffre_affaires: 900_000, resultat: 80_000, fonds_propres: 300_000 }];
    const r = await computeScore(
      input({ registry: registry({ pappers: pappers({ financialScore: 95, financialSource: "pappers_heuristic", finances: old }) }) }),
    );
    assert.equal(r.components.financial, 50);
    assert.equal(r.details.financialFallbackApplied, true);
    assert.deepEqual(r.details.financialAssessment, { status: "stale", latestClosure: "2023-12-31" });
    assert.ok(r.reliabilityDetails.warnings.includes("financial_fallback_applied:stale_accounts:2023-12-31"));
  });

  it("note heuristique recalculée à la date du calcul, sur l'exercice le plus récent", async () => {
    const finances = [
      { annee: 2025, date_de_cloture_exercice: "2025-12-31", chiffre_affaires: 1_800_000, resultat: 95_000, fonds_propres: 420_000, tresorerie: 180_000, dettes_financieres: 60_000 },
      { annee: 2024, date_de_cloture_exercice: "2024-12-31", chiffre_affaires: 1_650_000, resultat: 71_000, fonds_propres: 340_000, tresorerie: 150_000, dettes_financieres: 80_000 },
    ];
    const r = await computeScore(input({ registry: registry({ pappers: pappers({ financialScore: 40, financialSource: "pappers_heuristic", finances }) }) }));
    assert.equal(r.components.financial, 98, "la note en cache (40) ne compte pas : on relit le bilan");
    assert.deepEqual(r.details.financialAssessment, { status: "scored", latestClosure: "2025-12-31" });
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

  it("les cinq cas de démonstration donnent le résultat documenté dans le README", async () => {
    assert.equal((await run("demo-confirme")).globalScore, 92);
    const dyn = await run("demo-dynamique");
    // 83 avant le 14/10/2026 : 17 avis Google plafonnaient à 75 ; plafond progressif, 92,5 → 93.
    assert.equal(dyn.globalScore, 86);
    assert.equal(dyn.components.google, 93);
    assert.equal(dyn.reputation.windowMonths, 24);
    assert.equal(dyn.details.financialFallbackApplied, true);
    const fragile = await run("demo-fragile");
    assert.equal(fragile.companyHealth.fragile, true);
    assert.equal(fragile.components.juridical, 0);
    // Hors registre, annuaire non fourni : recherche impossible, pas de plafond (et 59 ≤ 65 de toute façon).
    assert.equal(fragile.globalScore, 59);
    assert.equal(fragile.details.registerCap.capped, false);
    assert.ok(fragile.reliabilityDetails.warnings.includes("sitr_successor_lookup_failed:no_cap"));
    assert.equal((await run("demo-sans-fiche")).globalScore, null);
    const horsMetier = await run("demo-hors-metier");
    assert.equal(horsMetier.globalScore, null);
    assert.equal(horsMetier.details.googleTrade?.offTrade, true);
  });

  it("fiche Google non prouvée : ni Google ni avis interrogés, pas de note globale", async () => {
    const r = await run("demo-confirme", { withoutGoogle: true });
    assert.equal(r.globalScore, null);
    assert.equal(r.reliabilityDetails.criticalSources.google.error, GOOGLE_NOT_PROVEN_ERROR);
    assert.equal(r.components.financial, 98, "les sous-scores du registre restent visibles");
  });
});
