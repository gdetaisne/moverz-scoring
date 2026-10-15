import type { PappersSnapshot } from "./types.js";

/**
 * Un appel Pappers est payant. On ne le relance pas si une fiche récente
 * existe déjà. Fenêtre : 120 jours depuis l'appel payé (`fetchedAt`), pas
 * depuis le dernier scoring qui a pu recycler la fiche — sinon une fiche de
 * février, recyclée chaque mois, paraîtrait éternellement fraîche.
 *
 * Et une panne (401, 429, 5xx, réseau) ne dit rien de l'entreprise : elle ne
 * doit jamais écraser une donnée déjà payée (`isInfrastructureFailure`).
 */

export const PAPPERS_MAX_AGE_DAYS = 120;

/**
 * Le recalcul trimestriel relit le registre (Guillaume, 15/10/2026) : il ne
 * reprend une fiche que si elle a été payée dans les 7 derniers jours, c'est-à-dire
 * par une tentative du même recalcul (relances après panne). Le filet en cas de
 * panne du registre, et les autres déclencheurs, gardent les 120 jours.
 */
export const PAPPERS_QUARTERLY_MAX_AGE_DAYS = 7;

export type PappersCandidate = { snapshots: unknown; computedAt: Date };

export type FreshPappers = {
  snapshot: PappersSnapshot;
  paidAt: Date;
};

export function isInfrastructureFailure(snapshot: PappersSnapshot): boolean {
  if (snapshot.available) return false;
  return (
    snapshot.errorKind === "http_error" ||
    snapshot.errorKind === "network" ||
    snapshot.errorKind === "timeout" ||
    snapshot.errorKind === "missing_key"
  );
}

export function isUsablePappers(snapshot: unknown): snapshot is PappersSnapshot {
  const s = snapshot as PappersSnapshot | null;
  return Boolean(s && s.available && s.companyFound);
}

/** Date à laquelle on a payé l'appel, pas celle du scoring qui l'a recyclé. */
export function pappersPaidAt(snapshot: PappersSnapshot, scoreComputedAt: Date): Date {
  if (snapshot.fetchedAt) {
    const d = new Date(snapshot.fetchedAt);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return scoreComputedAt;
}

function cutoffFrom(now: Date, maxAgeDays: number = PAPPERS_MAX_AGE_DAYS): Date {
  return new Date(now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000);
}

/** Le SIREN de l'entreprise que décrit la fiche Pappers, ou null s'il n'y figure pas. */
export function pappersSnapshotSiren(snapshot: PappersSnapshot): string | null {
  const raw = snapshot.raw as { siren?: unknown } | null | undefined;
  const siren = typeof raw?.siren === "string" ? raw.siren.replace(/\D+/g, "") : "";
  return siren.length === 9 ? siren : null;
}

/**
 * `expectedSiren` : le SIREN actuel de la fiche. Une fiche Pappers d'une AUTRE entreprise
 * (SIREN corrigé depuis) n'est jamais réutilisée (15/10/2026 : deux fiches dont le SIREN
 * avait été corrigé étaient notées avec la fiche Pappers de l'ancienne société).
 *
 * `maxAgeDays` : âge maximal de la fiche reprise. 120 jours par défaut ;
 * `PAPPERS_QUARTERLY_MAX_AGE_DAYS` (7) pour le recalcul trimestriel.
 */
export function pickFreshPappers(
  candidates: PappersCandidate[],
  now: Date = new Date(),
  expectedSiren?: string | null,
  maxAgeDays: number = PAPPERS_MAX_AGE_DAYS
): FreshPappers | null {
  const cutoff = cutoffFrom(now, maxAgeDays);
  const expected = (expectedSiren ?? "").replace(/\D+/g, "");
  for (const candidate of candidates) {
    const previous = (candidate.snapshots as { pappers?: unknown } | null)?.pappers;
    if (!isUsablePappers(previous)) continue;
    const snapshotSiren = pappersSnapshotSiren(previous);
    if (expected.length === 9 && snapshotSiren !== null && snapshotSiren !== expected) continue;
    const paidAt = pappersPaidAt(previous, candidate.computedAt);
    if (paidAt < cutoff) continue;
    return { snapshot: previous, paidAt };
  }
  return null;
}
