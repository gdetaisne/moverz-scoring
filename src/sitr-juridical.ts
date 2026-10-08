import { transportRegisterSnapshotSchema } from "./transport-register.js";

/**
 * Le registre des transporteurs écrase le score juridique.
 *
 * Un déménageur absent du registre, dont la licence est périmée, ou inscrit
 * seulement comme commissionnaire, exerce sans le titre qui l'autorise à
 * transporter les biens d'un client. Aucune absence de contentieux ne rachète
 * ça : le juridique passe à 0. Sans SIREN, on ne peut pas chercher : on ne
 * tranche pas (`unknown`) plutôt que de condamner sur une donnée manquante.
 */
export type SitrJuridicalVerdict = "ok" | "zero" | "unknown";

/** Licence active si l'une des deux (LTI ou LC) court encore à la date du fichier. Aucune date de fin : active. */
function licenceActive(ltiFin: string | null, lcFin: string | null, asOf: string): boolean {
  const ends = [ltiFin, lcFin].filter((d): d is string => Boolean(d));
  if (ends.length === 0) return true;
  return ends.some((d) => d >= asOf);
}

/** Absent / périmé / commissionnaire seul → zero. Pas de SIREN ou instantané illisible → unknown. */
export function sitrJuridicalVerdict(raw: unknown): SitrJuridicalVerdict {
  const parsed = transportRegisterSnapshotSchema.safeParse(raw);
  if (!parsed.success) return "unknown";
  const snap = parsed.data;
  if (snap.noSiren || !snap.siren) return "unknown";
  if (!snap.inMarchandises || !snap.marchandises) return "zero";
  if (!licenceActive(snap.marchandises.ltiFin, snap.marchandises.lcFin, snap.situationAu)) {
    return "zero";
  }
  return "ok";
}

/** Si le registre met le critère à zéro, le score juridique du registre des entreprises est écrasé. */
export function applySitrToJuridicalScore(pappersJuridical: number | null, transportRegister: unknown): number | null {
  if (pappersJuridical == null) return null;
  if (sitrJuridicalVerdict(transportRegister) === "zero") return 0;
  return pappersJuridical;
}

/**
 * Entreprise fermée au répertoire Sirene (état administratif « cessé ») :
 * juridique à 0. Une note juridique « propre » d'une société qui n'existe plus
 * serait un mensonge par omission. `null` reste `null` : on n'invente rien.
 */
export function applyClosedToJuridicalScore(juridical: number | null, closed: boolean): number | null {
  if (juridical == null) return null;
  return closed ? 0 : juridical;
}
