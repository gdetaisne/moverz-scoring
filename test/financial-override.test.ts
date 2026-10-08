import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  analyzeBilanPdf,
  buildBilanPrompt,
  decideBilan,
  normalizeBilanAnswer,
  shouldSupersedeOverride,
  type BilanAnalysis,
} from "../src/financial-override.js";
import type { LlmClient } from "../src/llm/client.js";
import { NOW } from "./helpers.js";

const exercise = {
  year: 2025,
  dateCloture: "2025-12-31",
  dureeMois: 12,
  chiffreAffaires: 450_000,
  resultatNet: 25_000,
  fondsPropres: 120_000,
  tresorerie: 35_000,
  dettesFinancieres: 40_000,
  effectif: 5,
};

function analysis(partial: Partial<BilanAnalysis> = {}): BilanAnalysis {
  return {
    matchesCompany: true,
    detectedCompanyName: "TRANSPORTS MODELE",
    detectedSiren: "987654321",
    isValidBilan: true,
    confidence: "high",
    anomalies: [],
    summary: "Comptes annuels 2025",
    exercises: [exercise],
    aiModel: "fake",
    ...partial,
  };
}

const llmAnswering = (json: unknown): LlmClient => ({
  provider: "fake",
  model: "fake-model",
  async completeJson() {
    return { json, provider: "fake", model: "fake-model", usage: null };
  },
});

describe("bilan téléversé", () => {
  it("bilan valide, récent, de la bonne entreprise : la MÊME formule que le registre", () => {
    const d = decideBilan(analysis(), NOW);
    assert.equal(d.ok, true);
    assert.equal(d.ok && d.dateCloture, "2025-12-31");
    assert.ok(d.ok && d.computedScore > 50);
  });

  it("chaque contrôle a son motif de refus, dans l'ordre", () => {
    const reason = (a: BilanAnalysis) => {
      const d = decideBilan(a, NOW);
      return d.ok ? "ok" : d.reason;
    };
    assert.equal(reason(analysis({ matchesCompany: false })), "ai_company_mismatch");
    assert.equal(reason(analysis({ isValidBilan: false })), "ai_not_bilan");
    assert.equal(reason(analysis({ confidence: "low" })), "ai_low_confidence");
    assert.equal(reason(analysis({ exercises: [{ ...exercise, chiffreAffaires: null, resultatNet: null, fondsPropres: null, tresorerie: null, dettesFinancieres: null }] })), "ai_no_figures");
    assert.equal(reason(analysis({ exercises: [{ ...exercise, dateCloture: "2024-06-30" }] })), "bilan_too_old");
  });

  it("la réponse du modèle est relue : nombres à la française, confiance inconnue = low", () => {
    const a = normalizeBilanAnswer(
      { matchesCompany: true, isValidBilan: true, confidence: "certaine", exercises: [{ dateCloture: "2025-12-31", chiffreAffaires: "450 000,50" }] },
      "fake",
    );
    assert.equal(a?.confidence, "low");
    assert.equal(a?.exercises[0].chiffreAffaires, 450000.5);
    assert.equal(normalizeBilanAnswer("pas un objet", null), null);
  });

  it("PDF scanné sans texte : refus avant tout appel au modèle", async () => {
    let called = false;
    const d = await analyzeBilanPdf({
      pdf: new Uint8Array(),
      company: { name: "Transports Modèle", siren: "987654321" },
      extractText: async () => "  ",
      llm: [{ provider: "x", model: "x", completeJson: async () => ((called = true), null) }],
      now: NOW,
    });
    assert.equal(d.ok ? "ok" : d.reason, "pdf_text_too_short");
    assert.equal(called, false);
  });

  it("chaîne complète avec un modèle simulé", async () => {
    const d = await analyzeBilanPdf({
      pdf: new Uint8Array([1]),
      company: { name: "Transports Modèle", siren: "987654321" },
      extractText: async () => "COMPTES ANNUELS ".repeat(30),
      llm: [llmAnswering({ matchesCompany: true, isValidBilan: true, confidence: "medium", exercises: [exercise] })],
      now: NOW,
    });
    assert.equal(d.ok, true);
    assert.match(buildBilanPrompt({ company: { name: "Transports Modèle", siren: null }, extractedText: "x" }), /Ne devine PAS/);
  });

  it("le registre reprend la main dès qu'il publie un exercice plus récent", () => {
    assert.equal(shouldSupersedeOverride(new Date("2025-12-31"), new Date("2026-06-30")), true);
    assert.equal(shouldSupersedeOverride(new Date("2025-12-31"), new Date("2024-12-31")), false);
    assert.equal(shouldSupersedeOverride(new Date("2025-12-31"), null), false);
  });
});
