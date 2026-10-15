import assert from "node:assert/strict";
import test from "node:test";
import {
  isInfrastructureFailure,
  isUsablePappers,
  pappersPaidAt,
  pickFreshPappers,
  PAPPERS_MAX_AGE_DAYS,
  PAPPERS_QUARTERLY_MAX_AGE_DAYS,
} from "../src/pappers-cache.js";
import type { PappersSnapshot } from "../src/types.js";

function snap(partial: Partial<PappersSnapshot>): PappersSnapshot {
  return {
    available: true,
    companyFound: true,
    source: "pappers",
    fetchedAt: "2026-08-01T00:00:00.000Z",
    financialScore: 70,
    financialSource: "pappers_native",
    juridicalScore: 80,
    decisions: [],
    finances: [],
    raw: { siren: "123" },
    error: null,
    errorKind: null,
    httpStatus: 200,
    ...partial,
  };
}

test("fiche récente : on la reprend (pas de nouvel appel)", () => {
  const now = new Date("2026-09-08T00:00:00.000Z");
  const picked = pickFreshPappers(
    [
      {
        snapshots: { pappers: snap({ fetchedAt: "2026-08-20T00:00:00.000Z" }) },
        computedAt: new Date("2026-08-21T00:00:00.000Z"),
      },
    ],
    now
  );
  assert.ok(picked);
  assert.equal(picked.paidAt.toISOString().slice(0, 10), "2026-08-20");
});

test("fiche trop vieille : on ne recycle pas", () => {
  const now = new Date("2026-09-08T00:00:00.000Z");
  const old = new Date(now);
  old.setDate(old.getDate() - (PAPPERS_MAX_AGE_DAYS + 1));
  const picked = pickFreshPappers(
    [
      {
        snapshots: { pappers: snap({ fetchedAt: old.toISOString() }) },
        computedAt: now,
      },
    ],
    now
  );
  assert.equal(picked, null);
});

test("scoring d'hier qui recycle une fiche trop vieille : pas frais", () => {
  const now = new Date("2026-09-08T00:00:00.000Z");
  const picked = pickFreshPappers(
    [
      {
        snapshots: { pappers: snap({ fetchedAt: "2026-01-01T00:00:00.000Z" }) },
        computedAt: new Date("2026-09-07T00:00:00.000Z"),
      },
    ],
    now
  );
  assert.equal(picked, null);
});

test("sans fetchedAt : on se rabat sur la date du score", () => {
  const now = new Date("2026-09-08T00:00:00.000Z");
  const picked = pickFreshPappers(
    [
      {
        snapshots: { pappers: snap({ fetchedAt: null }) },
        computedAt: new Date("2026-08-15T00:00:00.000Z"),
      },
    ],
    now
  );
  assert.ok(picked);
  assert.equal(pappersPaidAt(snap({ fetchedAt: null }), new Date("2026-08-15T00:00:00.000Z")).toISOString().slice(0, 10), "2026-08-15");
});

test("société introuvable : pas réutilisable", () => {
  assert.equal(isUsablePappers(snap({ available: true, companyFound: false })), false);
});

test("401 / réseau : panne d'infra, pas un verdict sur l'entreprise", () => {
  assert.equal(
    isInfrastructureFailure(
      snap({ available: false, companyFound: false, errorKind: "http_error", error: "401" })
    ),
    true
  );
  assert.equal(
    isInfrastructureFailure(snap({ available: false, companyFound: false, errorKind: "not_found", error: "404" })),
    false
  );
});

test("SIREN corrigé : la fiche Pappers de l'ancienne entreprise n'est jamais reprise", () => {
  const now = new Date("2026-09-08T00:00:00.000Z");
  const old = { snapshots: { pappers: snap({ raw: { siren: "111111111" } }) }, computedAt: new Date("2026-08-01T00:00:00.000Z") };
  assert.equal(pickFreshPappers([old], now, "222222222"), null, "autre SIREN : nouvel appel");
  assert.ok(pickFreshPappers([old], now, "111111111"), "même SIREN : reprise");
  assert.ok(pickFreshPappers([old], now), "SIREN attendu inconnu : comportement d'avant");
  const noSiren = { snapshots: { pappers: snap({ raw: {} }) }, computedAt: old.computedAt };
  assert.ok(pickFreshPappers([noSiren], now, "222222222"), "fiche sans SIREN lisible : comportement d'avant");
});

test("âge maximal en paramètre (15/10/2026) : le recalcul trimestriel ne reprend qu'une fiche de moins de 7 jours", () => {
  const now = new Date("2026-10-15T00:00:00.000Z");
  const paid = (fetchedAt: string) => ({
    snapshots: { pappers: snap({ fetchedAt, raw: { siren: "123456789" } }) },
    computedAt: new Date(fetchedAt),
  });
  const thirtyDays = [paid("2026-09-15T00:00:00.000Z")];
  assert.ok(pickFreshPappers(thirtyDays, now, "123456789"), "120 jours par défaut");
  assert.equal(pickFreshPappers(thirtyDays, now, "123456789", PAPPERS_QUARTERLY_MAX_AGE_DAYS), null, "recalcul trimestriel : nouvel appel");
  assert.ok(pickFreshPappers([paid("2026-10-13T00:00:00.000Z")], now, "123456789", PAPPERS_QUARTERLY_MAX_AGE_DAYS), "relance du même recalcul : reprise");
  assert.equal(PAPPERS_QUARTERLY_MAX_AGE_DAYS, 7);
});
