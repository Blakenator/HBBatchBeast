import type {
  PresetCatalogEntry,
  PresetRule,
  PresetTrace,
} from '../../common';
import type { FilterTrace } from '../../common/filterExpression';
import type { RawProbe } from '../helpers/ffprobe';
import {
  evaluateFilterExpression,
  type FilterEvaluationContext,
} from './filterEvaluation';

export interface PresetResolution {
  argument: string;
  trace: PresetTrace;
}

export interface ResolvePresetOptions {
  rules: PresetRule[];
  catalog: PresetCatalogEntry[];
  defaultPresetId: string;
  defaultArgument: string;
  context: FilterEvaluationContext;
  probe: () => Promise<RawProbe | undefined>;
}

function catalogEntry(
  catalog: PresetCatalogEntry[],
  id: string,
): PresetCatalogEntry | undefined {
  return catalog.find((entry) => entry.id === id);
}

/**
 * Ordered first-match mapping. A rule only wins when its whole condition tree
 * includes the file; otherwise the library default is used.
 */
export async function resolvePresetForFile(
  options: ResolvePresetOptions,
): Promise<PresetResolution> {
  for (const rule of options.rules) {
    let trace: FilterTrace;
    try {
      trace = await evaluateFilterExpression(rule.condition, options.context, {
        probe: options.probe,
      });
    } catch {
      // A malformed saved rule must not abort the whole scan; fall through to
      // the next rule (and ultimately the library default).
      continue;
    }
    if (trace.outcome !== 'included') continue;
    // Filter evaluation treats an unreadable probe as "pass" so it does not
    // exclude a file. A preset rule must not guess from missing media data.
    if (trace.entries.some((entry) => entry.status === 'error')) continue;
    const preset = catalogEntry(options.catalog, rule.presetId);
    if (!preset) continue;
    return {
      argument: preset.argument,
      trace: {
        presetId: preset.id,
        presetName: preset.name,
        ruleId: rule.id,
        ruleName: rule.name?.trim() || undefined,
      },
    };
  }

  const fallback =
    catalogEntry(options.catalog, options.defaultPresetId) ??
    options.catalog[0];
  return {
    argument: fallback?.argument ?? options.defaultArgument,
    trace: {
      presetId: fallback?.id ?? options.defaultPresetId,
      presetName: fallback?.name ?? '',
    },
  };
}
