import type { TransportRegisterSnapshot } from "../src/transport-register.js";
import type { GoogleReview, GoogleSnapshot, PappersSnapshot, ReviewsSnapshot } from "../src/types.js";

/** Données de test : toutes fictives. */

export const NOW = new Date("2026-10-01T12:00:00.000Z");

let counter = 0;

export function daysAgo(days: number, from: Date = NOW): string {
  return new Date(from.getTime() - days * 24 * 3600 * 1000).toISOString();
}

export const LONG_POSITIVE = "Déménagement réussi : équipe ponctuelle et soigneuse, tout est arrivé intact, je recommande vivement cette entreprise.";

export function review(partial: Partial<GoogleReview> = {}): GoogleReview {
  counter += 1;
  return {
    author: `Auteur ${counter}`,
    rating: 5,
    text: LONG_POSITIVE,
    relativeTime: "",
    isoDate: daysAgo(30),
    ...partial,
  };
}

export function reviewsOf(count: number, partial: Partial<GoogleReview> = {}): GoogleReview[] {
  return Array.from({ length: count }, () => review(partial));
}

export function pappers(partial: Partial<PappersSnapshot> = {}): PappersSnapshot {
  return {
    available: true,
    companyFound: true,
    source: "pappers",
    fetchedAt: "2026-09-20T00:00:00.000Z",
    financialScore: 80,
    financialSource: "pappers_heuristic",
    juridicalScore: 100,
    decisions: [],
    finances: [],
    raw: { siren: "123456789" },
    error: null,
    errorKind: null,
    httpStatus: 200,
    ...partial,
  };
}

export function google(partial: Partial<GoogleSnapshot> = {}): GoogleSnapshot {
  return {
    available: true,
    source: "google_places",
    placeId: "place-test",
    rating: 4.8,
    ratingCount: 120,
    businessStatus: "OPERATIONAL",
    reviews: [],
    error: null,
    ...partial,
  };
}

export function reviewsSnapshot(reviews: GoogleReview[], partial: Partial<ReviewsSnapshot> = {}): ReviewsSnapshot {
  return { available: true, fetchedAt: NOW.toISOString(), reviews, incomplete: false, error: null, ...partial };
}

export function sitr(partial: Partial<TransportRegisterSnapshot> = {}): TransportRegisterSnapshot {
  return {
    source: "sitr",
    situationAu: "2026-08-30",
    ingestedAt: "2026-08-31T00:00:00.000Z",
    matched: true,
    matchKind: "siren",
    siren: "123456789",
    noSiren: false,
    inMarchandises: true,
    inCommissionnaires: false,
    etablissementsCount: 1,
    marchandises: {
      siret: "12345678900017",
      raisonSociale: "DEMENAGEMENTS EXEMPLE",
      postalCode: "69007",
      commune: "LYON",
      siege: true,
      ltiNumero: "2023 1",
      ltiDebut: "2023-01-01",
      ltiFin: "2030-01-01",
      ltiCopies: 2,
      lcNumero: null,
      lcDebut: null,
      lcFin: null,
      lcCopies: 0,
      lcVulCopies: 0,
    },
    commissionnaireSiret: null,
    ...partial,
  };
}
