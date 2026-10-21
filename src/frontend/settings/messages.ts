import { createMessages } from '../core/utils';

export const settingsMessages = createMessages({
  sourceFolders: {
    defaultMessage: 'Source folders',
  },
  destinationFolders: {
    defaultMessage: 'Destination folders',
  },
  savedConfig: {
    defaultMessage: 'Saved config',
  },
  customPreset: {
    defaultMessage: 'Custom preset',
  },
  advanced: { defaultMessage: 'Advanced options' },
  advancedHint: { defaultMessage: 'Show or hide advanced options' },
  dangerTitle: { defaultMessage: 'Destructive options' },
  language: { defaultMessage: 'Language' },
  globalSettings: { defaultMessage: 'Global settings' },
  globalSettingsDescription: {
    defaultMessage:
      'These preferences apply to the app and are shared by every profile.',
  },
  profileSettings: { defaultMessage: 'Profile settings' },
  profileSettingsDescription: {
    defaultMessage:
      'Profiles store conversion behavior such as folders, encoders, presets, and file handling.',
  },
  workerProcesses: { defaultMessage: 'Worker processes' },
  workerProcessesHelp: {
    defaultMessage:
      'Shared by all profiles. More workers use more CPU, memory, and GPU resources.',
  },
  saveWorkerLogs: { defaultMessage: 'Save verbose worker logs' },
  saveWorkerLogsHelp: {
    defaultMessage:
      'App-wide setting. Writes additional per-worker log files and can use substantial disk space.',
  },

  rowLabel: { defaultMessage: 'Row {number}' },
  removeRow: { defaultMessage: 'Remove row {number}' },
  remove: { defaultMessage: 'Remove' },
  sourceFolder: { defaultMessage: 'Source' },
  destinationFolder: { defaultMessage: 'Destination' },
  tempFolder: { defaultMessage: 'Temp' },
  pickSourceFolder: { defaultMessage: 'Choose a source folder' },
  pickDestinationFolder: { defaultMessage: 'Choose a destination folder' },
  pickTempFolder: { defaultMessage: 'Choose a temp folder' },
  pickSourceFolders: { defaultMessage: 'Choose source folders' },
  addRow: { defaultMessage: 'Add row' },
  addFolders: { defaultMessage: 'Add folders…' },
  folderRowsHelp: {
    defaultMessage:
      'Each row pairs one source folder with its destination (and temp folder when staging is on). Paste several paths to fill rows at once.',
  },
  missingSource: { defaultMessage: 'Add a source folder for this row.' },
  missingDestination: { defaultMessage: 'Add a destination folder for this row.' },
  missingTemp: { defaultMessage: 'Add a temp folder for this row.' },
  destinationInsideSource: {
    defaultMessage:
      'Destination is inside the source folder — choose a folder outside it.',
  },

  removeToken: { defaultMessage: 'Remove {token}' },
  addDefaults: { defaultMessage: 'Add common video types' },

  propertyFilterMode: { defaultMessage: 'Property filter mode' },
  propertyFilterOff: { defaultMessage: 'Off' },
  propertyFilterAny: { defaultMessage: 'Match any' },
  propertyFilterAll: { defaultMessage: 'Match all' },
  propertyKey: { defaultMessage: 'Property name' },
  propertyValue: { defaultMessage: 'Property value' },
  removeProperty: { defaultMessage: 'Remove property filter' },

  presetUnavailableWarning: {
    defaultMessage:
      'This preset is not installed. Search for an installed preset or refresh the list to scan HandBrakeCLI again.',
  },
  scanningPresets: { defaultMessage: 'Scanning HandBrake presets…' },
  enterPreset: {
    defaultMessage: 'Search presets or type HandBrakeCLI arguments',
  },
  presetScanCount: {
    defaultMessage: '{count} presets found via {executable}',
  },
  presetScanFailed: {
    defaultMessage: 'Could not read presets: {error}',
  },
  refreshPresets: { defaultMessage: 'Refresh' },

  folderNumber: { defaultMessage: 'Folder {number}' },
  allFolders: { defaultMessage: 'All folders' },
  folderFieldLabel: { defaultMessage: 'Folder {number}: {field}' },
  folderFieldPartLabel: { defaultMessage: 'Folder {number}: {part}' },
  beforeInput: { defaultMessage: 'Before -i' },
  afterInput: { defaultMessage: 'After -i' },
  removeOrphanRow: { defaultMessage: 'Remove unused row' },
  noMatchingSource: { defaultMessage: 'No source folder matches this row.' },

  encoder: { defaultMessage: 'Encoder' },
  encoderHandBrake: { defaultMessage: 'HandBrake' },
  encoderFfmpeg: { defaultMessage: 'FFmpeg' },
  standardPresets: { defaultMessage: 'Preset per folder' },
  customPresets: { defaultMessage: 'Preset or arguments per folder' },
  ffmpegArguments: { defaultMessage: 'FFmpeg arguments per folder' },
  suffixRows: { defaultMessage: 'Filename suffix per folder' },
  hardwareEncoderWarning: {
    defaultMessage:
      'Hardware video encoding is selected. Multiple workers share GPU memory; reduce Worker processes if encodes fail to initialize or report out-of-memory errors.',
  },
  ffmpegArgsHelp: {
    defaultMessage:
      'Arguments before and after the input file. Commas separate the two halves, so avoid commas inside them.',
  },
  customArgsHelp: {
    defaultMessage:
      'Pick an installed preset, including presets saved in the HandBrake app, or type additional HandBrakeCLI arguments to pass after the input and output paths.',
  },
  suffixHelp: {
    defaultMessage:
      'Appended to the output filename for that folder. Leave empty to keep the original name.',
  },
  chooseContainer: { defaultMessage: 'Container' },
  containerHelp: {
    defaultMessage: 'Output file extension. HandBrake supports MP4 and MKV.',
  },
  minSize: { defaultMessage: 'Minimum size (MB)' },
  maxSize: { defaultMessage: 'Maximum size (MB)' },
  sizeRangeHelp: {
    defaultMessage: 'Files outside this range are filtered out of the queue.',
  },
  includeProperties: { defaultMessage: 'Include files with properties' },
  excludeProperties: { defaultMessage: 'Exclude files with properties' },
  includePropertiesHelp: {
    defaultMessage:
      'Match ffprobe stream properties. "Any" keeps a file when one pair matches; "All" requires every pair.',
  },
  excludePropertiesHelp: {
    defaultMessage:
      'Drop files whose streams match these ffprobe properties. "Any" drops on the first match; "All" requires every pair.',
  },
  batchHook: { defaultMessage: 'Batch file to run after each file' },
  pickBatchFile: { defaultMessage: 'Choose a batch file' },
  batchFileFilters: { defaultMessage: 'Batch scripts' },
  allProblems: { defaultMessage: 'Fix these before starting a run:' },
});
