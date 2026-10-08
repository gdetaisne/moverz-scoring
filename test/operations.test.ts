import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { afterProviderFailure, claimNextJob, InMemoryJobStore, retryDelayMs, type ScoringJob } from "../src/jobs.js";
import { selectReviewsWindow } from "../src/review-window.js";
import { partnerScoreLabel, partnerScoreWatch, STUCK_RUNNING_ERROR } from "../src/score-watch.js";
import { daysAgo, NOW, review, reviewsOf } from "./helpers.js";

describe("fenêtre des avis 12 / 24 mois", () => {
  it("au moins 12 avis récents : 12 mois", () => {
    const w = selectReviewsWindow([...reviewsOf(12, { isoDate: daysAgo(100) }), ...reviewsOf(5, { isoDate: daysAgo(500) })], NOW);
    assert.equal(w.windowMonths, 12);
    assert.equal(w.reviews.length, 12);
  });

  it("moins de 12 avis récents : on élargit à 24 mois, rien au-delà", () => {
    const w = selectReviewsWindow(
      [...reviewsOf(11, { isoDate: daysAgo(100) }), ...reviewsOf(5, { isoDate: daysAgo(500) }), ...reviewsOf(3, { isoDate: daysAgo(900) })],
      NOW,
    );
    assert.equal(w.windowMonths, 24);
    assert.equal(w.reviews.length, 16);
    assert.deepEqual([w.reviewsCount12m, w.reviewsCount24m], [11, 16]);
  });

  it("un avis sans date est gardé dans les deux fenêtres", () => {
    const w = selectReviewsWindow([review({ isoDate: undefined }), review({ isoDate: "pas une date" })], NOW);
    assert.equal(w.reviewsCount12m, 2);
    assert.equal(w.reviewsCount24m, 2);
  });
});

describe("file des calculs", () => {
  const job = (id: string, extra: Partial<ScoringJob> = {}): ScoringJob => ({
    id,
    moverId: `m-${id}`,
    status: "PENDING",
    scheduledAt: new Date(NOW.getTime() - 1000),
    startedAt: null,
    attempts: 0,
    maxAttempts: 3,
    ...extra,
  });

  it("deux processus réclament le même job : un seul gagne", async () => {
    const store = new InMemoryJobStore([job("a")]);
    const [first, second] = await Promise.all([claimNextJob(store, NOW), claimNextJob(store, NOW)]);
    assert.equal([first, second].filter(Boolean).length, 1);
    assert.equal(store.get("a")?.status, "RUNNING");
    assert.equal(store.get("a")?.attempts, 1);
  });

  it("un job programmé dans le futur n'est pas réclamé", async () => {
    const store = new InMemoryJobStore([job("b", { scheduledAt: new Date(NOW.getTime() + 60_000) })]);
    assert.equal(await claimNextJob(store, NOW), null);
  });

  it("retry exponentiel : 2, 4 minutes, puis échec définitif à la 3e tentative", () => {
    assert.equal(retryDelayMs(1), 2 * 60_000);
    assert.equal(retryDelayMs(2), 4 * 60_000);
    const retry = afterProviderFailure({ attempts: 2, maxAttempts: 3 }, NOW);
    assert.equal(retry.status, "PENDING");
    assert.equal(retry.status === "PENDING" && retry.scheduledAt.getTime() - NOW.getTime(), 4 * 60_000);
    assert.deepEqual(afterProviderFailure({ attempts: 3, maxAttempts: 3 }, NOW), { status: "FAILED" });
  });
});

describe("la note sous l'œil de l'équipe", () => {
  const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

  it("la note en quelques mots", () => {
    assert.equal(partnerScoreLabel(null), "note non calculée");
    assert.equal(partnerScoreLabel({ scoreGlobal: 61.6, isReliable: true, computedAt: NOW }), "note 62");
    assert.equal(partnerScoreLabel({ scoreGlobal: 82, isReliable: false, computedAt: NOW }), "note 82, non fiable");
    assert.equal(partnerScoreLabel({ scoreGlobal: null, isReliable: false, computedAt: NOW }), "pas de note globale");
  });

  it("calculée, en cours, en échec, jamais lancée", () => {
    const j = (status: string) => ({ status, createdAt: minutesAgo(1), startedAt: minutesAgo(1), finishedAt: null, errorMessage: null });
    assert.equal(partnerScoreWatch({ score: { scoreGlobal: 75, isReliable: true, computedAt: NOW }, lastJob: j("FAILED"), now: NOW }).state, "computed");
    assert.equal(partnerScoreWatch({ score: null, lastJob: null, now: NOW }).state, "missing");
    const running = partnerScoreWatch({ score: null, lastJob: j("RUNNING"), now: NOW });
    assert.equal(running.state, "running");
    assert.equal(running.canCompute, false, "pas de second calcul pendant qu'un premier tourne");
  });

  it("« en cours » depuis plus de dix minutes : interrompu, compte comme un échec", () => {
    const stuck = partnerScoreWatch({
      score: null,
      lastJob: { status: "RUNNING", createdAt: minutesAgo(40), startedAt: minutesAgo(35), finishedAt: null, errorMessage: null },
      now: NOW,
    });
    assert.equal(stuck.state, "failed");
    assert.equal(stuck.canCompute, true);
    assert.equal(stuck.lastJob?.error, STUCK_RUNNING_ERROR);
  });
});
