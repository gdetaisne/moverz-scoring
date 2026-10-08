import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluateLabelStatus, LABEL_MIN_SCORE } from "../src/label.js";
import { motifPrincipal } from "../src/motif.js";
import {
  isUnderBon,
  MOVER_LIST_SLOTS,
  moverListExclusionReason,
  moverListLabelScore,
  resolveMoverListCategory,
} from "../src/mover-list.js";

const reliable = (scoreGlobal: number) => ({ scoreGlobal, isReliable: true });

describe("qui est proposé au client", () => {
  it("4 places Confirmés, 6 places Dynamiques", () => {
    assert.deepEqual(MOVER_LIST_SLOTS, { confirme: 4, dynamique: 6 });
  });

  it("Confirmé dès 85 ; Dynamique STRICTEMENT au-dessus de 75 ; 75 n'entre pas", () => {
    assert.equal(LABEL_MIN_SCORE, 85);
    assert.equal(resolveMoverListCategory(reliable(85)), "confirme");
    assert.equal(resolveMoverListCategory(reliable(84)), "dynamique");
    assert.equal(resolveMoverListCategory(reliable(76)), "dynamique");
    assert.equal(resolveMoverListCategory(reliable(75)), null);
  });

  it("une note non fiable ne classe jamais, même haute", () => {
    assert.equal(resolveMoverListCategory({ scoreGlobal: 95, isReliable: false }), null);
    assert.equal(resolveMoverListCategory({ scoreGlobal: null, isReliable: true }), null);
  });

  it("un inscrit actif est toujours dans la liste, sans gagner de label", () => {
    assert.equal(resolveMoverListCategory({ scoreGlobal: 62, isReliable: true, enrolled: true }), "dynamique");
    assert.equal(resolveMoverListCategory({ scoreGlobal: 91, isReliable: true, enrolled: true }), "confirme");
    assert.equal(moverListLabelScore(reliable(62)), null, "jamais « Correct » sous les yeux du client");
    assert.equal(isUnderBon(reliable(69)), true);
    assert.equal(isUnderBon(reliable(70)), false);
  });

  it("entreprise fermée, cessée ou en procédure : exclue avant toute note", () => {
    const base = { blacklisted: false, companyClosed: false, companyFragile: false, ...reliable(92) };
    assert.equal(moverListExclusionReason(base), null);
    assert.equal(moverListExclusionReason({ ...base, companyFragile: true }), "company-fragile");
    assert.equal(moverListExclusionReason({ ...base, companyClosed: true }), "company-closed");
    assert.equal(moverListExclusionReason({ ...base, scoreGlobal: 70 }), "no-category");
  });
});

describe("label Excellent", () => {
  const current = { scoreGlobal: 90, scoreGlobalLabel: "Excellent", isReliable: true };
  const ok = { blacklisted: false, optOut: false, hasEmail: true, onTransportRegister: true, companyFragile: false, current };

  it("score fiable ≥ 85, au registre, joignable : actif", () => {
    assert.deepEqual(evaluateLabelStatus(ok), { status: "ACTIVE", eligible: true, reason: "eligible" });
  });

  it("aucun score ne rachète une société en procédure ou hors registre", () => {
    assert.equal(evaluateLabelStatus({ ...ok, companyFragile: true }).reason, "company_not_active");
    assert.equal(evaluateLabelStatus({ ...ok, onTransportRegister: false }).reason, "not_on_transport_register");
  });

  it("donnée manquante : en attente, pas refusé", () => {
    assert.equal(evaluateLabelStatus({ ...ok, hasEmail: false }).status, "TEMPORARILY_UNAVAILABLE");
    assert.equal(evaluateLabelStatus({ ...ok, current: { ...current, isReliable: false } }).reason, "score_not_reliable");
    assert.equal(evaluateLabelStatus({ ...ok, current: null }).reason, "score_missing");
    assert.equal(evaluateLabelStatus({ ...ok, onTransportRegister: undefined }).eligible, true, "registre jamais lu : on ne tranche pas");
  });

  it("84 : pas Excellent", () => {
    assert.equal(evaluateLabelStatus({ ...ok, current: { scoreGlobal: 84, scoreGlobalLabel: "Bon", isReliable: true } }).reason, "score_below_excellent");
  });
});

describe("motif principal", () => {
  it("la composante qui coûte le plus de points, pas la plus basse", () => {
    // Juridique 40 (12,5 %) coûte 7,5 points ; vigilance 60 (35 %) en coûte 14.
    const m = motifPrincipal({ financial: 90, juridical: 40, google: 90, reputation: 90, vigilance: 60 });
    assert.equal(m.motif, "incidents signalés dans les avis");
    assert.equal(m.perte, 14);
  });

  it("l'écart avec le second dit si une seule raison explique la note", () => {
    assert.ok(motifPrincipal({ financial: 70, juridical: 70, google: 70, reputation: 70, vigilance: 88 }).ecartSecond < 3);
    assert.ok(motifPrincipal({ financial: 95, juridical: 95, google: 95, reputation: 95, vigilance: 10 }).ecartSecond > 20);
  });

  it("une composante absente n'est pas un zéro ; rien du tout, pas de motif", () => {
    assert.equal(motifPrincipal({ financial: null, juridical: 90, google: 80, reputation: 90, vigilance: 95 }).motif, "note et volume Google");
    assert.equal(motifPrincipal({}).motif, "");
  });
});
