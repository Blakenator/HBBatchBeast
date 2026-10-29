import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  HandBrakePreset,
  HandBrakePresetScan,
  normalizePresetName,
  parseMappedRows,
} from '../../common';
import { processBudgetReached } from '../../main/processBudget';

/**
 * Where HandBrake may be installed. Callers can inject the platform, env and
 * home so discovery stays testable.
 */
export interface HandBrakeResolveOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
  /** Injectable for tests; defaults to `fs.statSync(...).isFile()`. */
  exists?: (filePath: string) => boolean;
}

function defaultExists(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * Executable names/paths HandBrake may be installed at. Bare names are resolved
 * through PATH by `execFile`; absolute paths cover the installers that do not
 * add HandBrakeCLI to PATH (notably the macOS app bundle and Windows Program
 * Files).
 */
export function handBrakeExecutableCandidates(
  options: HandBrakeResolveOptions = {},
): string[] {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const home = options.home ?? os.homedir();
  const candidates: string[] = [];

  if (platform === 'win32') {
    candidates.push('HandBrakeCLI.exe', 'HandBrakeCLI');
    const programFiles = env.ProgramFiles ?? 'C:\\Program Files';
    const programFilesX86 = env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    const programW6432 = env.ProgramW6432 ?? programFiles;
    const localAppData = env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
    for (const base of [programFiles, programFilesX86, programW6432]) {
      candidates.push(path.join(base, 'HandBrake', 'HandBrakeCLI.exe'));
    }
    candidates.push(
      path.join(localAppData, 'Programs', 'HandBrake', 'HandBrakeCLI.exe'),
      path.join(localAppData, 'HandBrake', 'HandBrakeCLI.exe'),
    );
    return [...new Set(candidates)];
  }

  candidates.push('HandBrakeCLI');
  if (platform === 'darwin') {
    candidates.push(
      '/opt/homebrew/bin/HandBrakeCLI',
      '/usr/local/bin/HandBrakeCLI',
      '/Applications/HandBrake.app/Contents/MacOS/HandBrakeCLI',
      path.join(
        home,
        'Applications',
        'HandBrake.app',
        'Contents',
        'MacOS',
        'HandBrakeCLI',
      ),
    );
  } else {
    candidates.push(
      '/usr/bin/HandBrakeCLI',
      '/usr/local/bin/HandBrakeCLI',
      '/bin/HandBrakeCLI',
      '/snap/bin/handbrake-cli',
      '/snap/bin/HandBrakeCLI',
      // Present when the app itself runs inside a Flatpak sandbox.
      '/app/bin/HandBrakeCLI',
    );
  }
  return [...new Set(candidates)];
}

/** First existing absolute candidate, otherwise the platform's bare command. */
export function resolveHandBrakeExecutable(
  options: HandBrakeResolveOptions = {},
): string {
  const exists = options.exists ?? defaultExists;
  const platform = options.platform ?? process.platform;
  for (const candidate of handBrakeExecutableCandidates(options)) {
    const isBareName = !candidate.includes('/') && !candidate.includes('\\');
    if (!isBareName && exists(candidate)) return candidate;
  }
  return platform === 'win32' ? 'HandBrakeCLI.exe' : 'HandBrakeCLI';
}

/**
 * Presets created in the HandBrake GUI live in a per-user `presets.json`.
 * `HandBrakeCLI --preset-list` only reports its built-ins unless that file is
 * imported explicitly, so a custom preset would otherwise be missing from the
 * picker — and unusable by `-Z` during a conversion.
 */
export function userPresetFiles(
  options: HandBrakeResolveOptions = {},
): string[] {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const home = options.home ?? os.homedir();
  const exists = options.exists ?? defaultExists;
  const candidates: string[] = [];

  if (platform === 'win32') {
    const appData = env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
    const localAppData = env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
    candidates.push(
      path.join(appData, 'HandBrake', 'presets.json'),
      path.join(localAppData, 'HandBrake', 'presets.json'),
    );
  } else if (platform === 'darwin') {
    candidates.push(
      path.join(home, 'Library', 'Application Support', 'HandBrake', 'presets.json'),
      path.join(
        home,
        'Library',
        'Containers',
        'fr.handbrake.HandBrake',
        'Data',
        'Library',
        'Application Support',
        'HandBrake',
        'presets.json',
      ),
    );
  } else {
    const configHome = env.XDG_CONFIG_HOME ?? path.join(home, '.config');
    candidates.push(
      path.join(configHome, 'ghb', 'presets.json'),
      // Flatpak
      path.join(
        home,
        '.var',
        'app',
        'fr.handbrake.ghb',
        'config',
        'ghb',
        'presets.json',
      ),
      // Snap packages
      path.join(home, 'snap', 'handbrake', 'current', '.config', 'ghb', 'presets.json'),
      path.join(
        home,
        'snap',
        'handbrake-jz',
        'current',
        '.config',
        'ghb',
        'presets.json',
      ),
    );
    if (env.SNAP_USER_DATA) {
      candidates.push(path.join(env.SNAP_USER_DATA, '.config', 'ghb', 'presets.json'));
    }
  }

  return [...new Set(candidates)].filter(exists);
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function dedupe(presets: HandBrakePreset[]): HandBrakePreset[] {
  const seen = new Set<string>();
  return presets.filter((preset) => {
    if (seen.has(preset.name)) return false;
    seen.add(preset.name);
    return true;
  });
}

function parseXmlPresetList(output: string): HandBrakePreset[] {
  const presets: HandBrakePreset[] = [];
  let category = 'Presets';

  for (const line of output.split(/\r?\n/)) {
    const categoryMatch = /<category\s+name="([^"]*)"/.exec(line);
    if (categoryMatch) category = decodeXml(categoryMatch[1]);

    const presetMatch = /<preset\s+name="([^"]*)"/.exec(line);
    if (presetMatch) {
      presets.push({ name: decodeXml(presetMatch[1]), category });
    }
  }

  return presets;
}

