import { BrowserWindow, dialog } from 'electron';
import { PathPickerRequest, PathPickerResult } from '../../common';

/**
 * Opens the OS picker for a folder or file. Returns an empty list when the
 * dialog is cancelled so callers can leave the current value untouched.
 */
export async function pickPath({
  kind,
  multiple = false,
  title,
  defaultPath,
  filters,
}: PathPickerRequest): Promise<PathPickerResult> {
  const properties: Array<
    'openFile' | 'openDirectory' | 'multiSelections' | 'createDirectory'
  > = kind === 'folder' ? ['openDirectory'] : ['openFile'];
  if (kind === 'folder') properties.push('createDirectory');
  if (multiple) properties.push('multiSelections');

  const options: Electron.OpenDialogOptions = {
    title,
    defaultPath: defaultPath || undefined,
    properties,
    filters: kind === 'file' ? filters : undefined,
  };

  const window = BrowserWindow.getFocusedWindow();
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);

  return { canceled: result.canceled, paths: result.filePaths };
}
