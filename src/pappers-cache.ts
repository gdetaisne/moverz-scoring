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

function cutoffFrom(now: Date): Date {
  return new Date(now.getTime() - PAPPERS_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
}

export function pickFreshPappers(
  candidates: PappersCandidate[],
  now: Date = new Date()
): FreshPappers | null {
  const cutoff = cutoffFrom(now);
  for (const candidate of candidates) {
    const previous = (candidate.snapshots as { pappers?: unknown } | null)?.pappers;
    if (!isUsablePappers(previous)) continue;
    const paidAt = pappersPaidAt(previous, candidate.computedAt);
    if (paidAt < cutoff) continue;
    return { snapshot: previous, paidAt };
  }
  return null;
}
