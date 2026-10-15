import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyRegisterCap,
  departmentOfPostalCode,
  findSitrSuccessorCandidates,
  identityFromRegistry,
  knownPersonsFromRegistry,
  normalizeCompanyName,
  liftsRegisterCap,
  personMatchesRegisterName,
  REGISTER_ABSENT_MAX_SCORE,
  registerSuccessorWarnings,
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

  it("option A (15/10/2026) — société sœur : même gérant et même commune, aucun mot du nom en commun, à vérifier, plafond gardé", () => {
    const sister: SitrDirectoryEntry[] = [
      entry({ siren: "900000070", raisonSociale: "ORTOLAN STRASBOURG", postalCode: "67450", commune: "LAMPERTHEIM", manager: "ORTOLAN JEAN" }),
    ];
    const found = findSitrSuccessorCandidates({
      directory: sister,
      ownSiren: "800000090",
      names: ["Carton Malin"],
      places: [{ postalCode: "67450", commune: "Lampertheim" }],
      managers: [{ lastName: "Ortolan", firstNames: "Jean-Charles" }],
    });
    assert.deepEqual(found.map((c) => [c.siren, c.reason]), [["900000070", "same_manager_same_commune"]]);
    assert.match(found[0]?.evidence ?? "", /à vérifier/);
    assert.equal(liftsRegisterCap(found[0]!), false);
    const cap = applyRegisterCap({ globalScore: 82, verdict: "zero", successors: found });
    assert.equal(cap.score, REGISTER_ABSENT_MAX_SCORE);
    assert.equal(cap.liftedBySuccessor, false);
    assert.deepEqual(registerSuccessorWarnings(found), ["sitr_successor_to_review:900000070"]);
  });

  it("option A (15/10/2026) — même nom et même code postal : plafond levé ; gérant et mot du nom en commun : levé aussi", () => {
    const byName = findSitrSuccessorCandidates({
      directory: DIRECTORY,
      ownSiren: "800000001",
      names: ["Déménagement Exemplaire"],
      places: [{ postalCode: "69007", commune: "Ailleurs" }],
      managers: [],
    });
    assert.deepEqual(byName.map((c) => [c.siren, c.reason]), [["900000002", "same_name_same_place"]]);
    assert.equal(applyRegisterCap({ globalScore: 82, verdict: "zero", successors: byName }).liftedBySuccessor, true);
    assert.deepEqual(registerSuccessorWarnings(byName), ["sitr_successor_candidate:900000002"]);
    const byManager = findSitrSuccessorCandidates({
      directory: [entry({ siren: "900000071", raisonSociale: "LUMEN TRANSPORTS", postalCode: "34000", commune: "MONTPELLIER", manager: "MERLE ANNE" })],
      ownSiren: "800000091",
      names: ["Lumen Déménagement"],
      places: [{ postalCode: "34170", commune: "Castelnau-le-Lez" }],
      managers: [{ lastName: "Merle", firstNames: "Anne" }],
    });
    assert.deepEqual(byManager.map((c) => c.reason), ["same_manager_same_department"]);
    assert.equal(applyRegisterCap({ globalScore: 82, verdict: "zero", successors: byManager }).liftedBySuccessor, true);
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
    // Le nom du gérant dans les deux noms ne prouve rien (15/10/2026) : sans la même
    // commune, pas de correspondance.
    const byManager = findSitrSuccessorCandidates({
      directory: DIRECTORY,
      ownSiren: "800000002",
      names: registry.names,
      places: [{ postalCode: "35510", commune: "Cesson-Sevigne" }],
      managers: knownPersonsFromRegistry(registryRaw),
    });
    assert.deepEqual(byManager.map((c) => c.siren), []);
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
      evidence: "même nom",
    };
    assert.deepEqual(applyRegisterCap({ globalScore: 82, verdict: "zero", successors: [] }), {
      score: REGISTER_ABSENT_MAX_SCORE,
      capped: true,
      liftedBySuccessor: false,
      ambiguous: false,
    });
    assert.deepEqual(applyRegisterCap({ globalScore: 82, verdict: "zero", successors: [candidate] }), {
      score: 82,
      capped: false,
      liftedBySuccessor: true,
      ambiguous: false,
    });
    // Annuaire illisible : pas de plafond (15/10/2026), le calcul est refait au passage suivant.
    assert.deepEqual(applyRegisterCap({ globalScore: 82, verdict: "zero", successors: null }), {
      score: 82,
      capped: false,
      liftedBySuccessor: false,
      ambiguous: false,
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
      entry({ siren: "900000013", raisonSociale: "TRANSPORTS LUMEN", postalCode: "13008", commune: "MARSEILLE", manager: "MARTIN JEAN" }),
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
        names: ["Lumen Déménagement"],
        places: [{ postalCode: "13001", commune: "Marseille" }],
        managers: [{ lastName: "Martin", firstNames: "Jean" }],
      }).map((c) => c.siren),
      ["900000013"],
    );
  });

  it("mots génériques (15/10/2026) : un nom fait seulement de ces mots ne correspond à personne", () => {
    // Trois sociétés fictives d'un même réseau, inscrites, avec un même gérant.
    const network: SitrDirectoryEntry[] = [
      entry({ siren: "900000030", raisonSociale: "FRANCE DEMENAGEMENT NO", postalCode: "73000", commune: "CHAMBERY", manager: "PRIMEVERE MARC" }),
      entry({ siren: "900000031", raisonSociale: "FRANCE DEMENAGEMENT GROUP", postalCode: "73000", commune: "CHAMBERY", manager: "PRIMEVERE MARC" }),
      entry({ siren: "900000032", raisonSociale: "FRANCE DEMENAGEMENT AIN-RHONE", postalCode: "69800", commune: "SAINT-PRIEST", manager: "PRIMEVERE MARC" }),
      entry({ siren: "900000033", raisonSociale: "VENDEE DEMENAGEMENT", postalCode: "85000", commune: "LA ROCHE-SUR-YON", manager: "BOUTON PAUL" }),
    ];
    const find = (names: string[], postalCode: string, commune: string, managers: Array<{ lastName: string; firstNames: string }> = []) =>
      findSitrSuccessorCandidates({ directory: network, ownSiren: "800000098", names, places: [{ postalCode, commune }], managers }).map((c) => c.siren);
    // Aucun mot distinctif : ni le nom, ni le gérant sans même commune, ne rapprochent.
    assert.deepEqual(find(["France Déménagement"], "83000", "Toulon", [{ lastName: "Primevère", firstNames: "Marc" }]), []);
    assert.deepEqual(find(["France Déménagement"], "73000", "Chambéry"), []);
    assert.deepEqual(find(["Haute-Savoie Déménagement"], "74000", "Annecy", [{ lastName: "Primevère", firstNames: "Marc" }]), []);
    // « Vendée Déménagement » : même nom, même commune, mais aucun mot distinctif.
    assert.deepEqual(find(["Vendée Déménagement"], "85000", "La Roche-sur-Yon"), []);
  });

  it("deux SIREN candidats (15/10/2026) : ambigu, le plafond reste", () => {
    const two: SitrDirectoryEntry[] = [
      entry({ siren: "900000040", raisonSociale: "MARMOTTE ALSACE", postalCode: "67500", commune: "HAGUENAU", manager: "ORTOLAN JEAN" }),
      entry({ siren: "900000041", raisonSociale: "MONDIAL MARMOTTE", postalCode: "67100", commune: "STRASBOURG", manager: "ORTOLAN JEAN" }),
    ];
    const found = findSitrSuccessorCandidates({
      directory: two,
      ownSiren: "800000097",
      names: ["Marmotte Strasbourg déménagement et logistique"],
      places: [{ postalCode: "67000", commune: "Strasbourg" }],
      managers: [{ lastName: "Ortolan", firstNames: "Jean" }],
    });
    assert.deepEqual(found.map((c) => c.siren), ["900000040", "900000041"]);
    assert.deepEqual(applyRegisterCap({ globalScore: 82, verdict: "zero", successors: found }), {
      score: REGISTER_ABSENT_MAX_SCORE,
      capped: true,
      liftedBySuccessor: false,
      ambiguous: true,
    });
  });

  it("un gérant à plusieurs sociétés : son nom ne suffit pas, le siège d'un réseau non plus (15/10/2026)", () => {
    const directory: SitrDirectoryEntry[] = [
      entry({ siren: "900000060", raisonSociale: "ORTOLAN STRASBOURG", postalCode: "67450", commune: "LAMPERTHEIM", manager: "ORTOLAN JEAN" }),
      entry({ siren: "900000061", raisonSociale: "RESEAU LUMEN GROUP", postalCode: "73000", commune: "CHAMBERY", manager: "PRIMEVERE MARC" }),
    ];
    // Fiche « Carton Malin » à Strasbourg, gérée par la même personne : autre société, autre commune.
    assert.deepEqual(
      findSitrSuccessorCandidates({
        directory,
        ownSiren: "800000095",
        names: ["Carton Malin", "ORTOLAN JEAN"],
        places: [{ postalCode: "67000", commune: "Strasbourg" }],
        managers: [{ lastName: "Ortolan", firstNames: "Jean" }],
      }),
      [],
    );
    // Agence de Toulon d'un réseau dont le siège est à Chambéry : la preuve par le gérant ne regarde que l'adresse de la fiche.
    assert.deepEqual(
      findSitrSuccessorCandidates({
        directory,
        ownSiren: "800000094",
        names: ["Lumen Toulon"],
        places: [
          { postalCode: "83000", commune: "Toulon" },
          { postalCode: "73000", commune: "Chambéry" },
        ],
        managers: [{ lastName: "Primevère", firstNames: "Marc" }],
      }),
      [],
    );
  });

  it("chaque correspondance dit pourquoi, en clair (15/10/2026)", () => {
    const [byName] = findSitrSuccessorCandidates({
      directory: DIRECTORY,
      ownSiren: "800000001",
      names: ["Déménagement Exemplaire"],
      places: [{ postalCode: "69007", commune: "Lyon" }],
      managers: [],
    });
    assert.equal(byName?.evidence, "même nom (« DEMENAGEMENT EXEMPLAIRE »), même code postal");
    const [byManager] = findSitrSuccessorCandidates({
      directory: DIRECTORY,
      ownSiren: "800000001",
      names: ["Les Déménageurs du Parc"],
      places: [{ postalCode: "69003", commune: "Lyon" }],
      managers: [{ lastName: "Leblanc", firstNames: "Marc" }],
    });
    assert.equal(byManager?.evidence, "même gérant (LEBLANC MARC), même commune (LYON), aucun mot du nom en commun : à vérifier");
  });

  it("normalisation des noms et des départements", () => {
    assert.equal(normalizeCompanyName("EXEMPLAIRE - Déménagements SARL"), normalizeCompanyName("exemplaire demenagement"));
    assert.equal(departmentOfPostalCode("20090"), "2A");
    assert.equal(departmentOfPostalCode("20600"), "2B");
    assert.equal(departmentOfPostalCode("97351"), "973");
    assert.equal(departmentOfPostalCode("3457"), null);
  });
});
