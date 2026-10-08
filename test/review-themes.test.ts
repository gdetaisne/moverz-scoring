import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  REVIEW_THEMES_MAX,
  REVIEW_THEME_MIN_MENTIONS,
  buildThemesPrompt,
  countThemesByKeywords,
  estimateThemesTokens,
  parseThemesAnswer,
  reviewsForThemes,
  themesOfReviewText,
  topReviewThemes,
} from "../src/review-themes.js";
import type { GoogleReview } from "../src/types.js";

const FETCHED = new Date("2026-09-21T12:00:00Z");
let n = 0;
function review(text: string, rating = 5, isoDate = "2026-06-01T10:00:00Z"): GoogleReview {
  n += 1;
  return { author: `auteur ${n}`, rating, text, relativeTime: "", isoDate };
}

describe("thèmes positifs — lecture d'un avis par mots-clés", () => {
  it("repère les thèmes de la liste fermée, accents et apostrophes compris", () => {
    assert.deepEqual(themesOfReviewText("Déménageurs ponctuels et très soigneux avec nos meubles."), ["ponctualite", "soin"]);
    assert.deepEqual(themesOfReviewText("Arrivés à l’heure, équipe très sympathique !"), ["ponctualite", "equipe_sympathique"]);
    assert.deepEqual(themesOfReviewText("Excellent rapport qualité/prix, rien de cassé."), ["soin", "rapport_qualite_prix"]);
    assert.deepEqual(themesOfReviewText("Très réactifs et à l'écoute, bien organisés."), ["reactivite", "organisation"]);
  });
  it("une négation juste avant n'en fait pas un thème positif", () => {
    assert.deepEqual(themesOfReviewText("Pas très soigneux, et pas à l'heure du tout."), []);
    assert.deepEqual(themesOfReviewText("Ils n'étaient pas ponctuels mais très sympas."), ["equipe_sympathique"]);
  });
  it("un nom neutre ou une réserve juste après ne font pas un compliment", () => {
    assert.deepEqual(themesOfReviewText("Ponctualité à revoir, professionnalisme discutable."), []);
    assert.deepEqual(themesOfReviewText("Un sérieux retard au départ."), []);
    assert.deepEqual(themesOfReviewText("Rapides mais à revoir sur le reste."), []);
  });
  it("un avis qui cite un thème trois fois compte une fois", () => {
    const counts = countThemesByKeywords([review("Ponctuels, ponctuels, vraiment ponctuels !")]);
    assert.equal(counts.ponctualite, 1);
  });
  it("aucun thème inventé dans un texte neutre ou vide", () => {
    assert.deepEqual(themesOfReviewText("Déménagement effectué en mai."), []);
    assert.deepEqual(themesOfReviewText(""), []);
  });
});

describe("thèmes positifs — avis retenus", () => {
  it("seulement les avis authentiques, 4★ et plus, avec un texte, datés des 24 mois avant la lecture", () => {
    const kept = reviewsForThemes(
      [
        review("Équipe ponctuelle et soigneuse, je recommande vivement ce déménageur à tous.", 5),
        review("Équipe ponctuelle et soigneuse, mais le reste laissait vraiment à désirer franchement.", 3),
        review("", 5),
        review("Équipe ponctuelle et soigneuse, je recommande vivement ce déménageur à tous.", 4, "2024-01-01T10:00:00Z"),
        { author: "sans date", rating: 5, text: "Équipe ponctuelle et soigneuse, je recommande vivement ce déménageur.", relativeTime: "" },
      ],
      FETCHED,
    );
    assert.equal(kept.length, 1);
  });
  it("un avis suspect (court + même auteur 5★) est écarté, comme pour la note", () => {
    const kept = reviewsForThemes(
      [
        { author: "Client Test", rating: 5, text: "Super ponctuels", relativeTime: "", isoDate: "2026-06-01T10:00:00Z" },
        { author: "Client Test", rating: 5, text: "Très sympas", relativeTime: "", isoDate: "2026-06-02T10:00:00Z" },
      ],
      FETCHED,
    );
    assert.equal(kept.length, 0);
  });
});

describe("thèmes positifs — ce que la fiche garde", () => {
  it("au moins 3 avis par thème, au plus 4 thèmes, les plus cités d'abord", () => {
    assert.equal(REVIEW_THEME_MIN_MENTIONS, 3);
    assert.equal(REVIEW_THEMES_MAX, 4);
    assert.deepEqual(
      topReviewThemes({
        ponctualite: 23,
        soin: 18,
        equipe_sympathique: 31,
        rapport_qualite_prix: 12,
        professionnalisme: 9,
        efficacite: 2,
      }),
      [
        { id: "equipe_sympathique", count: 31 },
        { id: "ponctualite", count: 23 },
        { id: "soin", count: 18 },
        { id: "rapport_qualite_prix", count: 12 },
      ],
    );
    assert.deepEqual(topReviewThemes({ ponctualite: 2, soin: 3 }), [{ id: "soin", count: 3 }]);
    assert.deepEqual(topReviewThemes({}), []);
  });
});

describe("thèmes positifs — méthode ia", () => {
  it("la consigne liste les thèmes fermés et numérote les avis", () => {
    const prompt = buildThemesPrompt([review("Très ponctuels."), review("Soigneux.")]);
    assert.match(prompt, /"ponctualite" : Ponctuels/);
    assert.match(prompt, /Avis 2 \(5★\) : "Soigneux\."/);
  });
  it("la réponse est relue : thème hors liste, numéro hors bornes et doublons écartés", () => {
    const sets = parseThemesAnswer(
      {
        themes: [
          { themeId: "ponctualite", reviewNumbers: [1, 2, 2, 9, 0, 1.5] },
          { themeId: "casse_degradation", reviewNumbers: [1] },
          { themeId: "soin", reviewNumbers: "1" },
        ],
      },
      3,
    );
    assert.deepEqual([...sets.ponctualite].sort(), [1, 2]);
    assert.equal(sets.soin.size, 0);
    assert.equal(Object.keys(sets).includes("casse_degradation"), false);
    assert.equal(parseThemesAnswer(null, 3).ponctualite.size, 0);
  });
  it("estimation : un appel par paquet de 60 avis", () => {
    const reviews = Array.from({ length: 130 }, () => review("x".repeat(350)));
    const estimate = estimateThemesTokens(reviews);
    assert.equal(estimate.calls, 3);
    assert.ok(estimate.inputTokens > 13_000 && estimate.inputTokens < 16_000);
  });
});
