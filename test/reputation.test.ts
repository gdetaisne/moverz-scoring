import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { completeJsonWithFallback, type LlmClient } from "../src/llm/client.js";
import {
  categoriesFromLlmAnswer,
  categoryScore,
  deriveReputationSnapshot,
  deriveVigilanceSnapshot,
  detectFakeReviews,
  reputationVolumeCap,
} from "../src/reputation.js";
import { review, reviewsOf } from "./helpers.js";

function fakeLlm(answer: unknown, provider = "fake"): LlmClient & { calls: number } {
  const client = {
    provider,
    model: `${provider}-model`,
    calls: 0,
    async completeJson() {
      client.calls += 1;
      return answer === null ? null : { json: answer, provider, model: `${provider}-model`, usage: null };
    },
  };
  return client;
}

describe("avis non informatifs", () => {
  it("il faut deux signaux : un avis court seul n'est pas écarté", () => {
    const [short] = detectFakeReviews([review({ text: "Super, je recommande !" })]);
    assert.equal(short.suspicious, false);
  });

  it("court + même auteur à 5★ deux fois : écarté", () => {
    const flagged = detectFakeReviews([
      review({ author: "Client Pressé", text: "Top équipe" }),
      review({ author: "client pressé ", text: "Parfait, merci" }),
    ]);
    assert.deepEqual(
      flagged.map((r) => r.suspicious),
      [true, true],
    );
  });

  it("5★ sans aucun texte : deux signaux d'un coup", () => {
    assert.equal(detectFakeReviews([review({ text: "" })])[0].suspicious, true);
  });

  it("un avis négatif court n'est jamais écarté par l'auteur répété (seuls les 5★ comptent)", () => {
    const flagged = detectFakeReviews([review({ author: "X", rating: 1, text: "Nul" }), review({ author: "X", rating: 1, text: "Nul" })]);
    assert.deepEqual(
      flagged.map((r) => r.suspicious),
      [false, false],
    );
  });
});

describe("réputation", () => {
  it("plafonds de volume : 60 / 75 / 88 / 100", () => {
    assert.deepEqual([4, 9, 24, 25].map(reputationVolumeCap), [60, 75, 88, 100]);
    assert.equal(deriveReputationSnapshot(reviewsOf(4)).reputationScore, 60, "100 % positif sur 4 avis ne vaut pas 100");
  });

  it("bonus de constance au-delà de 50 avis authentiques", () => {
    const reviews = [...reviewsOf(57), ...reviewsOf(3, { rating: 2, text: "Prestation décevante, des cartons abîmés et une équipe pressée de partir." })];
    // 3 négatifs sur 60 = 95, +5 au-delà de 50 avis → 100
    assert.equal(deriveReputationSnapshot(reviews).reputationScore, 100);
  });

  it("aucun avis authentique : 50, neutre, et l'explication le dit", () => {
    const r = deriveReputationSnapshot([review({ text: "" })]);
    assert.equal(r.reputationScore, 50);
    assert.equal(r.suspiciousCount, 1);
    assert.match(r.explanation, /Aucun avis authentique/);
  });

  it("les avis négatifs font baisser la note en proportion", () => {
    const r = deriveReputationSnapshot([
      ...reviewsOf(10),
      ...reviewsOf(10, { rating: 1, text: "Retard important et casse sur plusieurs meubles, service client injoignable ensuite." }),
    ]);
    assert.equal(r.reputationScore, 50);
    assert.equal(r.negativeRatio, 0.5);
  });
});

describe("vigilance", () => {
  it("seuils par catégorie : < 1 % = 100, 1 à 3 % = 50, > 3 % = 0", () => {
    assert.equal(categoryScore(0, 50).score, 100);
    assert.equal(categoryScore(1, 200).score, 100);
    assert.equal(categoryScore(1, 100).score, 50);
    assert.equal(categoryScore(3, 100).score, 50);
    assert.equal(categoryScore(4, 100).score, 0);
  });

  it("un seul signalement de casse sur 20 avis coûte 30 % de l'axe : la casse pèse lourd", async () => {
    const reviews = [...reviewsOf(19), review({ rating: 3, text: "Correct mais une commode abîmée pendant le transport, dommage vraiment." })];
    const v = await deriveVigilanceSnapshot(reviews);
    const casse = v.categories.find((c) => c.id === "casse_degradation");
    assert.equal(casse?.score, 0);
    assert.equal(v.method, "keywords");
    // casse 0 × 0,3 et « autres » 0 × 0,1 : 100 − 30 − 10
    assert.equal(v.vigilanceScore, 60);
  });

  it("sans avis négatif : 100", async () => {
    assert.equal((await deriveVigilanceSnapshot(reviewsOf(30))).vigilanceScore, 100);
  });

  it("la classification d'un modèle remplace l'heuristique quand elle est lisible", async () => {
    const reviews = [...reviewsOf(19), review({ rating: 3, text: "Correct mais une commode abîmée pendant le transport, dommage vraiment." })];
    const llm = fakeLlm({ classifications: [{ categoryId: "casse_degradation", reviewNumbers: [1], evidence: ["commode abîmée"] }] });
    const v = await deriveVigilanceSnapshot(reviews, { llm: [llm] });
    assert.equal(v.method, "llm");
    assert.equal(v.categories.find((c) => c.id === "autres")?.score, 100, "le modèle ne range pas cet avis dans « autres »");
    assert.equal(v.vigilanceScore, 70);
  });

  it("la réponse du modèle est relue : catégorie inconnue, numéros hors bornes et doublons ignorés", () => {
    const cats = categoriesFromLlmAnswer(
      { classifications: [{ categoryId: "vol", reviewNumbers: [1, 1, 7, 0, 1.5] }, { categoryId: "inventee", reviewNumbers: [2] }] },
      2,
      100,
    );
    assert.ok(cats);
    assert.equal(cats.find((c) => c.id === "vol")?.reviewCount, 1);
    assert.equal(cats.some((c) => c.id === "inventee"), false);
    assert.equal(categoriesFromLlmAnswer({ autre: "chose" }, 2, 100), null);
  });

  it("aucun modèle ne répond : on garde l'heuristique, sans erreur", async () => {
    const reviews = [...reviewsOf(19), review({ rating: 2, text: "Un carton disparu pendant le trajet, jamais retrouvé malgré nos relances." })];
    const v = await deriveVigilanceSnapshot(reviews, { llm: [fakeLlm(null), fakeLlm(null)] });
    assert.equal(v.method, "keywords");
    assert.equal(v.categories.find((c) => c.id === "vol")?.reviewCount, 1);
  });
});

describe("repli entre modèles", () => {
  it("le premier qui répond gagne ; un client qui lève est sauté", async () => {
    const thrower: LlmClient = {
      provider: "boom",
      model: "boom",
      async completeJson() {
        throw new Error("réseau");
      },
    };
    const silent = fakeLlm(null, "openai");
    const backup = fakeLlm({ ok: true }, "anthropic");
    const result = await completeJsonWithFallback([thrower, silent, backup], "consigne");
    assert.equal(result?.provider, "anthropic");
    assert.equal(silent.calls, 1);
    assert.equal(await completeJsonWithFallback([], "consigne"), null);
  });
});