/**
 * Parses the indented list printed by `HandBrakeCLI --preset-list`:
 *
 * ```
 * General/
 *     Very Fast 1080p30
 *         Small H.264 video ...
 * ```
 *
 * Log noise (`[13:42:06] hb_init: ...`) and wrapped descriptions are ignored.
 * A small XML fallback keeps older HandBrake builds working.
 */
export function parseHandBrakePresetList(output: string): HandBrakePreset[] {
  if (/<preset\s+name=/.test(output)) return dedupe(parseXmlPresetList(output));

  const presets: HandBrakePreset[] = [];
  let category = 'Presets';
  let current: HandBrakePreset | null = null;
  let description: string[] = [];

  const flush = () => {
    if (!current) return;
    const text = description.join(' ').trim();
    presets.push({ ...current, ...(text ? { description: text } : {}) });
    current = null;
    description = [];
  };

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^\[[^\]]+\]/.test(trimmed)) continue;

    const indent = line.length - line.trimStart().length;
    if (indent === 0) {
      flush();
      if (trimmed.endsWith('/')) category = trimmed.slice(0, -1).trim();
      continue;
    }

    if (indent <= 4) {
      flush();
      current = { name: trimmed, category };
      continue;
    }

    if (current) description.push(trimmed);
  }
  flush();

  return dedupe(presets);
}

export function findUnavailableHandBrakePresets(
  value: string,
  presets: HandBrakePreset[],
): string[] {
  const installedNames = new Set(presets.map((preset) => preset.name));
  return [
    ...new Set(
      parseMappedRows(value)
        .map(normalizePresetName)
        .filter((name) => name.length > 0 && !installedNames.has(name)),
    ),
  ];
}

/**
 * HandBrake writes `--preset-list` to stderr on current releases and stdout on
 * older ones, so callers parse the concatenation of both streams.
 */
function runPresetList(
  executable: string,
  args: string[] = ['--preset-list'],
): Promise<{
  error?: NodeJS.ErrnoException;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (result: {
      error?: NodeJS.ErrnoException;
      stdout: string;
      stderr: string;
    }) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const child = execFile(
      executable,
      args,
      {
        encoding: 'utf8',
        timeout: 20000,
        maxBuffer: 16 * 1024 * 1024,
        // Never inherit a terminal/pipe: a CLI waiting on stdin would otherwise
        // stay alive after the app stops caring about the answer.
        windowsHide: true,
      },
      (error, stdout, stderr) =>
        done({
          error: (error as NodeJS.ErrnoException | null) ?? undefined,
          stdout: stdout ?? '',
          stderr: stderr ?? '',
        }),
    );
    child.stdin?.end();
  });
}

let cachedScan: HandBrakePresetScan | null = null;
let inFlight: Promise<HandBrakePresetScan> | null = null;

/**
 * Discovers presets from the HandBrakeCLI installed on this machine. The result
 * is cached for the session (and single-flight, so a repeated request cannot
 * spawn a second CLI); `refresh` re-runs the scan.
 */
export async function listHandBrakePresets({
  refresh = false,
}: { refresh?: boolean } = {}): Promise<HandBrakePresetScan> {
  if (!refresh && cachedScan) return cachedScan;
  if (!refresh && inFlight) return inFlight;

  if (processBudgetReached()) {
    return {
      available: false,
      presets: [],
      error:
        'The --max-parallel process budget is used up; finish other conversions before scanning presets.',
    };
  }

  const scan = (async (): Promise<HandBrakePresetScan> => {
    let lastError = '';

    for (const executable of handBrakeExecutableCandidates()) {
      const { error, stdout, stderr } = await runPresetList(executable);
      const builtIn = parseHandBrakePresetList(`${stdout}\n${stderr}`);
      if (builtIn.length === 0) {
        if (error?.code === 'ENOENT') continue;
        lastError = error?.message ?? 'HandBrakeCLI returned no presets.';
        continue;
      }

      // Import the GUI preset file(s) so user-created presets are selectable.
      const imported: HandBrakePreset[] = [];
      for (const file of userPresetFiles()) {
        const result = await runPresetList(executable, [
          '--preset-import-file',
          file,
          '--preset-list',
        ]);
        imported.push(
          ...parseHandBrakePresetList(`${result.stdout}\n${result.stderr}`),
        );
      }

      return {
        available: true,
        executable,
        presets: dedupe([...builtIn, ...imported]),
      };
    }

    return {
      available: false,
      presets: [],
      error: lastError || 'HandBrakeCLI was not found on PATH.',
    };
  })();

  inFlight = scan;
  try {
    cachedScan = await scan;
    return cachedScan;
  } finally {
    inFlight = null;
  }
}
