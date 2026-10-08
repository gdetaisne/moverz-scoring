import { z } from "zod";

/**
 * Registre des transporteurs (SITR) — registre électronique national des
 * entreprises de transport par route et des commissionnaires de transport,
 * publié en CSV par le ministère chargé des transports.
 *
 * Un déménageur transporte les biens de ses clients pour compte d'autrui : il
 * doit y être inscrit, avec une licence en cours de validité — licence de
 * transport intérieur (LTI, véhicules de 3,5 t et moins) ou licence
 * communautaire (LC, au-delà). Un commissionnaire seul organise le transport
 * mais le sous-traite : ce n'est pas le même métier, ni la même responsabilité.
 *
 * Ce module transforme les lignes du CSV en un instantané validé (zod) par
 * entreprise. Le téléchargement des fichiers n'est pas ici.
 */

export const sitrEstablishmentSchema = z.object({
  siret: z.string(),
  raisonSociale: z.string(),
  postalCode: z.string().nullable(),
  commune: z.string().nullable(),
  siege: z.boolean(),
  ltiNumero: z.string().nullable(),
  ltiDebut: z.string().nullable(),
  ltiFin: z.string().nullable(),
  ltiCopies: z.number().nullable(),
  lcNumero: z.string().nullable(),
  lcDebut: z.string().nullable(),
  lcFin: z.string().nullable(),
  lcCopies: z.number().nullable(),
  lcVulCopies: z.number().nullable(),
});

export const transportRegisterSnapshotSchema = z.object({
  source: z.literal("sitr"),
  situationAu: z.string(),
  ingestedAt: z.string(),
  matched: z.boolean(),
  matchKind: z.enum(["siret", "siren_siege", "siren", "none"]),
  siren: z.string().nullable(),
  noSiren: z.boolean(),
  inMarchandises: z.boolean(),
  inCommissionnaires: z.boolean(),
  etablissementsCount: z.number().int(),
  marchandises: sitrEstablishmentSchema.nullable(),
  commissionnaireSiret: z.string().nullable(),
});

export type SitrEstablishment = z.infer<typeof sitrEstablishmentSchema>;
export type TransportRegisterSnapshot = z.infer<typeof transportRegisterSnapshotSchema>;

const SIREN_RE = /^\d{9}$/;
const SIRET_RE = /^\d{14}$/;

export function digitsOnly(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

export function sirenFromMover(input: { siren?: string | null; siret?: string | null }): string | null {
  const siren = digitsOnly(input.siren);
  if (SIREN_RE.test(siren)) return siren;
  const siret = digitsOnly(input.siret);
  if (SIRET_RE.test(siret)) return siret.slice(0, 9);
  return null;
}

export function parseFrDate(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

export function parseSituationAu(headerCell: string): string {
  const match = /(\d{2})\/(\d{2})\/(\d{4})/.exec(headerCell);
  if (!match) throw new Error(`Date SITR introuvable dans l'en-tête: ${headerCell}`);
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function toInt(value: string | null | undefined): number | null {
  const raw = value?.trim();
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export function rowToEstablishment(row: Record<string, string>): SitrEstablishment {
  return {
    siret: digitsOnly(row.SIRET),
    raisonSociale: row.Raison_sociale?.trim() ?? "",
    postalCode: row.Code_Postal?.trim() || null,
    commune: row.Commune?.trim() || null,
    siege: row.Siege_O_N?.trim().toUpperCase() === "O",
    ltiNumero: row.Numero_LTI?.trim() || null,
    ltiDebut: parseFrDate(row.Date_debut_validite_LTI),
    ltiFin: parseFrDate(row.Date_fin_validite_LTI),
    ltiCopies: toInt(row.Nombre_de_copies_LTI_valides),
    lcNumero: row.Numero_LC?.trim() || null,
    lcDebut: parseFrDate(row.Date_debut_validite_LC),
    lcFin: parseFrDate(row.Date_fin_validite_LC),
    lcCopies: toInt(row.Nombre_de_copies_LC_valides),
    lcVulCopies: toInt(row["dont Nombre_de_copies_LC_VUL_valides <= 3,5t"]),
  };
}

export function pickEstablishment(
  rows: SitrEstablishment[],
  moverSiret: string | null,
): { row: SitrEstablishment; matchKind: "siret" | "siren_siege" | "siren" } | null {
  if (!rows.length) return null;
  const siret = digitsOnly(moverSiret);
  if (SIRET_RE.test(siret)) {
    const exact = rows.find((row) => row.siret === siret);
    if (exact) return { row: exact, matchKind: "siret" };
  }
  const siege = rows.find((row) => row.siege);
  if (siege) return { row: siege, matchKind: "siren_siege" };
  return { row: rows[0], matchKind: "siren" };
}

export function buildSnapshot(input: {
  situationAu: string;
  ingestedAt?: string;
  siren: string | null;
  moverSiret: string | null;
  marchandises: SitrEstablishment[];
  commissionnaireSiret: string | null;
}): TransportRegisterSnapshot {
  const picked = pickEstablishment(input.marchandises, input.moverSiret);
  return transportRegisterSnapshotSchema.parse({
    source: "sitr",
    situationAu: input.situationAu,
    ingestedAt: input.ingestedAt ?? new Date().toISOString(),
    matched: Boolean(picked),
    matchKind: picked?.matchKind ?? "none",
    siren: input.siren,
    noSiren: !input.siren,
    inMarchandises: Boolean(picked),
    inCommissionnaires: Boolean(input.commissionnaireSiret),
    etablissementsCount: input.marchandises.length,
    marchandises: picked?.row ?? null,
    commissionnaireSiret: input.commissionnaireSiret,
  });
}
