import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nameOverlap } from "../src/google-matching.js";
import { buildPappersDecisions, buildPappersSnapshot, mapNativeFinancialScore, pappersLookupParam } from "../src/pappers.js";
import { buildSnapshot, parseFrDate, rowToEstablishment, sirenFromMover } from "../src/transport-register.js";
import { sitrJuridicalVerdict } from "../src/sitr-juridical.js";
import { NOW } from "./helpers.js";

describe("Pappers — identifiant d'appel", () => {
  it("un SIRET à 14 chiffres part en siret (espaces retirés)", () => {
    assert.deepEqual(pappersLookupParam({ siret: "123 456 789 00017", siren: "123456789" }), { param: "siret", value: "12345678900017" });
  });

  it("un « SIRET » à 9 chiffres part en siren (Pappers refuse siret=<9 chiffres> en 400)", () => {
    assert.deepEqual(pappersLookupParam({ siret: "123456789", siren: null }), { param: "siren", value: "123456789" });
  });

  it("un SIRET mal formé cède la place au SIREN de la fiche", () => {
    assert.deepEqual(pappersLookupParam({ siret: "12345", siren: "987654321" }), { param: "siren", value: "987654321" });
  });

  it("rien d'exploitable : pas d'appel (un appel est payant)", () => {
    assert.equal(pappersLookupParam({ siret: "12345", siren: null }), null);
    assert.equal(pappersLookupParam({ siret: null, siren: undefined }), null);
  });
});

describe("Pappers — lecture de la réponse", () => {
  it("le scoring natif sur 20 est ramené sur 100 et passe avant notre formule", () => {
    assert.equal(mapNativeFinancialScore(14), 70);
    const snap = buildPappersSnapshot({ scoring_financier: { score: 14 }, finances: [{ resultat: -1000 }] }, { now: NOW });
    assert.equal(snap.financialScore, 70);
    assert.equal(snap.financialSource, "pappers_native");
  });

  it("sans bilan publié : financier null (l'exception à 50 se décide plus loin), juridique 100", () => {
    const snap = buildPappersSnapshot({ finances: [], decisions: [] }, { now: NOW });
    assert.equal(snap.available, true);
    assert.equal(snap.financialScore, null);
    assert.equal(snap.juridicalScore, 100);
  });

  it("une procédure collective en cours devient une décision récente et grave : −25 −15", () => {
    // Corrigé le 08/10/2026 : « procédure collective » fait partie des mots graves. L'exclusion
    // forte de ces entreprises passe toujours par `company-health.ts`, pas par la note.
    const raw = { procedure_collective_en_cours: true, procedures_collectives: [{ date_debut: "2026-05-12" }], decisions: [] };
    assert.equal(buildPappersDecisions(raw, NOW)[0].dispositif, "Procédure collective en cours");
    assert.equal(buildPappersSnapshot(raw, { now: NOW }).juridicalScore, 60);
  });
});

describe("registre des transporteurs (SITR)", () => {
  it("une ligne du CSV ministériel devient un établissement typé", () => {
    const est = rowToEstablishment({
      SIRET: "123 456 789 00017",
      Raison_sociale: " DEMENAGEMENTS EXEMPLE ",
      Code_Postal: "69007",
      Commune: "LYON",
      Siege_O_N: "o",
      Numero_LTI: "2021 00 0001",
      Date_debut_validite_LTI: "01/01/2021",
      Date_fin_validite_LTI: "31/12/2030",
      Nombre_de_copies_LTI_valides: "3",
    });
    assert.equal(est.siret, "12345678900017");
    assert.equal(est.siege, true);
    assert.equal(est.ltiFin, "2030-12-31");
    assert.equal(est.ltiCopies, 3);
    assert.equal(est.lcNumero, null);
  });

  it("dates françaises seulement ; SIREN tiré du SIRET à défaut", () => {
    assert.equal(parseFrDate("2030-12-31"), null);
    assert.equal(sirenFromMover({ siren: null, siret: "12345678900017" }), "123456789");
    assert.equal(sirenFromMover({ siren: "12", siret: null }), null);
  });

  it("l'instantané préfère le SIRET exact, puis le siège ; absent du registre → juridique à zéro", () => {
    const rows = [
      rowToEstablishment({ SIRET: "12345678900025", Siege_O_N: "N" }),
      rowToEstablishment({ SIRET: "12345678900017", Siege_O_N: "O", Date_fin_validite_LTI: "31/12/2030" }),
    ];
    const exact = buildSnapshot({ situationAu: "2026-09-28", siren: "123456789", moverSiret: "12345678900025", marchandises: rows, commissionnaireSiret: null });
    assert.equal(exact.matchKind, "siret");
    const siege = buildSnapshot({ situationAu: "2026-09-28", siren: "123456789", moverSiret: null, marchandises: rows, commissionnaireSiret: null });
    assert.equal(siege.matchKind, "siren_siege");
    assert.equal(sitrJuridicalVerdict(siege), "ok");
    const absent = buildSnapshot({ situationAu: "2026-09-28", siren: "123456789", moverSiret: null, marchandises: [], commissionnaireSiret: null });
    assert.equal(sitrJuridicalVerdict(absent), "zero");
  });
});

describe("rattachement d'une fiche Google", () => {
  it("accepte des mots intercalés par Google et les accents", () => {
    assert.equal(nameOverlap("Exemplum Réseau Déménagement Lyon", "EXEMPLUM LYON", "VILLEURBANNE"), true);
    assert.equal(nameOverlap("Déménagements Élysée", "DEMENAGEMENTS ELYSEE", "CLERMONT-FERRAND"), true);
  });

  it("refuse les entreprises distinctes : ce serait noter l'un avec les avis de l'autre", () => {
    assert.equal(nameOverlap("Exemplum Déménagement Lyon", "MODELE TRANSPORTS", "LYON"), false);
    assert.equal(nameOverlap("Transports Fictif", "FICTIF JEAN TRANSPORT", null), false);
  });

  it("exige un jeton distinctif : ni un mot du secteur, ni le nom de la commune", () => {
    assert.equal(nameOverlap("Lyon Déménagement", "DEMENAGEMENTS FICTIF LYON", "LYON"), false);
    assert.equal(nameOverlap("Déménagements Services", "TRANSPORTS SERVICES", "LYON"), false);
  });

  it("conserve les rapprochements exacts et par inclusion", () => {
    assert.equal(nameOverlap("AXEMPLE", "AXEMPLE", "LYON"), true);
    assert.equal(nameOverlap("Exemplum - Déménagement d'entreprise", "EXEMPLUM", "LYON"), true);
  });
});
