import type {
  EpisodeCandidate,
  MovieCandidate,
  OrganizeSourceFile,
  ParsedMediaName,
  TvdbEpisode,
  TvdbMovie,
} from './types';
import { episodeTag, normalizeTitle } from './filename';

/** Two-row Levenshtein; filenames are short, so this stays cheap. */
export function levenshtein(left: string, right: string): number {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;
  const previous = new Array<number>(right.length + 1);
  const current = new Array<number>(right.length + 1);
  for (let index = 0; index <= right.length; index += 1) {
    previous[index] = index;
  }
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    current[0] = leftIndex + 1;
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const substitution =
        previous[rightIndex] + (left[leftIndex] === right[rightIndex] ? 0 : 1);
      current[rightIndex + 1] = Math.min(
        previous[rightIndex + 1] + 1,
        current[rightIndex] + 1,
        substitution,
      );
    }
    for (let index = 0; index <= right.length; index += 1) {
      previous[index] = current[index];
    }
  }
  return previous[right.length];
}

export function similarity(left: string, right: string): number {
  const a = normalizeTitle(left);
  const b = normalizeTitle(right);
  if (!a && !b) return 0;
  if (a === b) return 1;
  const distance = levenshtein(a, b);
  return Math.max(0, 1 - distance / Math.max(a.length, b.length, 1));
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function candidateReason(parsed: ParsedMediaName, episode: TvdbEpisode): string {
  if (
    parsed.seasonNumber === episode.seasonNumber &&
    (parsed.episodeNumbers ?? []).includes(episode.episodeNumber)
  ) {
    return `Filename tag matches ${episodeTag(
      episode.seasonNumber,
      episode.episodeNumber,
    )}`;
  }
  if (parsed.airDate && episode.airDate && parsed.airDate === episode.airDate) {
    return `Air date matches ${episode.airDate}`;
  }
  if (parsed.title) return `Title matches "${episode.name}"`;
  return 'Closest available episode';
}

export function scoreEpisode(
  parsed: ParsedMediaName,
  episode: TvdbEpisode,
): { score: number; confidence: number; reason: string } {
  const explicitTag =
    parsed.seasonNumber !== undefined &&
    (parsed.episodeNumbers ?? []).includes(episode.episodeNumber) &&
    parsed.seasonNumber === episode.seasonNumber;

  if (explicitTag) {
    return {
      score: 1000,
      confidence: 1,
      reason: `Filename tag matches ${episode.tag || episodeTag(episode.seasonNumber, episode.episodeNumber)}`,
    };
  }

  if (
    parsed.airDate &&
    episode.airDate &&
    parsed.airDate === episode.airDate
  ) {
    return {
      score: 940,
      confidence: 0.96,
      reason: `Air date matches ${episode.airDate}`,
    };
  }

  const title = parsed.title || parsed.cleanTitle;
  const nameScore = similarity(title, episode.name);
  const tagNameScore = similarity(
    title,
    `${episode.tag || episodeTag(episode.seasonNumber, episode.episodeNumber)} ${episode.name}`,
  );
  const bestSimilarity = Math.max(nameScore, tagNameScore);
  const seasonPenalty =
    parsed.seasonNumber !== undefined &&
    parsed.seasonNumber !== episode.seasonNumber
      ? 0.45
      : 1;
  const score = bestSimilarity * 100 * seasonPenalty;
  return {
    score,
    confidence: clampConfidence((0.25 + bestSimilarity * 0.7) * seasonPenalty),
    reason: candidateReason(parsed, episode),
  };
}

export function rankEpisodes(
  parsed: ParsedMediaName,
  episodes: TvdbEpisode[],
  limit = 5,
): EpisodeCandidate[] {
  return episodes
    .map((episode) => {
      const scored = scoreEpisode(parsed, episode);
      return { episode, ...scored };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.episode.seasonNumber - right.episode.seasonNumber ||
        left.episode.episodeNumber - right.episode.episodeNumber,
    )
    .slice(0, limit);
}

export function scoreMovie(
  parsed: ParsedMediaName,
  movie: TvdbMovie,
): { score: number; confidence: number; reason: string } {
  const titleScore = similarity(parsed.title || parsed.cleanTitle, movie.title);
  const sameYear = Boolean(
    parsed.year && movie.year && parsed.year === movie.year,
  );
  const yearMismatch = Boolean(
    parsed.year && movie.year && parsed.year !== movie.year,
  );
  const score =
    titleScore * 100 + (sameYear ? 25 : 0) - (yearMismatch ? 35 : 0);
  const confidence = clampConfidence(
    titleScore * 0.75 + (sameYear ? 0.25 : 0) - (yearMismatch ? 0.2 : 0),
  );
  const reason =
    titleScore >= 0.99 && sameYear
      ? `Exact title and year match (${movie.year})`
      : sameYear
        ? `Title matches "${movie.title}" and year ${movie.year}`
        : `Title matches "${movie.title}"`;
  return { score, confidence, reason };
}

export function rankMovies(
  parsed: ParsedMediaName,
  movies: TvdbMovie[],
  limit = 5,
): MovieCandidate[] {
  return movies
    .map((movie) => ({ movie, ...scoreMovie(parsed, movie) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

export function chooseBestEpisode(
  file: OrganizeSourceFile,
  parsed: ParsedMediaName,
  episodes: TvdbEpisode[],
): EpisodeCandidate | undefined {
  const [best] = rankEpisodes(parsed, episodes, 1);
  if (!best) return undefined;
  return best;
}

export function chooseBestMovie(
  parsed: ParsedMediaName,
  movies: TvdbMovie[],
): MovieCandidate | undefined {
  const [best] = rankMovies(parsed, movies, 1);
  return best;
}
