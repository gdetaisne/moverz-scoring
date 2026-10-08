/**
 * Note les déménageurs de démonstration (`fixtures/`, données fictives), sans
 * réseau ni modèle de langage.
 *
 *   npx tsx examples/score-a-mover.ts                 # tous
 *   npx tsx examples/score-a-mover.ts demo-fragile    # un seul
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { createFixtureProviders, loadFixtures } from "../src/adapters/fixture-providers.js";
import { scoreMover, type ScoringResult } from "../src/compute.js";
import { evaluateLabelStatus } from "../src/label.js";
import { MOVER_LIST_SLOTS, moverListExclusionReason, resolveMoverListCategory } from "../src/mover-list.js";
import { sitrJuridicalVerdict } from "../src/sitr-juridical.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = loadFixtures(join(here, "..", "fixtures"));
const providers = createFixtureProviders(fixtures);
const only = process.argv[2];

const AXES = [
  ["financial", "Financier", 0.125],
  ["juridical", "Juridique", 0.125],
  ["google", "Google", 0.2],
  ["reputation", "Réputation", 0.2],
  ["vigilance", "Vigilance", 0.35],
] as const;

function show(name: string, description: string, r: ScoringResult) {
  console.log(`\n━━ ${name}`);
  console.log(`   ${description}`);
  for (const [key, label, weight] of AXES) {
    const value = r.components[key];
    const bar = value == null ? "—".padEnd(20) : "█".repeat(Math.round(value / 5)).padEnd(20, "·");
    console.log(`   ${label.padEnd(11)} ${String(value ?? "—").padStart(3)}  ${bar} × ${weight}`);
  }
  console.log(
    r.isReliable
      ? `   Note globale : ${r.globalScore}/100 (${r.globalLabel})`
      : `   Pas de note globale. ${r.reliabilityError}`,
  );
  const flags = [
    r.details.financialFallbackApplied && "financier sans bilan publié → 50 (exception n° 1)",
    r.details.googleFallbackApplied && "fiche Google sans note → 50 (exception n° 2)",
    r.reputation.windowMonths && `avis lus sur ${r.reputation.windowMonths} mois (${r.reputation.reviewsCount12m} avis sur 12 mois)`,
    r.reputation.suspiciousCount > 0 && `${r.reputation.suspiciousCount} avis écartés comme non informatifs`,
    r.details.sitrJuridicalVerdict === "zero" && "registre des transporteurs : absent ou licence périmée → juridique 0",
    r.companyHealth.resume && `santé de l'entreprise : ${r.companyHealth.resume}`,
    r.details.googleTrade?.offTrade &&
      `fiche Google hors métier : ${r.details.googleTrade.tradeReviews}/${r.details.googleTrade.textReviews} avis parlent de déménagement → composante Google retirée`,
  ].filter(Boolean);
  for (const flag of flags) console.log(`   · ${flag}`);
  const alerts = r.vigilance.categories.filter((c) => c.status !== "ok");
  if (alerts.length) {
    console.log(`   Vigilance : ${alerts.map((c) => `${c.label} ${c.reviewCount} avis (${(c.ratio * 100).toFixed(1)} %) → ${c.score}`).join(" ; ")}`);
  }
  if (r.isReliable && r.motif.motif) {
    console.log(`   Motif principal : ${r.motif.motif} (−${r.motif.perte} pts, ${r.motif.ecartSecond} d'écart avec le second)`);
  }
}

for (const fixture of fixtures) {
  if (only && fixture.mover.id !== only) continue;
  const result = await scoreMover(fixture.mover, providers, { now: new Date(fixture.asOf) });
  show(fixture.mover.companyName, fixture.description, result);

  const label = evaluateLabelStatus({
    blacklisted: false,
    optOut: false,
    hasEmail: true,
    companyFragile: result.companyHealth.fragile,
    onTransportRegister: sitrJuridicalVerdict(fixture.registry.transportRegister) !== "zero",
    current: { scoreGlobal: result.globalScore, scoreGlobalLabel: result.globalLabel, isReliable: result.isReliable },
  });
  const exclusion = moverListExclusionReason({
    blacklisted: false,
    companyClosed: result.details.sireneClosed,
    companyFragile: result.companyHealth.fragile,
    scoreGlobal: result.globalScore,
    isReliable: result.isReliable,
  });
  const category = exclusion ? null : resolveMoverListCategory({ scoreGlobal: result.globalScore, isReliable: result.isReliable });
  console.log(`   Label Excellent : ${label.eligible ? "oui" : `non (${label.reason})`}`);
  console.log(
    `   Proposé au client : ${
      category ? `oui, « ${category === "confirme" ? "Confirmés" : "Dynamiques"} » (${MOVER_LIST_SLOTS[category]} places)` : `non (${exclusion})`
    }`,
  );
}
console.log();
