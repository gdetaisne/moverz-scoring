import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assessGoogleTrade, ficheNameMentionsTrade, readGoogleFicheName, reviewMentionsTrade } from "../src/google-trade.js";
import type { GoogleReview } from "../src/types.js";

/** Données fictives. */
const review = (text: string): GoogleReview => ({ author: "x", rating: 5, text, relativeTime: "" });
const off = (n: number) =>
  Array.from({ length: n }, (_, i) => review(`Malfaçons dans notre immeuble neuf, pas d'eau chaude depuis un mois, numéro ${i}.`));
const on = (n: number) =>
  Array.from({ length: n }, (_, i) => review(`Déménagement parfait, cartons bien protégés et équipe au top, numéro ${i}.`));

describe("fiche Google hors métier", () => {
  it("« immeuble » ne compte pas comme « meuble »", () => {
    assert.equal(reviewMentionsTrade("Les malfaçons de l'immeuble sont nombreuses"), false);
    assert.equal(reviewMentionsTrade("Ils ont monté nos meubles au 5e sans ascenseur"), true);
    assert.equal(reviewMentionsTrade("DÉMÉNAGEURS très soigneux"), true);
  });

  it("la fiche d'un promoteur immobilier est hors métier", () => {
    const verdict = assessGoogleTrade(off(10), "Promotion Immobilière Exemple");
    assert.equal(verdict.tradeReviews, 0);
    assert.equal(verdict.offTrade, true);
  });

  it("une fiche de déménageur passe", () => {
    assert.equal(assessGoogleTrade([...on(6), ...off(4)], "Transports Exemple").offTrade, false);
  });

  it("sans nom du métier, il faut 20 % d'avis du métier (une paroisse à 11 %)", () => {
    const reviews = [...on(4), ...off(34)];
    assert.equal(assessGoogleTrade(reviews, "Paroisse Saint-Exemple").offTrade, true);
    // Le même profil d'avis sous un nom de déménageur reste dans le métier (seuil 10 %).
    assert.equal(assessGoogleTrade(reviews, "Exemple Lyon déménagement et logistique").offTrade, false);
  });

  it("sous 5 avis à texte, on ne tranche pas", () => {
    assert.equal(assessGoogleTrade(off(4), "Promotion Immobilière Exemple").offTrade, false);
    assert.equal(assessGoogleTrade([review("Top"), review("Super !")], null).textReviews, 0);
  });

  it("le nom de la fiche", () => {
    assert.equal(ficheNameMentionsTrade("Déménagements Exemple Bourges"), true);
    assert.equal(ficheNameMentionsTrade("EXEMPLEBOX Garde-Meubles Self Sécurisé 24h/24"), true);
    assert.equal(ficheNameMentionsTrade("Navettes Exemple - Transport personnes, transferts bagages"), false);
    assert.equal(readGoogleFicheName({ details: { displayName: { text: " ABC " } } }), "ABC");
    assert.equal(readGoogleFicheName(null), null);
  });
});
