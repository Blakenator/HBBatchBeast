import path from 'path';
import { BatchTabConfig } from './types';

/**
 * Defaults used when a profile is created from scratch. A scan with no file
 * types matches nothing, so new profiles need the same baseline the legacy app
 * shipped with.
 */
export const DEFAULT_INCLUDED_FILE_TYPES =
  'mp4,mkv,mov,m4v,mpg,mpeg,avi,flv,webm,wmv,vob,evo,mts,m2ts,ts,iso';

/** Marker inserted before the extension while a conversion is in progress. */
export const TEMP_MARKER = '.temp';

/** In-progress marking is on unless a profile explicitly turns it off. */
export const DEFAULT_TEMP_MARKER_TOGGLE = 1;

export function isTempMarkerEnabled(
  advanced?: Partial<BatchTabConfig['advanced']>,
): boolean {
  return advanced?.temp_marker_toggle !== 0;
}

/**
 * `movie.mkv` -> `movie.temp.mkv`. Keeping the extension last matters: both
 * HandBrake and FFmpeg pick their output container from it, and `movie.mkv.temp`
 * would silently produce an MP4 instead of Matroska.
 */
export function withTempMarker(filePath: string): string {
  const extension = path.extname(filePath);
  if (!extension) return `${filePath}${TEMP_MARKER}`;
  return `${filePath.slice(0, -extension.length)}${TEMP_MARKER}${extension}`;
}
