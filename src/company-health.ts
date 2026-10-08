/**
 * Signaux de fragilité d'une entreprise, extraits du raw Pappers.
 *
 * Ces signaux ne sont pas des nuances de score : une entreprise cessée, radiée
 * ou en procédure collective ne doit jamais être recommandée à un client, quel
 * que soit son score par ailleurs. Ils servent donc à la fois de critère
 * éliminatoire pour le label et de matière pour les études de marché.
 */

export type CompanyHealth = {
  /** L'entreprise a cessé son activité (Pappers `entreprise_cessee`). */
  cessee: boolean;
  /** Radiée du RCS ou du RNE. */
  radiee: boolean;
  dateCessation: string | null;
  dateRadiation: string | null;
  /** Procédure collective en cours (redressement, liquidation, sauvegarde). */
  procedureCollectiveEnCours: boolean;
  /** Une procédure collective a existé, même close. */
  procedureCollectiveExiste: boolean;
  /** Libellés des procédures recensées (Pappers + BODACC). */
  procedures: string[];
  /** Vrai dès qu'un signal grave est présent : à exclure de toute recommandation. */
  fragile: boolean;
  /** Résumé lisible, null si aucun signal. */
  resume: string | null;
};

const PROCEDURE_PATTERN =
  /redressement|liquidation|sauvegarde|cessation de paiement|procédure collective|procedure collective|plan de continuation/i;

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function collectProcedures(raw: Record<string, unknown>): string[] {
  const out = new Set<string>();

  const procedures = raw.procedures_collectives;
  if (Array.isArray(procedures)) {
    for (const p of procedures) {
      const label = typeof p === "object" && p !== null
        ? asString((p as Record<string, unknown>).type) ??
          asString((p as Record<string, unknown>).nature) ??
          JSON.stringify(p).slice(0, 120)
        : String(p);
      if (label) out.add(label);
    }
  }

  // Le BODACC porte souvent la procédure avant que Pappers ne la structure.
  const bodacc = raw.publications_bodacc;
  if (Array.isArray(bodacc)) {
    for (const pub of bodacc) {
      if (typeof pub !== "object" || pub === null) continue;
      const blob = JSON.stringify(pub);
      if (PROCEDURE_PATTERN.test(blob)) {
        const record = pub as Record<string, unknown>;
        const label =
          asString(record.type) ?? asString(record.famille) ?? blob.slice(0, 120);
        out.add(label);
      }
    }
  }

  return [...out];
}

export function extractCompanyHealth(rawPappers: unknown): CompanyHealth {
  const raw = (rawPappers ?? {}) as Record<string, unknown>;

  const cessee = raw.entreprise_cessee === true || asString(raw.statut_consolide) === "cessé";
  const statutRcs = asString(raw.statut_rcs);
  const statutRne = asString(raw.statut_rne);
  const radiee = statutRcs === "Radié" || statutRne === "Radié";
  const procedureCollectiveEnCours = raw.procedure_collective_en_cours === true;
  const procedureCollectiveExiste =
    raw.procedure_collective_existe === true || procedureCollectiveEnCours;
  const procedures = collectProcedures(raw);

  const fragile =
    cessee || radiee || procedureCollectiveEnCours || procedureCollectiveExiste || procedures.length > 0;

  const parts: string[] = [];
  if (procedureCollectiveEnCours) parts.push("procédure collective en cours");
  else if (procedureCollectiveExiste || procedures.length > 0) parts.push("procédure collective recensée");
  if (radiee) parts.push("radiée du registre");
  if (cessee && !radiee) parts.push("activité cessée");

  return {
    cessee,
    radiee,
    dateCessation: asString(raw.date_cessation),
    dateRadiation: asString(raw.date_radiation_rcs) ?? asString(raw.date_radiation_rne),
    procedureCollectiveEnCours,
    procedureCollectiveExiste,
    procedures,
    fragile,
    resume: parts.length > 0 ? parts.join(", ") : null,
  };
}
