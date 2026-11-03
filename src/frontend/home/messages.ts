import { createMessages } from '../core/utils';

export const homeMessages = createMessages({
  loading: { defaultMessage: 'Loading configuration…' },
  loadFailed: { defaultMessage: 'Could not load configuration' },
  settings: { defaultMessage: 'Settings' },
  close: { defaultMessage: 'Close' },
  back: { defaultMessage: 'Back' },
  home: { defaultMessage: 'Home' },
  homeQuestion: { defaultMessage: 'What do you want to do?' },
  convertTitle: { defaultMessage: 'Convert' },
  convertBody: {
    defaultMessage:
      'Re-encode video with a saved preset. Your saved libraries stay untouched.',
  },
  organizeTitle: { defaultMessage: 'Organize' },
  organizeBody: {
    defaultMessage:
      'Rename and move files into TV or movie folders. No conversion required.',
  },
  libraryCount: {
    defaultMessage:
      '{count, plural, =0 {No libraries yet} one {1 library} other {# libraries}}',
  },
  continueWith: { defaultMessage: 'Continue with {name}' },
  chooseConvert: { defaultMessage: 'Choose a library to convert' },
  chooseOrganize: { defaultMessage: 'Choose a library to organize' },
  oneOffTitle: { defaultMessage: 'One-off' },
  oneOffHint: { defaultMessage: 'Temporary setup; nothing is saved.' },
  oneOffConvert: { defaultMessage: 'Set up a one-off conversion' },
  oneOffOrganize: { defaultMessage: 'Set up a one-off organize' },
  oneOffPage: { defaultMessage: 'One-off conversion' },
  start: { defaultMessage: 'Start' },
  reviewSetup: { defaultMessage: 'Review setup' },
  ready: { defaultMessage: 'Ready' },
  needsFolders: { defaultMessage: 'Needs folders' },
  needsPreset: { defaultMessage: 'Needs preset' },
  needsSetup: { defaultMessage: 'Needs setup' },
  folderCount: {
    defaultMessage: '{count, plural, one {1 folder} other {# folders}}',
  },
  mappingRuleCount: {
    defaultMessage:
      '{count, plural, one {1 mapping rule} other {# mapping rules}}',
  },
  showCount: {
    defaultMessage:
      '{count, plural, one {1 show matched} other {# shows matched}}',
  },
  noPreset: { defaultMessage: 'No preset' },
  movies: { defaultMessage: 'Movies' },
  tv: { defaultMessage: 'TV' },
  plexMetadata: { defaultMessage: 'Plex metadata' },
  tvdbMetadata: { defaultMessage: 'TVDB metadata' },
  untitledLibrary: { defaultMessage: 'Untitled library' },
  lastUsed: { defaultMessage: 'Last used' },
  moreActions: { defaultMessage: 'More actions for {name}' },
  useOneOffCopy: { defaultMessage: 'Use a one-off copy' },
  noLibrariesTitle: { defaultMessage: 'No libraries yet' },
  noLibrariesBody: {
    defaultMessage:
      'Create a library in Settings, or start with a one-off session.',
  },
  noPresetsTitle: { defaultMessage: 'No conversion presets yet' },
  noPresetsBody: {
    defaultMessage: 'Add a preset in Settings before converting.',
  },
  openSettings: { defaultMessage: 'Open Settings' },
});

export const batchOperationResultsMessages = createMessages({
  index: { defaultMessage: 'Index' },
  filePath: { defaultMessage: 'File Path' },
  preset: { defaultMessage: 'Preset' },
  extraActions: { defaultMessage: 'Extra Action' },
  skippedFilter: { defaultMessage: 'Skip (Due to word filter)' },
  copyFilter: { defaultMessage: 'Copy (Due to word filter)' },
  copySRT: { defaultMessage: 'Copy srt' },
});
