/**
 * Output-path math shared by the scanner and the settings preview.
 *
 * These helpers are deliberately free of node imports: the renderer shows the
 * same mapping the scanner queues, so both must run the same code.
 */

/** Extension of the last path segment, including the dot (`''` when absent). */
function extensionOf(filePath: string): string {
  const segmentStart =
    Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')) + 1;
  const base = filePath.slice(segmentStart);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot);
}

/**
 * Rewrites a source-relative path into the destination-relative path the
 * scanner queues. `.srt` files keep their extension; everything else uses the
 * configured suffix and container.
 */
export function outputRelativePath(
  relativePath: string,
  suffix: string,
  container: string,
): string {
  const extension = extensionOf(relativePath);
  const base = extension
    ? relativePath.slice(0, -extension.length)
    : relativePath;

  if (extension.toLowerCase() === '.srt') {
    return `${base}.srt`;
  }
  return `${base}${suffix}${container}`;
}

/** Container extension used for output, defaulting to `.mp4` like the scanner. */
export function outputContainerExtension(container?: string): string {
  const trimmed = (container ?? '').trim();
  if (!trimmed) return '.mp4';
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
}

/**
 * Joins a destination root and a relative path without node's `path`, keeping
 * the separator style of the configured root.
 */
export function joinOutputPath(root: string, relativePath: string): string {
  const trimmedRoot = root.trim().replace(/[\\/]+$/, '');
  const usesBackslash = trimmedRoot.includes('\\') && !trimmedRoot.includes('/');
  const separator = usesBackslash ? '\\' : '/';
  const normalizedRelative = relativePath.replace(/[\\/]+/g, separator);
  const trimmedRelative = normalizedRelative.replace(/^[\\/]+/, '');
  if (!trimmedRelative) return trimmedRoot;
  if (!trimmedRoot) return trimmedRelative;
  return `${trimmedRoot}${separator}${trimmedRelative}`;
}
