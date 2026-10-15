import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyRegisterCap,
  departmentOfPostalCode,
  findSitrSuccessorCandidates,
  identityFromRegistry,
  knownPersonsFromRegistry,
  normalizeCompanyName,
  personMatchesRegisterName,
  REGISTER_ABSENT_MAX_SCORE,
  type SitrDirectoryEntry,
} from "../src/register-cap.js";

/**
 * Absence au registre des transporteurs (14/10/2026). Données fictives : les deux
 * formes qui ont motivé la règle.
 *  - « société reprise » : la fiche porte l'ancien SIREN, l'entreprise est inscrite
 *    sous le SIREN de la nouvelle société, même nom, même commune, même gérant ;
 *  - « entreprise individuelle fermée » : l'EI du gérant est fermée, la société qu'il
 *    a créée ensuite est inscrite, dans le même département.
 */
const entry = (over: Partial<SitrDirectoryEntry>): SitrDirectoryEntry => ({
  siren: "900000001",
  raisonSociale: "TRANSPORTS AUTRE",
  postalCode: "75011",
  commune: "PARIS",
  manager: "DURAND JEAN",
  register: "marchandises",
  ...over,
});

const DIRECTORY: SitrDirectoryEntry[] = [
  entry({}),
  // Forme 1 : société reprise.
  entry({ siren: "900000002", raisonSociale: "DEMENAGEMENT EXEMPLAIRE", postalCode: "69007", commune: "LYON", manager: "LEBLANC MARC" }),
  // Forme 2 : EI fermée, société créée ensuite par le même gérant.
  entry({ siren: "900000003", raisonSociale: "NOIRET DEMENAGEMENT", postalCode: "35200", commune: "RENNES", manager: "NOIRET CLAIRE" }),
  // Même nom qu'une fiche, mais à l'autre bout de la France.
  entry({ siren: "900000004", raisonSociale: "DEMENAGEMENT EXEMPLAIRE", postalCode: "59000", commune: "LILLE", manager: "MARTIN PAUL" }),
  // Nom générique dans la même commune qu'une fiche.
  entry({ siren: "900000005", raisonSociale: "DEMENAGEMENT", postalCode: "35200", commune: "RENNES", manager: "PETIT LUC" }),
];

