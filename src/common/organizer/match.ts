import type {
  EpisodeAxisState,
  EpisodeCandidate,
  EpisodeConflictKind,
  EpisodeMatchComponent,
  EpisodeMatchEvidence,
  EpisodeMatchSummary,
  EpisodeResolution,
  MovieCandidate,
  OrganizeSourceFile,
  ParsedMediaName,
  TvdbEpisode,
  TvdbMovie,
} from './types';
import { episodeDisplayTag, episodeTag, titleComparisonKey } from './filename';

export interface EpisodeMatchOptions {
  /** TVDB series name, used to remove the show title from the filename title. */
  seriesName?: string;
}

export const NAME_MATCH_THRESHOLD = 0.78;
export const STRONG_NAME_MATCH_THRESHOLD = 0.9;
export const EPISODE_TAG_WEIGHT = 0.4;
export const EPISODE_NAME_WEIGHT = 0.5;
export const EPISODE_AIR_DATE_WEIGHT = 0.1;

const WEAK_CONFLICT_CAP = 0.45;
const STRONG_NAME_CAP = 0.8;
const AIR_DATE_CONFLICT_CAP = 0.85;

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
  const a = titleComparisonKey(left);
  const b = titleComparisonKey(right);
  if (!a && !b) return 0;
  if (a === b) return 1;
  const distance = levenshtein(a, b);
  return Math.max(0, 1 - distance / Math.max(a.length, b.length, 1));
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Drops a leading article so `The Deep` and `Deep` compare as the same title. */
function comparableTitle(value: string): string {
  const tokens = titleComparisonKey(value).split(' ').filter(Boolean);
  if (tokens.length > 1 && ['the', 'a', 'an'].includes(tokens[0])) {
    tokens.shift();
  }
  return tokens.join(' ');
}

function tokenize(value: string): string[] {
  return titleComparisonKey(value).split(' ').filter(Boolean);
}

/**
 * Blends character-level similarity with token overlap. Subtitle wording and
 * small edits still score well, while one shared word cannot carry a match.
 */
