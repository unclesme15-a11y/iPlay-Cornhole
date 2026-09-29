/** The rating maths. Pure functions, no database. */

export const START_RATING = 1200;
export const MIN_RATING = 100;

/** How likely `rating` is to beat `opponent`, from 0 to 1. A 400-point gap means about 10 to 1. */
export const expectedScore = (rating: number, opponent: number): number => 1 / (1 + 10 ** ((opponent - rating) / 400));

/** New players move fast so they find their level quickly; veterans move slowly. */
export const kFactor = (games: number): number => (games < 10 ? 40 : games < 30 ? 28 : 20);

/**
 * Playing the same opponent again and again should not farm points.
 * `recent` is how many ranked matches these same people already played in the last 24 hours.
 */
export const farmingWeight = (recent: number): number => (recent < 3 ? 1 : recent < 6 ? 0.5 : 0);

/** Points gained (positive) or lost (negative). `score` is 1 for a win and 0 for a loss. */
export function ratingChange(rating: number, opponent: number, score: 0 | 1, games: number, weight = 1): number {
  const change = Math.round(kFactor(games) * weight * (score - expectedScore(rating, opponent)));
  return Math.max(MIN_RATING, rating + change) - rating;
}

/** A new pair of partners starts from the average of their own singles ratings. */
export const seedDuoRating = (a: number, b: number): number => Math.round((a + b) / 2);
