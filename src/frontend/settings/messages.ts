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
      'These preferences apply to the app and are shared by every library.',
  },
  mappingFolderCategory: { defaultMessage: 'Folder' },
  mappingFolder: { defaultMessage: 'Folder' },
  mappingFolderDescription: {
    defaultMessage: 'Match a library folder and an optional subfolder.',
  },
  mappingFolderIs: { defaultMessage: 'is' },
  mappingFolderIsUnder: { defaultMessage: 'is under' },
  librarySettings: { defaultMessage: 'Libraries' },
  librarySettingsDescription: {
    defaultMessage:
      'Libraries store folders, scan filters, encoders, containers and preset mapping rules.',
  },
  presetSettings: { defaultMessage: 'Presets' },
  presetSettingsDescription: {
    defaultMessage:
      'Reusable encoding recipes referenced by library defaults and mapping rules.',
  },
  workerProcesses: { defaultMessage: 'Worker processes' },
  workerProcessesHelp: {
    defaultMessage:
      'Shared by all libraries. More workers use more CPU, memory, and GPU resources.',
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
  open: { defaultMessage: 'Open' },
  openSourceFolder: { defaultMessage: 'Open source folder' },
  openDestinationFolder: { defaultMessage: 'Open destination folder' },
  openFolderFailed: { defaultMessage: 'Could not open folder' },
  addRow: { defaultMessage: 'Add row' },
  addFolders: { defaultMessage: 'Add folders…' },
  folderRowsHelp: {
    defaultMessage:
      'Each row pairs one source folder with its destination (and temp folder when staging is on). Subfolders keep their layout under the destination. Paste several paths to fill rows at once.',
  },
  folderPreviewLabel: { defaultMessage: 'Example output' },
  sharedDestinationWarningOne: {
    defaultMessage:
      'Row {rows} also writes here — the folder trees merge, so matching relative paths would overwrite each other.',
  },
  sharedDestinationWarningMany: {
    defaultMessage:
      'Rows {rows} also write here — the folder trees merge, so matching relative paths would overwrite each other.',
  },
  missingSource: { defaultMessage: 'Add a source folder for this row.' },
  missingDestination: { defaultMessage: 'Add a destination folder for this row.' },
  missingTemp: { defaultMessage: 'Add a temp folder for this row.' },
  destinationInsideSource: {
    defaultMessage:
      'Destination is inside the source folder — choose a folder outside it.',
  },

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
  batchHook: { defaultMessage: 'Batch file to run after each file' },
  pickBatchFile: { defaultMessage: 'Choose a batch file' },
  batchFileFilters: { defaultMessage: 'Batch scripts' },
  allProblems: { defaultMessage: 'Fix these before starting a run:' },

  filterTab: { defaultMessage: 'Filters' },
  filterTabDescription: {
    defaultMessage:
      'Build the rules that decide which files enter the queue. Stages are evaluated in order and every stage is shown in the queue trace.',
  },
  filterRulesTitle: { defaultMessage: 'Scan rules' },
  filterRulesHelp: {
    defaultMessage:
      'Rules are combined with AND/OR groups. Unused filters stay in the Add stage menu.',
  },
  filterCategoryFile: { defaultMessage: 'File' },
  filterCategorySize: { defaultMessage: 'Size' },
  filterCategoryOutput: { defaultMessage: 'Output' },
  filterCategoryMedia: { defaultMessage: 'Media property' },
  filterFileType: { defaultMessage: 'File type' },
  filterFileTypeDescription: {
    defaultMessage: 'Matches files by extension.',
  },
  filterFileTypeIsAnyOf: { defaultMessage: 'is any of' },
  filterFileTypeIsNoneOf: { defaultMessage: 'is none of' },
  filterFileName: { defaultMessage: 'Filename' },
  filterFileNameDescription: {
    defaultMessage: 'Matches words inside the file name.',
  },
  filterFileNameContainsAny: { defaultMessage: 'contains any of' },
  filterFileNameContainsNone: { defaultMessage: 'contains none of' },
  filterFileSize: { defaultMessage: 'File size' },
  filterFileSizeDescription: {
    defaultMessage: 'Compares the source file size in decimal megabytes.',
  },
  filterFileSizeAtLeast: { defaultMessage: 'is at least' },
  filterFileSizeAtMost: { defaultMessage: 'is at most' },
  filterFileSizeBetween: { defaultMessage: 'is between' },
  filterOutputState: { defaultMessage: 'Output state' },
  filterOutputStateDescription: {
    defaultMessage: 'Checks whether the destination already has a completed output.',
  },
  filterOutputStateIs: { defaultMessage: 'is' },
  filterOutputStateIsNot: { defaultMessage: 'is not' },
  filterOutputConverted: { defaultMessage: 'already converted' },
  filterMediaProperty: { defaultMessage: 'Media property' },
  filterMediaPropertyDescription: {
    defaultMessage:
      'Matches an ffprobe stream field. Pick a known property or type any top-level stream key.',
  },
  filterMediaPropertyEquals: { defaultMessage: 'equals' },
  filterMediaPropertyNotEquals: { defaultMessage: 'does not equal' },
  filterMediaPropertyContains: { defaultMessage: 'contains' },
  filterMediaPropertyGt: { defaultMessage: 'is greater than' },
  filterMediaPropertyLt: { defaultMessage: 'is less than' },
  filterActionsTitle: { defaultMessage: 'Filtered file handling' },
  filterCopyFiltered: {
    defaultMessage: 'Copy filtered-out files to the destination',
  },
  filterCopySrt: { defaultMessage: 'Copy .srt sidecars' },
  filterCopyFilteredHelp: {
    defaultMessage:
      'Files stopped by a rule are copied instead of skipped. Files already converted or replaced are never copied.',
  },
  filterCopySrtHelp: {
    defaultMessage:
      'Subtitle sidecars are copied next to the output and never converted.',
  },
  filterTypeIgnored: {
    defaultMessage: '{count, plural, one {# file ignored by type} other {# files ignored by type}}',
  },
  filterProblemPrefix: { defaultMessage: 'Filters: {problem}' },
});