export function nameSimilarity(left: string, right: string): number {
  const a = comparableTitle(left);
  const b = comparableTitle(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const leftTokens = a.split(' ').filter(Boolean);
  const rightTokens = b.split(' ').filter(Boolean);
  const rightSet = new Set(rightTokens);
  const overlap = leftTokens.filter((token) => rightSet.has(token)).length;
  const dice = (2 * overlap) / (leftTokens.length + rightTokens.length);
  const coverage = overlap / rightTokens.length;
  return clampConfidence(
    0.5 * similarity(a, b) + 0.3 * dice + 0.2 * coverage,
  );
}

/** Removes a fuzzy contiguous series-name window from a title. */
function withoutSeriesName(
  title: string,
  seriesName: string,
): string | undefined {
  const titleTokens = tokenize(title);
  if (titleTokens.length === 0) return undefined;
  const seriesTokens = tokenize(seriesName).filter(
    (token) => !/^(19|20)\d{2}$/.test(token),
  );
  if (seriesTokens.length === 0 || seriesTokens.length > titleTokens.length) {
    return titleTokens.join(' ');
  }
  let bestIndex = -1;
  let bestScore = 0;
  for (
    let index = 0;
    index <= titleTokens.length - seriesTokens.length;
    index += 1
  ) {
    const window = titleTokens.slice(index, index + seriesTokens.length);
    const score = similarity(window.join(' '), seriesTokens.join(' '));
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  if (bestScore < 0.82 || bestIndex < 0) return titleTokens.join(' ');
  const residual = [
    ...titleTokens.slice(0, bestIndex),
    ...titleTokens.slice(bestIndex + seriesTokens.length),
  ];
  return residual.length > 0 ? residual.join(' ') : undefined;
}

/**
 * The filename's episode-title text, excluding the tag and (when known) the
 * show name. Returns `undefined` when the filename carries no usable title.
 */
export function episodeNameText(
  parsed: ParsedMediaName,
  seriesName?: string,
): string | undefined {
  if (parsed.episodeTitle) {
    return seriesName
      ? withoutSeriesName(parsed.episodeTitle, seriesName)
      : titleComparisonKey(parsed.episodeTitle) || undefined;
  }
  if (seriesName) return withoutSeriesName(parsed.title, seriesName);
  const hasTag =
    parsed.seasonNumber !== undefined &&
    (parsed.episodeNumbers?.length ?? 0) > 0;
  return hasTag ? undefined : titleComparisonKey(parsed.title) || undefined;
}

function parsedEpisodeNumbers(parsed: ParsedMediaName): number[] {
  if (parsed.episodeNumbers?.length) return parsed.episodeNumbers;
  return parsed.episodeNumber === undefined ? [] : [parsed.episodeNumber];
}

function hasTag(parsed: ParsedMediaName): boolean {
  return parsed.seasonNumber !== undefined && parsedEpisodeNumbers(parsed).length > 0;
}

function tagMatches(parsed: ParsedMediaName, episode: TvdbEpisode): boolean {
  return (
    parsed.seasonNumber === episode.seasonNumber &&
    parsedEpisodeNumbers(parsed).includes(episode.episodeNumber)
  );
}

function episodeLabel(episode: TvdbEpisode): string {
  return `${episodeDisplayTag(episode)} - ${episode.name}`;
}

function sameEpisode(left: TvdbEpisode, right: TvdbEpisode): boolean {
  if (left.id && right.id) return left.id === right.id;
  return (
    left.seasonNumber === right.seasonNumber &&
    left.episodeNumber === right.episodeNumber
  );
}

function sameEpisodeName(left: TvdbEpisode, right: TvdbEpisode): boolean {
  return titleComparisonKey(left.name) === titleComparisonKey(right.name);
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function component(
  kind: EpisodeMatchComponent['kind'],
  weight: number,
  present: boolean,
  state: EpisodeAxisState,
  detail: string,
  componentScore?: number,
  similarityValue?: number,
): EpisodeMatchComponent {
  return {
    kind,
    weight,
    present,
    state,
    contribution: present && componentScore !== undefined ? componentScore * weight : 0,
    detail,
    ...(componentScore !== undefined ? { componentScore } : {}),
    ...(similarityValue !== undefined ? { similarity: similarityValue } : {}),
  };
}

function candidateReason(
  episode: TvdbEpisode,
  evidence: EpisodeMatchEvidence,
): string {
  const label = episodeLabel(episode);
  const title = evidence.nameText ? `"${evidence.nameText}"` : 'the filename title';
  if (evidence.tag === 'correct' && evidence.name === 'correct') {
    return `Tag and filename title match ${label}`;
  }
  if (evidence.tag === 'correct' && evidence.name === 'missing') {
    return `Tag matches ${label} (no episode title in filename)`;
  }
  if (evidence.tag === 'correct' && evidence.name === 'incorrect') {
    return `Tag matches ${label} but ${title} does not (${percent(
      evidence.nameSimilarity,
    )})`;
  }
  if (evidence.tag === 'missing' && evidence.name === 'correct') {
    return `Filename title matches ${label} (${percent(
      evidence.nameSimilarity,
    )})`;
  }
  if (evidence.tag === 'missing' && evidence.name === 'incorrect') {
    return `No episode tag and ${title} does not match ${label}`;
  }
  if (evidence.tag === 'incorrect' && evidence.name === 'correct') {
    return `Filename title matches ${label} (${percent(
      evidence.nameSimilarity,
    )}); the tag points elsewhere`;
  }
  if (evidence.airDateMatch) return `Air date matches ${label}`;
  if (evidence.tag === 'incorrect') {
    return `Tag does not match ${label}`;
  }
  if (evidence.name === 'incorrect') {
    return `${title} does not match ${label}`;
  }
  return label;
}

export function scoreEpisode(
  parsed: ParsedMediaName,
  episode: TvdbEpisode,
  options: EpisodeMatchOptions = {},
): Omit<EpisodeCandidate, 'episode'> {
  const tagPresent = hasTag(parsed);
  const tagState: EpisodeAxisState = !tagPresent
    ? 'missing'
    : tagMatches(parsed, episode)
      ? 'correct'
      : 'incorrect';
  const nameText = episodeNameText(parsed, options.seriesName);
  const nameSimilarityValue = nameText
    ? nameSimilarity(nameText, episode.name)
    : 0;
  const nameState: EpisodeAxisState = !nameText
    ? 'missing'
    : nameSimilarityValue >= NAME_MATCH_THRESHOLD
      ? 'correct'
      : 'incorrect';
  const airDatePresent = Boolean(parsed.airDate && episode.airDate);
  const airDateMatch = Boolean(
    parsed.airDate && episode.airDate && parsed.airDate === episode.airDate,
  );
  const airDateState: EpisodeAxisState = !airDatePresent
    ? 'missing'
    : airDateMatch
      ? 'correct'
      : 'incorrect';

  const nameComponentScore =
    nameState === 'missing'
      ? undefined
      : nameState === 'correct'
        ? 0.8 + 0.2 * nameSimilarityValue
        : 0.5 * nameSimilarityValue;
  const components = [
    component(
      'tag',
      EPISODE_TAG_WEIGHT,
      tagPresent,
      tagState,
      tagState === 'correct'
        ? `Matches ${episodeDisplayTag(episode)}`
        : tagState === 'incorrect'
          ? `Tag points elsewhere than ${episodeDisplayTag(episode)}`
          : 'No episode tag in the filename',
      tagState === 'correct' ? 1 : 0,
    ),
    component(
      'name',
      EPISODE_NAME_WEIGHT,
      Boolean(nameText),
      nameState,
      nameText
        ? `${nameState === 'correct' ? 'Matches' : 'Does not match'} "${nameText}" (${percent(
            nameSimilarityValue,
          )})`
        : 'No episode title in the filename',
      nameComponentScore,
      nameText ? nameSimilarityValue : undefined,
    ),
    component(
      'airDate',
      EPISODE_AIR_DATE_WEIGHT,
      airDatePresent,
      airDateState,
      airDateMatch
        ? `Matches ${episode.airDate}`
        : airDatePresent
          ? `Filename date ${parsed.airDate} does not match ${episode.airDate}`
          : 'No air date',
      airDateMatch ? 1 : 0,
    ),
  ];
  const coverage = components
    .filter((entry) => entry.present)
    .reduce((total, entry) => total + entry.weight, 0);
  const contribution = components.reduce(
    (total, entry) => total + entry.contribution,
    0,
  );
  const rawScore = coverage > 0 ? contribution / coverage : 0;
  let confidenceBeforeCap = clampConfidence(
    rawScore * (0.8 + 0.2 * coverage),
  );
  if (airDateMatch && tagState !== 'correct' && nameState !== 'correct') {
    confidenceBeforeCap = Math.max(confidenceBeforeCap, 0.9);
  }
  const evidence: EpisodeMatchEvidence = {
    tag: tagState,
    name: nameState,
    nameSimilarity: nameSimilarityValue,
    ...(nameText ? { nameText } : {}),
    airDateMatch,
    components,
    coverage,
    rawScore,
    confidenceBeforeCap,
  };
  const score =
    confidenceBeforeCap * 1000 +
    (tagState === 'correct' ? 40 : 0) +
    (nameState === 'correct' ? 30 : 0) +
    (airDateMatch ? 20 : 0);
  return {
    score,
    confidence: confidenceBeforeCap,
    reason: candidateReason(episode, evidence),
    evidence,
  };
}

export function rankEpisodes(
  parsed: ParsedMediaName,
  episodes: TvdbEpisode[],
  limit = 5,
  options: EpisodeMatchOptions = {},
): EpisodeCandidate[] {
  return episodes
    .map((episode) => {
      const scored = scoreEpisode(parsed, episode, options);
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

function conflictTags(
  tagCandidate: EpisodeCandidate | undefined,
  nameCandidate: EpisodeCandidate | undefined,
  airDateCandidate: EpisodeCandidate | undefined,
): EpisodeMatchSummary['suggestedTags'] | undefined {
  const suggested = {
    ...(tagCandidate ? { tag: episodeDisplayTag(tagCandidate.episode) } : {}),
    ...(nameCandidate ? { name: episodeDisplayTag(nameCandidate.episode) } : {}),
    ...(airDateCandidate
      ? { airDate: episodeDisplayTag(airDateCandidate.episode) }
      : {}),
  };
  return Object.keys(suggested).length > 0 ? suggested : undefined;
}

/**
 * Resolves the tag, title and air-date signals together. A single strong signal
 * wins; conflicting weak signals stay below the review threshold.
 */
export function resolveEpisode(
  parsed: ParsedMediaName,
  episodes: TvdbEpisode[],
  options: EpisodeMatchOptions = {},
): EpisodeResolution {
  if (episodes.length === 0) {
    return { confidence: 0, reason: 'No episodes available', conflict: false };
  }
  const ranked = episodes
    .map((episode) => {
      const scored = scoreEpisode(parsed, episode, options);
      return { episode, ...scored };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.episode.seasonNumber - right.episode.seasonNumber ||
        left.episode.episodeNumber - right.episode.episodeNumber,
    );

  const tagPresent = hasTag(parsed);
  const nameText = episodeNameText(parsed, options.seriesName);
  const namePresent = Boolean(nameText);
  const tagCandidate = tagPresent
    ? ranked.find((candidate) => candidate.evidence.tag === 'correct')
    : undefined;
  let nameCandidate = ranked.find(
    (candidate) => candidate.evidence.name === 'correct',
  );
  const nameCandidates = ranked.filter(
    (candidate) => candidate.evidence.name === 'correct',
  );
  const airDateCandidate = parsed.airDate
    ? ranked.find((candidate) => candidate.evidence.airDateMatch)
    : undefined;

  // Same named episodes in different seasons are not a conflict; the tag is
  // simply breaking the tie.
  if (
    tagCandidate &&
    nameCandidate &&
    !sameEpisode(tagCandidate.episode, nameCandidate.episode) &&
    sameEpisodeName(tagCandidate.episode, nameCandidate.episode)
  ) {
    nameCandidate = tagCandidate;
  }

  const tagUnresolved = tagPresent && !tagCandidate;
  const nameUnresolved = namePresent && !nameCandidate;
  const uniqueSignals: EpisodeCandidate[] = [];
  for (const candidate of [tagCandidate, nameCandidate, airDateCandidate]) {
    if (
      candidate &&
      !uniqueSignals.some((entry) => sameEpisode(entry.episode, candidate.episode))
    ) {
      uniqueSignals.push(candidate);
    }
  }

  const hasConflict =
    uniqueSignals.length > 1 ||
    (tagUnresolved && Boolean(nameCandidate || airDateCandidate)) ||
    (nameUnresolved && Boolean(tagCandidate || airDateCandidate));

  let best: EpisodeCandidate;
  let confidence: number;
  let conflict = false;
  let conflictKind: EpisodeConflictKind | undefined;
  let conflictReason: string | undefined;
  let cap: number | undefined;

  const describeSignals = () => {
    const parts: string[] = [];
    if (tagCandidate) {
      parts.push(`tag ${episodeLabel(tagCandidate.episode)}`);
    } else if (tagPresent) {
      parts.push(
        `tag ${episodeTag(
          parsed.seasonNumber ?? 0,
          parsedEpisodeNumbers(parsed)[0] ?? 0,
        )} (not in TVDB)`,
      );
    }
    if (nameCandidate) {
      parts.push(
        `filename title "${nameCandidate.evidence.nameText}" -> ${episodeLabel(
          nameCandidate.episode,
        )}`,
      );
    } else if (namePresent) {
      parts.push(`filename title "${nameText}" (no episode match)`);
    }
    if (airDateCandidate) {
      parts.push(
        `air date ${parsed.airDate} -> ${episodeLabel(airDateCandidate.episode)}`,
      );
    }
    return parts.join(' vs ');
  };

  if (hasConflict) {
    conflict = true;
    if (airDateCandidate) {
      best = airDateCandidate;
      cap = AIR_DATE_CONFLICT_CAP;
      confidence = Math.min(best.confidence, AIR_DATE_CONFLICT_CAP);
      conflictKind =
        (tagCandidate || tagUnresolved) && (nameCandidate || nameUnresolved)
          ? 'tag-name-air-date'
          : tagCandidate || tagUnresolved
            ? 'tag-vs-air-date'
            : 'name-vs-air-date';
      conflictReason = `Conflicting signals (${describeSignals()}); used the air date match ${episodeLabel(
        best.episode,
      )}. Review recommended.`;
    } else if (tagCandidate && nameCandidate) {
      conflictKind = 'tag-vs-name';
      if (nameCandidate.evidence.nameSimilarity >= STRONG_NAME_MATCH_THRESHOLD) {
        best = nameCandidate;
        cap = STRONG_NAME_CAP;
        confidence = STRONG_NAME_CAP;
        conflictReason = `Tag ${episodeDisplayTag(tagCandidate.episode)} conflicts with filename title "${nameCandidate.evidence.nameText}" (${episodeLabel(
          nameCandidate.episode,
        )}); used the title match. Review recommended.`;
      } else {
        best =
          tagCandidate.confidence >= nameCandidate.confidence
            ? tagCandidate
            : nameCandidate;
        cap = WEAK_CONFLICT_CAP;
        confidence = Math.min(best.confidence, WEAK_CONFLICT_CAP);
        conflictReason = `Tag and filename title disagree (${describeSignals()}); review recommended.`;
      }
    } else if (nameCandidate) {
      conflictKind = 'tag-vs-name';
      best = nameCandidate;
      cap =
        nameCandidate.evidence.nameSimilarity >= STRONG_NAME_MATCH_THRESHOLD
          ? STRONG_NAME_CAP
          : WEAK_CONFLICT_CAP;
      confidence =
        cap === STRONG_NAME_CAP
          ? STRONG_NAME_CAP
          : Math.min(best.confidence, WEAK_CONFLICT_CAP);
      conflictReason = `The filename tag does not match an episode, but the title matches ${episodeLabel(
        best.episode,
      )}. Review recommended.`;
    } else if (tagCandidate) {
      conflictKind = 'tag-vs-name';
      best = tagCandidate;
      cap = WEAK_CONFLICT_CAP;
      confidence = Math.min(best.confidence, WEAK_CONFLICT_CAP);
      conflictReason = `Tag matches ${episodeLabel(
        best.episode,
      )} but the filename title does not (${describeSignals()}). Review recommended.`;
    } else {
      best = ranked[0];
      cap = WEAK_CONFLICT_CAP;
      confidence = Math.min(best.confidence, WEAK_CONFLICT_CAP);
      conflictReason = `Could not reconcile filename signals (${describeSignals()}). Review recommended.`;
    }
  } else {
    best =
      tagCandidate ??
      nameCandidate ??
      airDateCandidate ??
      ranked[0];
    confidence = best.confidence;
  }

  // Identical episode names with no tag or date cannot be disambiguated.
  if (
    !tagPresent &&
    !airDateCandidate &&
    nameCandidates.length > 1 &&
    Math.abs(
      nameCandidates[0].evidence.nameSimilarity -
        nameCandidates[1].evidence.nameSimilarity,
    ) < 0.02
  ) {
    conflict = true;
    conflictKind = 'ambiguous-name';
    best = nameCandidates[0];
    cap = WEAK_CONFLICT_CAP;
    confidence = Math.min(best.confidence, WEAK_CONFLICT_CAP);
    conflictReason = `Filename title matches multiple episodes (${nameCandidates
      .slice(0, 3)
      .map((candidate) => episodeLabel(candidate.episode))
      .join(', ')}); add a season/episode tag.`;
  }

  const evidence: EpisodeMatchEvidence = {
    ...best.evidence,
    ...(cap !== undefined ? { cap } : {}),
  };
  const suggestedTags = conflict
    ? conflictTags(tagCandidate, nameCandidate, airDateCandidate)
    : undefined;
  const summary: EpisodeMatchSummary = {
    ...evidence,
    conflict,
    ...(conflictKind ? { conflictKind } : {}),
    ...(conflictReason ? { conflictReason } : {}),
    ...(suggestedTags ? { suggestedTags } : {}),
  };
  return {
    episode: best.episode,
    candidate: best,
    confidence,
    reason: conflictReason ?? best.reason,
    summary,
    conflict,
    ...(conflictKind ? { conflictKind } : {}),
    ...(conflictReason ? { conflictReason } : {}),
    ...(tagCandidate ? { tagCandidate } : {}),
    ...(nameCandidate ? { nameCandidate } : {}),
    ...(airDateCandidate ? { airDateCandidate } : {}),
  };
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
  options: EpisodeMatchOptions = {},
): EpisodeCandidate | undefined {
  const [best] = rankEpisodes(parsed, episodes, 1, options);
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
