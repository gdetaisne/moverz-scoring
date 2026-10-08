import assert from "node:assert/strict";
import test from "node:test";
import { extractCompanyHealth } from "../src/company-health.js";

test("detecte une entreprise cessee et radiee", () => {
  const h = extractCompanyHealth({
    entreprise_cessee: true,
    statut_consolide: "cessé",
    statut_rcs: "Radié",
    statut_rne: "Radié",
    date_cessation: "2024-09-02",
    date_radiation_rcs: "2024-11-20",
  });

  assert.equal(h.cessee, true);
  assert.equal(h.radiee, true);
  assert.equal(h.fragile, true);
  assert.equal(h.dateRadiation, "2024-11-20");
  assert.match(h.resume ?? "", /radiée du registre/);
});

test("detecte une procedure collective en cours", () => {
  const h = extractCompanyHealth({
    procedure_collective_en_cours: true,
    procedures_collectives: [{ type: "Redressement judiciaire" }],
  });

  assert.equal(h.procedureCollectiveEnCours, true);
  assert.equal(h.fragile, true);
  assert.deepEqual(h.procedures, ["Redressement judiciaire"]);
  assert.match(h.resume ?? "", /en cours/);
});

test("repere une procedure annoncee au BODACC", () => {
  const h = extractCompanyHealth({
    publications_bodacc: [
      { type: "Jugement d'ouverture de liquidation judiciaire", date: "2025-03-01" },
      { type: "Modification de capital" },
    ],
  });

  assert.equal(h.fragile, true);
  assert.equal(h.procedures.length, 1);
});

test("entreprise saine : aucun signal", () => {
  const h = extractCompanyHealth({
    entreprise_cessee: false,
    statut_rcs: "Inscrit",
    procedure_collective_en_cours: false,
    procedure_collective_existe: false,
    procedures_collectives: [],
    publications_bodacc: [{ type: "Modification de capital" }],
  });

  assert.equal(h.fragile, false);
  assert.equal(h.resume, null);
});
