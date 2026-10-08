/**
 * La file des calculs, réduite à ses deux règles (le produit la tient en base
 * SQL ; voir docs/architecture.md).
 *
 *  1. Claim atomique : on lit un candidat PENDING, puis on le passe en RUNNING
 *     par une mise à jour CONDITIONNELLE (`WHERE id = ? AND status = 'PENDING'`).
 *     Une ligne modifiée : ce processus a gagné. Zéro : un autre l'a pris avant,
 *     on abandonne. Sûr avec plusieurs instances, sans verrou applicatif.
 *  2. Retry exponentiel : un échec de fournisseur repasse PENDING avec
 *     `scheduledAt = maintenant + 2 min × 2^(tentatives − 1)` ; à 3 tentatives,
 *     FAILED définitif (et alerte à l'équipe).
 */

export type JobStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED_PARTIAL" | "FAILED" | "CANCELED";

export interface ScoringJob {
  id: string;
  moverId: string;
  status: JobStatus;
  scheduledAt: Date;
  startedAt: Date | null;
  attempts: number;
  maxAttempts: number;
}

export const RETRY_BASE_MS = 2 * 60 * 1000;
export const DEFAULT_MAX_ATTEMPTS = 3;

export function retryDelayMs(attempts: number): number {
  return RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1);
}

/** Ce que devient un job après un échec de fournisseur. */
export function afterProviderFailure(
  job: Pick<ScoringJob, "attempts" | "maxAttempts">,
  now: Date,
): { status: "PENDING"; scheduledAt: Date } | { status: "FAILED" } {
  if (job.attempts >= job.maxAttempts) return { status: "FAILED" };
  return { status: "PENDING", scheduledAt: new Date(now.getTime() + retryDelayMs(job.attempts)) };
}

/** Le contrat minimal d'un stockage de jobs. */
export interface JobStore {
  findFirstDue(now: Date): Promise<ScoringJob | null>;
  /** Mise à jour conditionnelle : vrai seulement si le statut était encore `expected`. */
  updateIfStatus(id: string, expected: JobStatus, patch: Partial<ScoringJob>): Promise<boolean>;
}

export async function claimNextJob(store: JobStore, now: Date): Promise<ScoringJob | null> {
  const candidate = await store.findFirstDue(now);
  if (!candidate) return null;
  const won = await store.updateIfStatus(candidate.id, "PENDING", {
    status: "RUNNING",
    startedAt: now,
    attempts: candidate.attempts + 1,
  });
  return won ? { ...candidate, status: "RUNNING", startedAt: now, attempts: candidate.attempts + 1 } : null;
}

/** Implémentation en mémoire (tests, démo). `findFirstDue` cède la main pour rendre la course réelle. */
export class InMemoryJobStore implements JobStore {
  constructor(private readonly jobs: ScoringJob[] = []) {}

  async findFirstDue(now: Date): Promise<ScoringJob | null> {
    await Promise.resolve();
    const due = this.jobs
      .filter((job) => job.status === "PENDING" && job.scheduledAt <= now)
      .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
    return due[0] ? { ...due[0] } : null;
  }

  async updateIfStatus(id: string, expected: JobStatus, patch: Partial<ScoringJob>): Promise<boolean> {
    const job = this.jobs.find((candidate) => candidate.id === id);
    if (!job || job.status !== expected) return false;
    Object.assign(job, patch);
    return true;
  }

  get(id: string): ScoringJob | undefined {
    return this.jobs.find((job) => job.id === id);
  }
}
