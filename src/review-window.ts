import type { GoogleReview } from "./types.js";

/**
 * Fenêtre adaptative des avis lus par la réputation et la vigilance.
 *
 * 12 mois par défaut : un score doit refléter l'équipe d'aujourd'hui, pas celle
 * d'il y a trois ans. Mais un artisan qui fait 40 déménagements par an reçoit
 * peut-être 8 avis sur 12 mois : sur un échantillon pareil, un seul avis
 * négatif fait basculer la note. Sous 12 avis récents, on lit donc 24 mois.
 * Le déménageur très actif reste jugé sur sa période récente ; le petit n'est
 * pas noté sur trois avis.
 *
 * Les avis sans date (rares) sont gardés dans les deux fenêtres : on ne sait pas
 * les classer, et les retirer pénaliserait sans raison.
 */
export const REPUTATION_EXTEND_THRESHOLD = 12;

export interface SelectedReviewsWindow {
  reviews: GoogleReview[];
  windowMonths: 12 | 24;
  reviewsCount12m: number;
  reviewsCount24m: number;
}

export function selectReviewsWindow(allReviews: GoogleReview[], now: Date = new Date()): SelectedReviewsWindow {
  const cutoff12m = new Date(now);
  cutoff12m.setMonth(cutoff12m.getMonth() - 12);
  const cutoff24m = new Date(now);
  cutoff24m.setMonth(cutoff24m.getMonth() - 24);

  const within12m: GoogleReview[] = [];
  const within24m: GoogleReview[] = [];

  for (const review of allReviews) {
    const d = review.isoDate ? new Date(review.isoDate) : null;
    if (!d || Number.isNaN(d.getTime())) {
      within12m.push(review);
      within24m.push(review);
      continue;
    }
    if (d >= cutoff12m) within12m.push(review);
    if (d >= cutoff24m) within24m.push(review);
  }

  const useExtended = within12m.length < REPUTATION_EXTEND_THRESHOLD;
  return {
    reviews: useExtended ? within24m : within12m,
    windowMonths: useExtended ? 24 : 12,
    reviewsCount12m: within12m.length,
    reviewsCount24m: within24m.length,
  };
}
