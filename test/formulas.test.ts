import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildStrictGlobalScore,
  computeLegacyFinancialScore,
  computeLegacyGoogleScore,
  computeLegacyJuridicalScore,
  financialScoreForGlobal,
  googleScoreForGlobal,
  labelFromScore,
  LEGACY_DEFAULT_CONFIG,
} from "../src/formulas.js";
import { NOW } from "./helpers.js";

describe("poids et libellés", () => {
  it("les cinq poids publiés font 100 %, la vigilance pèse le plus", () => {
    const { weightFinancier, weightJuridique, weightGoogle, weightReputation, weightVigilance } = LEGACY_DEFAULT_CONFIG;
    assert.deepEqual([weightFinancier, weightJuridique, weightGoogle, weightReputation, weightVigilance], [0.125, 0.125, 0.2, 0.2, 0.35]);
    assert.equal(Math.round((weightFinancier + weightJuridique + weightGoogle + weightReputation + weightVigilance) * 1000), 1000);
  });

  it("bornes des libellés : 85 Excellent, 70 Bon, 50 Correct, 30 Fragile", () => {
    assert.equal(labelFromScore(85), "Excellent");
    assert.equal(labelFromScore(84), "Bon");
    assert.equal(labelFromScore(70), "Bon");
    assert.equal(labelFromScore(69), "Correct");
    assert.equal(labelFromScore(50), "Correct");
    assert.equal(labelFromScore(30), "Fragile");
    assert.equal(labelFromScore(29), "Critique");
    assert.equal(labelFromScore(null), null);
  });
});

describe("règle stricte : pas de note inventée", () => {
  it("cinq composantes présentes : somme pondérée exacte", () => {
    // 60×0,125 + 100×0,125 + 80×0,2 + 70×0,2 + 90×0,35 = 81,5 → 82
    const r = buildStrictGlobalScore({ financial: 60, juridical: 100, google: 80, reputation: 70, vigilance: 90 });
    assert.equal(r.globalScore, 82);
    assert.equal(r.globalLabel, "Bon");
    assert.deepEqual(r.missingComponents, []);
  });

  it("une seule composante manquante : pas de note globale, et on dit laquelle", () => {
    const r = buildStrictGlobalScore({ financial: 90, juridical: 100, google: 95, reputation: null, vigilance: 100 });
    assert.equal(r.globalScore, null);
    assert.equal(r.globalLabel, null);
    assert.deepEqual(r.missingComponents, ["reputation"]);
    assert.equal(r.components.financial, 90, "les sous-scores restent visibles pour l'audit");
  });

  it("une composante à 0 est une vraie valeur, pas une absence", () => {
    const r = buildStrictGlobalScore({ financial: 100, juridical: 0, google: 100, reputation: 100, vigilance: 100 });
    assert.equal(r.globalScore, 88);
  });
});

describe("les deux exceptions codifiées, à 50", () => {
  it("financier : registre répondu sans bilan → 50 ; registre en panne → rien", () => {
    assert.deepEqual(financialScoreForGlobal({ registryAvailable: true, computed: null }), {
      score: 50,
      fallbackApplied: true,
      overrideApplied: false,
    });
    assert.equal(financialScoreForGlobal({ registryAvailable: false, computed: null }).score, null);
    assert.equal(financialScoreForGlobal({ registryAvailable: true, computed: 72 }).score, 72);
  });

  it("financier : un bilan téléversé validé passe avant le registre", () => {
    const r = financialScoreForGlobal({ registryAvailable: true, computed: 40, overrideScore: 77 });
    assert.equal(r.score, 77);
    assert.equal(r.overrideApplied, true);
  });

  it("Google : fiche trouvée sans note → 50 ; fiche introuvable → rien", () => {
    assert.deepEqual(googleScoreForGlobal({ available: true, computed: null }), { score: 50, fallbackApplied: true });
    assert.deepEqual(googleScoreForGlobal({ available: false, computed: null }), { score: null, fallbackApplied: false });
  });
});

