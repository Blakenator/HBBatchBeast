import path from 'path';

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
  const extension = path.extname(relativePath);
  const base = extension
    ? relativePath.slice(0, -extension.length)
    : relativePath;

  if (extension.toLowerCase() === '.srt') {
    return `${base}.srt`;
  }
  return `${base}${suffix}${container}`;
}

export function destinationPath(
  root: string,
  relativePath: string,
): string {
  return path.join(root, relativePath);
}
