import type { GoogleSnapshot, MoverIdentity, PappersSnapshot, ReviewsSnapshot } from "./types.js";

/**
 * Les trois sources critiques, vues comme des ports. En production :
 *  - RegistryProvider : Pappers API v2 (finances, décisions, procédures,
 *    BODACC) + registre des transporteurs (SITR, CSV ministériels) + état
 *    administratif Sirene ;
 *  - PlacesProvider : Google Places API v1 (fiche, note, nombre d'avis) ;
 *  - ReviewsProvider : collecte paginée des avis Google (jusqu'à ~500 avis sur
 *    24 mois, avec cache de 7 jours).
 *
 * Contrat : un provider ne lève jamais. Une panne se rend comme un instantané
 * `available: false` avec son erreur — c'est ce qui permet à la règle stricte de
 * dire précisément POURQUOI il n'y a pas de note.
 */

export interface RegistrySnapshot {
  pappers: PappersSnapshot;
  /** Instantané du registre des transporteurs (`transport-register.ts`), ou null s'il n'a pas pu être lu. */
  transportRegister: unknown | null;
  /** Entreprise fermée au répertoire Sirene (état administratif « cessé ») ; null si inconnu. */
  sireneClosed: boolean | null;
}

export interface RegistryProvider {
  fetchRegistry(mover: MoverIdentity): Promise<RegistrySnapshot>;
}

export interface PlacesProvider {
  fetchPlace(mover: MoverIdentity): Promise<GoogleSnapshot>;
}

export interface ReviewsProvider {
  fetchReviews(placeId: string): Promise<ReviewsSnapshot>;
}

export interface ScoringProviders {
  registry: RegistryProvider;
  places: PlacesProvider;
  reviews: ReviewsProvider;
}