describe("absence au registre des transporteurs : un autre SIREN ? (14/10/2026)", () => {
  it("société reprise : même nom et même lieu que la fiche", () => {
    const found = findSitrSuccessorCandidates({
      directory: DIRECTORY,
      ownSiren: "800000001",
      names: ["EXEMPLAIRE", "Déménagement Exemplaire"],
      places: [{ postalCode: "69007", commune: "Lyon" }],
      managers: [],
    });
    assert.deepEqual(
      found.map((c) => [c.siren, c.reason]),
      [["900000002", "same_name_same_place"]],
    );
  });

  it("société reprise : le gérant connu, dans le même département, avec un mot du nom en commun", () => {
    const found = findSitrSuccessorCandidates({
      directory: DIRECTORY,
      ownSiren: "800000001",
      names: ["Exemplaire Transports"],
      places: [{ postalCode: "69100", commune: "Villeurbanne" }],
      managers: [{ lastName: "Leblanc", firstNames: "Marc Henri" }],
    });
    assert.deepEqual(
      found.map((c) => [c.siren, c.reason]),
      [["900000002", "same_manager_same_department"]],
    );
  });

  it("EI fermée : la personne de l'EI gère la société inscrite", () => {
    const registryRaw = {
      siren: "800000002",
      nom_entreprise: "CLAIRE NOIRET",
      nom: "NOIRET",
      prenom: "Claire",
      representants: [],
      siege: { code_postal: "35000", ville: "RENNES" },
    };
    const registry = identityFromRegistry(registryRaw);
    const found = findSitrSuccessorCandidates({
      directory: DIRECTORY,
      ownSiren: "800000002",
      names: ["NOIRET - Déménagement", ...registry.names],
      places: [{ postalCode: "35000", commune: "Rennes" }, ...registry.places],
      managers: knownPersonsFromRegistry(registryRaw),
    });
    // Même nom et même commune, et même gérant : une seule ligne, la preuve par le nom d'abord.
    assert.deepEqual(
      found.map((c) => [c.siren, c.reason]),
      [["900000003", "same_name_same_place"]],
    );
    // Autre commune du département : le gérant et un mot du nom en commun suffisent.
    const byManager = findSitrSuccessorCandidates({
      directory: DIRECTORY,
      ownSiren: "800000002",
      names: registry.names,
      places: [{ postalCode: "35510", commune: "Cesson-Sevigne" }],
      managers: knownPersonsFromRegistry(registryRaw),
    });
    assert.deepEqual(byManager.map((c) => c.siren), ["900000003"]);
  });

  it("pas de correspondance : autre département, nom générique, nom seul du gérant, son propre SIREN", () => {
    // Gérant homonyme dans un autre département.
    assert.deepEqual(
      findSitrSuccessorCandidates({
        directory: DIRECTORY,
        ownSiren: "800000003",
        names: [],
        places: [{ postalCode: "13001", commune: "Marseille" }],
        managers: [{ lastName: "Noiret", firstNames: "Claire" }],
      }),
      [],
    );
    // « Déménagement » seul ne désigne personne.
    assert.deepEqual(
      findSitrSuccessorCandidates({
        directory: DIRECTORY,
        ownSiren: "800000003",
        names: ["Déménagement"],
        places: [{ postalCode: "35200", commune: "Rennes" }],
        managers: [],
      }),
      [],
    );
    assert.equal(personMatchesRegisterName("NOIRET CLAIRE", { lastName: "Noiret", firstNames: null }), false);
    assert.equal(personMatchesRegisterName("NOIRET CLAIRE", { lastName: "Noiret", firstNames: "Julie" }), false);
    assert.deepEqual(
      findSitrSuccessorCandidates({
        directory: DIRECTORY,
        ownSiren: "900000003",
        names: ["Noiret Déménagement"],
        places: [{ postalCode: "35200", commune: "Rennes" }],
        managers: [],
      }),
      [],
    );
  });

  it("plafond à 65 sur une absence confirmée, levé par un autre SIREN, jamais sur un registre illisible", () => {
    const candidate = {
      siren: "900000002",
      raisonSociale: "X",
      postalCode: null,
      commune: null,
      register: "marchandises" as const,
      reason: "same_name_same_place" as const,
    };
    assert.deepEqual(applyRegisterCap({ globalScore: 82, verdict: "zero", successors: [] }), {
      score: REGISTER_ABSENT_MAX_SCORE,
      capped: true,
      liftedBySuccessor: false,
    });
    assert.deepEqual(applyRegisterCap({ globalScore: 82, verdict: "zero", successors: [candidate] }), {
      score: 82,
      capped: false,
      liftedBySuccessor: true,
    });
    // Annuaire illisible : pas de plafond (15/10/2026), le calcul est refait au passage suivant.
    assert.deepEqual(applyRegisterCap({ globalScore: 82, verdict: "zero", successors: null }), {
      score: 82,
      capped: false,
      liftedBySuccessor: false,
    });
    assert.equal(applyRegisterCap({ globalScore: 82, verdict: "unknown", successors: null }).score, 82);
    assert.equal(applyRegisterCap({ globalScore: 82, verdict: "ok", successors: null }).score, 82);
    assert.equal(applyRegisterCap({ globalScore: 60, verdict: "zero", successors: [] }).capped, false);
    assert.equal(applyRegisterCap({ globalScore: null, verdict: "zero", successors: [] }).score, null);
  });

  it("relecture du 15/10 — pas de faux positif : commune dans le nom, homonymes de commune, commissionnaire seul, gérant homonyme", () => {
    const directory: SitrDirectoryEntry[] = [
      entry({ siren: "900000010", raisonSociale: "PARIS DEMENAGEMENTS", postalCode: "75019", commune: "PARIS", manager: "DURAND PAUL" }),
      entry({ siren: "900000011", raisonSociale: "LUPIN DEMENAGEMENT", postalCode: "97490", commune: "SAINT-DENIS", manager: "LUPIN ARSENE" }),
      entry({ siren: "900000012", raisonSociale: "CORBEAU DEMENAGEMENT", postalCode: "69003", commune: "LYON", manager: "CORBEAU ANNE", register: "commissionnaires" }),
      entry({ siren: "900000013", raisonSociale: "TRANSPORTS AZUR", postalCode: "13008", commune: "MARSEILLE", manager: "MARTIN JEAN" }),
    ];
    const none = (names: string[], postalCode: string, commune: string, managers: Array<{ lastName: string; firstNames: string }> = []) =>
      assert.deepEqual(findSitrSuccessorCandidates({ directory, ownSiren: "800000099", names, places: [{ postalCode, commune }], managers }), [], names.join());
    // « Paris » est une commune, pas un nom d'entreprise.
    none(["Paris Déménagement"], "75011", "Paris");
    // Saint-Denis (93) n'est pas Saint-Denis (974).
    none(["Lupin Déménagement"], "93200", "Saint-Denis");
    // Un commissionnaire seul ne transporte pas.
    none(["Corbeau Déménagement"], "69003", "Lyon");
    // Gérant homonyme dans le même département, autre commune, aucun mot du nom en commun.
    none(["Déménagements Provence"], "13100", "Aix-en-Provence", [{ lastName: "Martin", firstNames: "Jean" }]);
    // Le même gérant avec un mot du nom en commun, lui, est retenu.
    assert.deepEqual(
      findSitrSuccessorCandidates({
        directory,
        ownSiren: "800000099",
        names: ["Azur Déménagement"],
        places: [{ postalCode: "13001", commune: "Marseille" }],
        managers: [{ lastName: "Martin", firstNames: "Jean" }],
      }).map((c) => c.siren),
      ["900000013"],
    );
  });

  it("normalisation des noms et des départements", () => {
    assert.equal(normalizeCompanyName("EXEMPLAIRE - Déménagements SARL"), normalizeCompanyName("exemplaire demenagement"));
    assert.equal(departmentOfPostalCode("20090"), "2A");
    assert.equal(departmentOfPostalCode("20600"), "2B");
    assert.equal(departmentOfPostalCode("97351"), "973");
    assert.equal(departmentOfPostalCode("3457"), null);
  });
});
