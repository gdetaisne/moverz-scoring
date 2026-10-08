import assert from "node:assert/strict";
import test from "node:test";
import { applySitrToJuridicalScore, sitrJuridicalVerdict } from "../src/sitr-juridical.js";
import type { TransportRegisterSnapshot } from "../src/transport-register.js";

function snap(over: Partial<TransportRegisterSnapshot>): TransportRegisterSnapshot {
  return {
    source: "sitr",
    situationAu: "2026-08-30",
    ingestedAt: "2026-08-31T00:00:00.000Z",
    matched: true,
    matchKind: "siren",
    siren: "123456789",
    noSiren: false,
    inMarchandises: true,
    inCommissionnaires: false,
    etablissementsCount: 1,
    marchandises: {
      siret: "12345678900011",
      raisonSociale: "TEST",
      postalCode: "69007",
      commune: "LYON",
      siege: true,
      ltiNumero: "2023 1",
      ltiDebut: "2023-01-01",
      ltiFin: "2030-01-01",
      ltiCopies: 2,
      lcNumero: null,
      lcDebut: null,
      lcFin: null,
      lcCopies: 0,
      lcVulCopies: 0,
    },
    commissionnaireSiret: null,
    ...over,
  };
}

test("SITR ok : juri Pappers inchangé", () => {
  assert.equal(sitrJuridicalVerdict(snap({})), "ok");
  assert.equal(applySitrToJuridicalScore(100, snap({})), 100);
  assert.equal(applySitrToJuridicalScore(60, snap({})), 60);
});

test("pas de SIREN : on ne touche pas", () => {
  const raw = snap({ noSiren: true, siren: null, matched: false, matchKind: "none", inMarchandises: false, marchandises: null });
  assert.equal(sitrJuridicalVerdict(raw), "unknown");
  assert.equal(applySitrToJuridicalScore(100, raw), 100);
});

test("absent du registre : juri = 0", () => {
  const raw = snap({
    matched: false,
    matchKind: "none",
    inMarchandises: false,
    marchandises: null,
  });
  assert.equal(sitrJuridicalVerdict(raw), "zero");
  assert.equal(applySitrToJuridicalScore(100, raw), 0);
});

test("commissionnaire only : juri = 0", () => {
  const raw = snap({
    matched: false,
    matchKind: "none",
    inMarchandises: false,
    inCommissionnaires: true,
    marchandises: null,
    commissionnaireSiret: "12345678900011",
  });
  assert.equal(sitrJuridicalVerdict(raw), "zero");
  assert.equal(applySitrToJuridicalScore(85, raw), 0);
});

test("licence périmée : juri = 0", () => {
  const raw = snap({
    marchandises: {
      siret: "12345678900011",
      raisonSociale: "TEST",
      postalCode: "69007",
      commune: "LYON",
      siege: true,
      ltiNumero: "2018 1",
      ltiDebut: "2018-01-01",
      ltiFin: "2024-01-01",
      ltiCopies: 1,
      lcNumero: "2018 2",
      lcDebut: "2018-01-01",
      lcFin: "2024-06-01",
      lcCopies: 1,
      lcVulCopies: 0,
    },
  });
  assert.equal(sitrJuridicalVerdict(raw), "zero");
  assert.equal(applySitrToJuridicalScore(100, raw), 0);
});

test("Pappers null : on ne invente pas de juri", () => {
  const raw = snap({ matched: false, matchKind: "none", inMarchandises: false, marchandises: null });
  assert.equal(applySitrToJuridicalScore(null, raw), null);
});
