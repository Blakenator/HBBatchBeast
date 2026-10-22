/** Display helpers for run telemetry. Kept unit-aware so charts and the table agree. */

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(value?: number | null, precision = 1): string {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return '—';
  }
  if (value < 1024) return `${Math.round(value)} B`;
  let unit = 0;
  let scaled = value;
  while (scaled >= 1024 && unit < BYTE_UNITS.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  const digits = scaled >= 100 ? 0 : precision;
  return `${scaled.toFixed(digits)} ${BYTE_UNITS[unit]}`;
}

/** `3725` -> `1h 02m`; durations under a minute keep seconds. */
export function formatDuration(seconds?: number | null): string {
  if (seconds === undefined || seconds === null || !Number.isFinite(seconds)) {
    return '—';
  }
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }
  if (minutes > 0) return `${minutes}m ${String(rest).padStart(2, '0')}s`;
  return `${rest}s`;
}

export function formatNumber(value?: number | null, digits = 0): string {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return '—';
  }
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatClock(timestamp?: number | null): string {
  if (!timestamp || !Number.isFinite(timestamp)) return '—';
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatPercent(value?: number | null, digits = 0): string {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return '—';
  }
  return `${value.toFixed(digits)}%`;
}

/** Byte change with an explicit sign; negative values mean the output shrank. */
export function formatSignedBytes(value?: number | null, precision = 1): string {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return '—';
  }
  if (value === 0) return formatBytes(0);
  const sign = value > 0 ? '+' : '−';
  return `${sign}${formatBytes(Math.abs(value), precision)}`;
}

/** Percentage change with an explicit sign; negative values mean a reduction. */
export function formatSignedPercent(
  value?: number | null,
  digits = 0,
): string {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return '—';
  }
  if (value === 0) return formatPercent(0, digits);
  const sign = value > 0 ? '+' : '−';
  return `${sign}${Math.abs(value).toFixed(digits)}%`;
}

/** First non-empty line of a multi-line error block. */
export function firstLine(text?: string): string | undefined {
  return text
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
}
