import { parseCommandPair } from '../../common/configValues';
import { WorkerItemConfig } from './protocol';

export interface EncoderInvocation {
  executable: string;
  args: string[];
}

/**
 * Splits a preset/argument string into argv tokens.
 *
 * The tokens are passed to `spawn` without a shell, so only quoting needs
 * handling. Supports single quotes, double quotes, and backslash escapes.
 */
export function splitArguments(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: "'" | '"' | null = null;
  let hasContent = false;

  const push = () => {
    if (hasContent) tokens.push(current);
    current = '';
    hasContent = false;
  };

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (quote === "'") {
      if (char === "'") quote = null;
      else current += char;
      hasContent = true;
      continue;
    }

    if (quote === '"') {
      if (char === '"') {
        quote = null;
      } else if (char === '\\' && index + 1 < input.length) {
        const next = input[index + 1];
        if (next === '"' || next === '\\') {
          current += next;
          index += 1;
        } else {
          current += char;
        }
      } else {
        current += char;
      }
      hasContent = true;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      hasContent = true;
      continue;
    }

    if (char === '\\' && index + 1 < input.length) {
      current += input[index + 1];
      index += 1;
      hasContent = true;
      continue;
    }

    if (/\s/.test(char)) {
      push();
      continue;
    }

    current += char;
    hasContent = true;
  }

  if (quote !== null) {
    throw new Error(`Unterminated ${quote === "'" ? 'single' : 'double'} quote`);
  }

  push();
  return tokens;
}

/**
 * Builds an argv-based encoder invocation. HandBrake imports GUI presets
 * before the input; FFmpeg keeps its `input,output` pair around `-i`.
 */
export function buildEncoderInvocation(
  item: Pick<
    WorkerItemConfig,
    'encoder' | 'sourcePath' | 'outputPath'
  >,
): EncoderInvocation {
  const { encoder, sourcePath, outputPath } = item;

  if (encoder.kind === 'handbrake') {
    const imports = encoder.presetImportFiles.flatMap((file) => [
      '--preset-import-file',
      file,
    ]);
    return {
      executable: encoder.executable,
      args: [
        ...imports,
        '-i',
        sourcePath,
        '-o',
        outputPath,
        ...splitArguments(encoder.preset),
      ],
    };
  }

  const preset = parseCommandPair(encoder.preset);
  return {
    executable: encoder.executable,
    args: [
      ...splitArguments(preset.input),
      '-i',
      sourcePath,
      ...splitArguments(preset.output),
      outputPath,
    ],
  };
}