describe("axe financier", () => {
  it("entreprise rentable, solide, trésorerie confortable, en croissance : près de 100", () => {
    const score = computeLegacyFinancialScore([
      { chiffre_affaires: 1_800_000, resultat: 95_000, fonds_propres: 420_000, tresorerie: 180_000, dettes_financieres: 60_000 },
      { chiffre_affaires: 1_650_000, resultat: 71_000, fonds_propres: 340_000, tresorerie: 150_000, dettes_financieres: 80_000 },
    ]);
    assert.equal(score, 98);
  });

  it("pertes, fonds propres négatifs, dettes : note basse", () => {
    const score = computeLegacyFinancialScore([
      { chiffre_affaires: 640_000, resultat: -58_000, fonds_propres: -12_000, tresorerie: 4_000, dettes_financieres: 150_000 },
      { chiffre_affaires: 710_000, resultat: -9_000, fonds_propres: 46_000, tresorerie: 22_000, dettes_financieres: 120_000 },
    ]);
    assert.ok(score !== null && score < 30, `score ${score}`);
  });

  it("aucun chiffre exploitable : null, jamais une note par défaut", () => {
    assert.equal(computeLegacyFinancialScore([]), null);
    assert.equal(computeLegacyFinancialScore([{ annee: 2025, chiffre_affaires: null, resultat: null }]), null);
  });

  it("l'exercice le plus complet parmi les trois derniers est retenu", () => {
    const sparse = { chiffre_affaires: 500_000, resultat: null, fonds_propres: null, tresorerie: null, dettes_financieres: null };
    const full = { chiffre_affaires: 480_000, resultat: 30_000, fonds_propres: 120_000, tresorerie: 60_000, dettes_financieres: 0 };
    assert.equal(computeLegacyFinancialScore([sparse, full]), computeLegacyFinancialScore([full]));
  });
});

describe("axe juridique", () => {
  it("aucune décision : 100", () => {
    assert.equal(computeLegacyJuridicalScore([], undefined, NOW), 100);
  });

  it("récente −25, ancienne −10, mot grave +15", () => {
    const recent = { date: "2025-06-01", dispositif: "Condamne au paiement", position: "défendeur" };
    const old = { date: "2018-06-01", dispositif: "Rejette la demande" };
    const grave = { date: "2026-03-01", dispositif: "Ouverture d'une procédure de redressement judiciaire" };
    // « Condamne » n'est pas « condamnation » : le mot-clé est exact, pas une racine.
    assert.equal(computeLegacyJuridicalScore([recent], undefined, NOW), 75);
    assert.equal(computeLegacyJuridicalScore([old], undefined, NOW), 90);
    assert.equal(computeLegacyJuridicalScore([grave], undefined, NOW), 60);
    assert.equal(computeLegacyJuridicalScore([recent, old, grave], undefined, NOW), 25);
  });

  it("l'entreprise qui attaque n'est pas pénalisée ; une décision sans date compte comme récente", () => {
    assert.equal(computeLegacyJuridicalScore([{ date: "2026-01-01", position: "attaque" }], undefined, NOW), 100);
    assert.equal(computeLegacyJuridicalScore([{ dispositif: "Rejette" }], undefined, NOW), 75);
  });
});

describe("axe Google", () => {
  it("note sur 5 ramenée sur 100, bonus de volume plafonné à +10", () => {
    assert.equal(computeLegacyGoogleScore(4.7, 214, "OPERATIONAL"), 100);
    assert.equal(computeLegacyGoogleScore(4.0, 40, "OPERATIONAL"), 90);
  });

  it("moins de 20 avis : plafond 75, même avec 5/5", () => {
    assert.equal(computeLegacyGoogleScore(5, 6, "OPERATIONAL"), 75);
    assert.equal(computeLegacyGoogleScore(5, 20, "OPERATIONAL"), 100);
  });

  it("une fiche fermée n'est pas pénalisée : ce sont les avis qui comptent", () => {
    assert.equal(computeLegacyGoogleScore(4.5, 80, "CLOSED_PERMANENTLY"), computeLegacyGoogleScore(4.5, 80, "OPERATIONAL"));
  });

  it("pas de note : null (c'est l'exception à 50 qui décidera)", () => {
    assert.equal(computeLegacyGoogleScore(null, 0, "OPERATIONAL"), null);
  });
});
