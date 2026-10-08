import { isUnderBon } from "./mover-list.js";

/**
 * La note sous l'œil de l'équipe : règles d'écran du back-office, sans base.
 *
 *  - L'état de la note d'un dossier : calculée, en cours, en échec, jamais lancée.
 *  - « Sous Bon » (pas de note fiable ≥ 70) : la publication reste automatique,
 *    mais la fiche entre dans une file « À regarder ». Ça ne bloque rien.
 *  - Un calcul « en cours » depuis plus de 10 minutes a été interrompu (un
 *    calcul dure 30 à 60 s) : il compte comme un échec, sinon il bloquerait à
 *    jamais tout nouveau calcul pour ce déménageur.
 */

export type ScoringJobStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED_PARTIAL" | "FAILED" | "CANCELED";

export type PartnerScoreState = "computed" | "running" | "failed" | "missing";

export type PartnerScoreInput = { scoreGlobal: number | null; isReliable: boolean; computedAt: Date | string } | null;

export type PartnerScoringJobInput = {
  status: string;
  createdAt: Date | string;
  startedAt?: Date | string | null;
  finishedAt: Date | string | null;
  errorMessage: string | null;
} | null;

export type PartnerScoreWatch = {
  state: PartnerScoreState;
  label: string;
  underBon: boolean;
  canCompute: boolean;
  computedAt: string | null;
  lastJob: { status: string; at: string; finishedAt: string | null; error: string | null } | null;
};

const FAILED = new Set<string>(["FAILED", "CANCELED"]);

export const STUCK_RUNNING_MS = 10 * 60 * 1000;
export const STUCK_RUNNING_ERROR = "Calcul interrompu : resté « en cours » plus de 10 minutes";

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function isStuckRunningJob(
  job: { status: string; createdAt: Date | string; startedAt?: Date | string | null } | null,
  now: Date,
): boolean {
  if (!job || job.status !== "RUNNING") return false;
  const since = Date.parse(iso(job.startedAt) ?? iso(job.createdAt) ?? "");
  return Number.isFinite(since) && now.getTime() - since > STUCK_RUNNING_MS;
}

/** La note en quelques mots : « note 62 », « note 82, non fiable », « pas de note globale »… */
export function partnerScoreLabel(score: PartnerScoreInput): string {
  if (!score) return "note non calculée";
  if (score.scoreGlobal === null || !Number.isFinite(score.scoreGlobal)) return "pas de note globale";
  const value = Math.round(score.scoreGlobal);
  return score.isReliable ? `note ${value}` : `note ${value}, non fiable`;
}

export function partnerScoreWatch(input: { score: PartnerScoreInput; lastJob: PartnerScoringJobInput; now?: Date }): PartnerScoreWatch {
  const { score, lastJob } = input;
  const stuck = isStuckRunningJob(lastJob, input.now ?? new Date());
  const running = !stuck && (lastJob?.status === "PENDING" || lastJob?.status === "RUNNING");
  const failed = stuck || (lastJob !== null && FAILED.has(lastJob.status));
  const state: PartnerScoreState = score ? "computed" : running ? "running" : failed ? "failed" : "missing";
  const error = stuck ? STUCK_RUNNING_ERROR : lastJob?.errorMessage?.trim() ? lastJob.errorMessage.trim().slice(0, 300) : null;
  return {
    state,
    label: partnerScoreLabel(score),
    underBon: isUnderBon({ scoreGlobal: score?.scoreGlobal, isReliable: score?.isReliable }),
    canCompute: !(lastJob?.status === "RUNNING" && !stuck),
    computedAt: iso(score?.computedAt),
    lastJob: lastJob
      ? {
          status: stuck ? "STUCK" : lastJob.status,
          at: iso(lastJob.createdAt) ?? new Date(0).toISOString(),
          finishedAt: iso(lastJob.finishedAt),
          error,
        }
      : null,
  };
}
