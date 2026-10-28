import path from 'path';

export { outputRelativePath } from '../../common/outputPaths';

export function destinationPath(
  root: string,
  relativePath: string,
): string {
  return path.join(root, relativePath);
}
