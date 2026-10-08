import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { buildPappersSnapshot, emptyPappersSnapshot } from "../pappers.js";
import type { RegistrySnapshot, ScoringProviders } from "../ports.js";
import type { GoogleReview, GoogleSnapshot, MoverIdentity, PappersErrorKind, ReviewsSnapshot } from "../types.js";

/**
 * Implémentation de démonstration des trois ports, à partir de fichiers JSON
 * (dossier `fixtures/`). Les données y sont FICTIVES : entreprises, SIREN,
 * avis et auteurs inventés. Elle a la même forme que les réponses réelles
 * (réponse brute Pappers, instantané du registre des transporteurs, fiche
 * Google, avis), ce qui fait passer la démo par le vrai code de lecture.
 */

export interface MoverFixture {
  description: string;
  /** Date de référence du jeu de données (fenêtre des avis, ancienneté des décisions). */
  asOf: string;
  mover: MoverIdentity;
  registry: {
    pappers: { httpStatus: number; raw: Record<string, unknown> } | { error: string; errorKind: PappersErrorKind };
    transportRegister: unknown | null;
    sireneClosed: boolean | null;
  };
  google: { placeId: string; name?: string | null; rating: number | null; ratingCount: number | null; businessStatus: string | null } | { error: string };
  reviews: GoogleReview[] | { error: string };
}

export function loadFixtures(dir: string): MoverFixture[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => JSON.parse(readFileSync(join(dir, file), "utf8")) as MoverFixture);
}

export function createFixtureProviders(fixtures: MoverFixture[]): ScoringProviders {
  const byMover = new Map(fixtures.map((fixture) => [fixture.mover.id, fixture]));
  const byPlace = new Map(
    fixtures.flatMap((fixture) => ("placeId" in fixture.google ? [[fixture.google.placeId, fixture] as const] : [])),
  );

  const find = (mover: MoverIdentity) => {
    const fixture = byMover.get(mover.id);
    if (!fixture) throw new Error(`Aucune donnée de démonstration pour ${mover.id}`);
    return fixture;
  };

  return {
    registry: {
      async fetchRegistry(mover): Promise<RegistrySnapshot> {
        const { registry, asOf } = find(mover);
        const pappers =
          "raw" in registry.pappers
            ? buildPappersSnapshot(registry.pappers.raw, { httpStatus: registry.pappers.httpStatus, now: new Date(asOf) })
            : emptyPappersSnapshot({ error: registry.pappers.error, errorKind: registry.pappers.errorKind });
        return { pappers, transportRegister: registry.transportRegister, sireneClosed: registry.sireneClosed };
      },
    },
    places: {
      async fetchPlace(mover): Promise<GoogleSnapshot> {
        const { google } = find(mover);
        if ("error" in google) {
          return {
            available: false,
            source: "google_places",
            placeId: null,
            rating: null,
            ratingCount: null,
            businessStatus: null,
            reviews: [],
            error: google.error,
          };
        }
        return { available: true, source: "google_places", ...google, reviews: [], error: null };
      },
    },
    reviews: {
      async fetchReviews(placeId): Promise<ReviewsSnapshot> {
        const fixture = byPlace.get(placeId);
        if (!fixture || !Array.isArray(fixture.reviews)) {
          const error = fixture && !Array.isArray(fixture.reviews) ? fixture.reviews.error : "fiche inconnue";
          return { available: false, fetchedAt: null, reviews: [], incomplete: false, error };
        }
        return { available: true, fetchedAt: fixture.asOf, reviews: fixture.reviews, incomplete: false, error: null };
      },
    },
  };
}
