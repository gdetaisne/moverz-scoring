import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assessLegacyFinancial,
  buildStrictGlobalScore,
  computeLegacyFinancialScore,
  computeLegacyGoogleScore,
  computeLegacyJuridicalScore,
  financialScoreForGlobal,
  googleScoreForGlobal,
  googleVolumeCap,
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

});

describe("axe financier : le bilan le plus récent (14/10/2026)", () => {
  const exercise = (
    annee: number,
    fields: Partial<Record<"chiffre_affaires" | "resultat" | "fonds_propres" | "tresorerie" | "dettes_financieres", number | null>>,
  ) => ({
    annee,
    date_de_cloture_exercice: `${annee}-12-31`,
    chiffre_affaires: null,
    resultat: null,
    fonds_propres: null,
    tresorerie: null,
    dettes_financieres: null,
    ...fields,
  });

  it("l'exercice le plus récent est noté, même si un exercice plus ancien est plus rempli", () => {
    // Avant le 14/10/2026, « le plus complet des trois derniers » aurait noté 2022.
    const recentLoss = exercise(2025, { resultat: -60_000, chiffre_affaires: 300_000 });
    const oldFull = exercise(2022, { resultat: 40_000, chiffre_affaires: 400_000, fonds_propres: 200_000, tresorerie: 80_000, dettes_financieres: 0 });
    // Résultat 2025 (perte de 20 % du CA = 2), fonds propres / trésorerie / dettes de 2022 en complément,
    // tendance : CA en baisse et résultat en baisse = 3.
    assert.equal(computeLegacyFinancialScore([oldFull, recentLoss]), 2 + 25 + 20 + 15 + 3);
  });

  it("un champ manquant se complète avec l'exercice précédent, jamais le résultat", () => {
    const latest = exercise(2025, { chiffre_affaires: 500_000 });
    const prev = exercise(2024, { resultat: 50_000, chiffre_affaires: 450_000, fonds_propres: 120_000 });
    // Résultat absent en 2025 : 10 (non repris de 2024) ; fonds propres repris (25) ; trésorerie absente (8) ;
    // endettement : dettes absentes, fonds propres connus = 15 ; tendance : CA en hausse, résultat inconnu = 12.
    assert.equal(computeLegacyFinancialScore([latest, prev]), 10 + 25 + 8 + 15 + 12);
  });

  it("bilan clôturé il y a plus de 24 mois = pas de chiffres, même mauvais (aucun plancher)", () => {
    const now = new Date("2026-10-15T00:00:00Z");
    const bad = [exercise(2023, { resultat: -80_000, chiffre_affaires: 200_000, fonds_propres: -50_000 })];
    const stale = assessLegacyFinancial(bad, now);
    assert.deepEqual(stale, { score: null, status: "stale", latestClosure: "2023-12-31" });
    // … et c'est l'exception à 50 qui s'applique, comme sans bilan publié.
    assert.equal(financialScoreForGlobal({ registryAvailable: true, computed: stale.score }).score, 50);
    // 31/12/2024 : 21 mois et demi avant le 15/10/2026, encore lu.
    const good = [exercise(2024, { resultat: 30_000, chiffre_affaires: 300_000 })];
    assert.equal(assessLegacyFinancial(good, now).status, "scored");
    assert.equal(assessLegacyFinancial([], now).status, "no_data");
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

  it("jusqu'à 10 avis : plafond 75, même avec 5/5", () => {
    assert.equal(computeLegacyGoogleScore(5, 6, "OPERATIONAL"), 75);
    assert.equal(computeLegacyGoogleScore(5, 20, "OPERATIONAL"), 100);
  });

  it("plafond progressif (14/10/2026) : 75 jusqu'à 10 avis, +2,5 par avis jusqu'à 20, plus de plafond ensuite", () => {
    assert.equal(googleVolumeCap(3), 75);
    assert.equal(googleVolumeCap(10), 75);
    assert.equal(googleVolumeCap(14), 85);
    assert.equal(googleVolumeCap(19), 97.5);
    assert.equal(googleVolumeCap(20), 100);
    assert.equal(computeLegacyGoogleScore(5, 10, null), 75);
    assert.equal(computeLegacyGoogleScore(5, 15, null), 88); // 87,5 arrondi
    assert.equal(computeLegacyGoogleScore(4.6, 19, null), 98); // 92 + 9,5 = 101,5 → 100, plafonné à 97,5, arrondi 98
    assert.equal(computeLegacyGoogleScore(4.6, 25, null), 100);
  });

  it("une fiche fermée n'est pas pénalisée : ce sont les avis qui comptent", () => {
    assert.equal(computeLegacyGoogleScore(4.5, 80, "CLOSED_PERMANENTLY"), computeLegacyGoogleScore(4.5, 80, "OPERATIONAL"));
  });

  it("pas de note : null (c'est l'exception à 50 qui décidera)", () => {
    assert.equal(computeLegacyGoogleScore(null, 0, "OPERATIONAL"), null);
  });
});

describe("juridique : mots graves (corrigé le 08/10/2026)", () => {
  const recent = new Date().toISOString();
  it("la procédure collective signalée par le registre est une décision grave", () => {
    assert.equal(computeLegacyJuridicalScore([{ dispositif: "Procédure collective en cours", date: recent }]), 60);
  });
  it("les mots graves sont reconnus sans accent ni casse", () => {
    assert.equal(computeLegacyJuridicalScore([{ dispositif: "PROCEDURE COLLECTIVE ouverte", date: recent }]), 60);
    assert.equal(computeLegacyJuridicalScore([{ dispositif: "Jugement de Liquidation judiciaire", date: recent }]), 60);
  });
  it("une décision ordinaire ne prend que le malus de base", () => {
    assert.equal(computeLegacyJuridicalScore([{ dispositif: "Injonction de payer", date: recent }]), 75);
  });
});
