import React, { useMemo, useState } from 'react';
import styled from 'styled-components';
import { useIntl } from 'react-intl';
import type { EChartsCoreOption } from 'echarts/core';
import { summarizeSizeChanges } from '../../common/runTelemetry';
import { RunItemState, RunStatePayload } from './types';
import { RunTelemetry } from './useRunTelemetry';
import { runMessages } from './messages';
import { EChart } from './EChart';
import { useThemeMode } from '../ui/useThemeMode';
import { tokens } from '../ui/theme';
import { SegmentedControl } from '../settings/SegmentedControl';
import {
  formatBytes,
  formatClock,
  formatDuration,
  formatNumber,
  formatPercent,
  formatSignedBytes,
  formatSignedPercent,
} from './format';

const Grid = styled.div`
  display: grid;
  gap: var(--hb-space-lg);
  grid-template-columns: repeat(auto-fit, minmax(min(230px, 100%), 1fr));
  margin-bottom: var(--hb-space-lg);
`;

const Card = styled.section`
  background: var(--hb-surface);
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-md);
  padding: var(--hb-space-md);
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--hb-space-xs);
`;

const CardTitle = styled.h3`
  margin: 0;
  font-size: var(--hb-font-xs);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--hb-textMuted);
`;

const CardHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--hb-space-sm);
  flex-wrap: wrap;
`;

const SizeLegend = styled.div`
  display: flex;
  align-items: center;
  gap: var(--hb-space-sm);
  font-size: var(--hb-font-xs);
  color: var(--hb-textMuted);
`;

const LegendItem = styled.span`
  display: inline-flex;
  align-items: center;
  gap: var(--hb-space-xs);
`;

const Metric = styled.div`
  font-size: var(--hb-font-xl);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
`;

const Unit = styled.span`
  margin-left: var(--hb-space-xs);
  font-size: var(--hb-font-xs);
  font-weight: 500;
  color: var(--hb-textMuted);
`;

const Hint = styled.div`
  font-size: var(--hb-font-xs);
  color: var(--hb-textMuted);
  font-variant-numeric: tabular-nums;
`;

const ChartRow = styled.div`
  display: flex;
  align-items: center;
  gap: var(--hb-space-md);
  min-width: 0;
`;

const DonutWrap = styled.div`
  flex: 0 0 116px;
  width: 116px;
  min-width: 0;
`;

const Legend = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 2px;
  font-size: var(--hb-font-xs);
  min-width: 0;
  width: 100%;
`;

const LegendRow = styled.li<{ $muted?: boolean }>`
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--hb-space-sm);
  color: ${({ $muted }) => ($muted ? 'var(--hb-textMuted)' : 'var(--hb-text)')};
`;

const Swatch = styled.span<{ $color: string }>`
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: ${({ $color }) => $color};
`;

const LegendLabel = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const LegendCount = styled.span`
  font-variant-numeric: tabular-nums;
  font-weight: 600;
`;

interface Segment {
  key: string;
  label: string;
  value: number;
  color: string;
}

const ChartLegend: React.FC<{ segments: Segment[] }> = ({ segments }) => (
  <Legend>
    {segments.map((segment) => (
      <LegendRow key={segment.key} $muted={segment.value === 0}>
        <Swatch $color={segment.color} aria-hidden="true" />
        <LegendLabel>{segment.label}</LegendLabel>
        <LegendCount>{formatNumber(segment.value)}</LegendCount>
      </LegendRow>
    ))}
  </Legend>
);

interface RunChartsProps {
  state: RunStatePayload;
  telemetry: RunTelemetry;
}

const SIZE_CHART_LIMIT = 60;

export const RunCharts: React.FC<RunChartsProps> = ({ state, telemetry }) => {
  const { formatMessage } = useIntl();
  const mode = useThemeMode();
  const theme = tokens.color[mode];

  const stateColors: Record<RunItemState, string> = useMemo(
    () => ({
      pending: theme.border,
      running: theme.accent,
      success: theme.success,
      error: theme.danger,
      cancelled: theme.warning,
      excluded: theme.textMuted,
      skipped: theme.textMuted,
    }),
    [theme],
  );

  const tooltip = useMemo(
    () => ({
      backgroundColor: theme.surface,
      borderColor: theme.border,
      textStyle: { color: theme.text, fontSize: 12 },
    }),
    [theme],
  );

  const counts = state.counts;
  const done =
    counts.success +
    counts.error +
    counts.cancelled +
    counts.excluded +
    counts.skipped;
  const [sizeView, setSizeView] = useState<'absolute' | 'percent'>('absolute');

  const statusSegments = useMemo<Segment[]>(
    () =>
      (
        [
          'running',
          'pending',
          'success',
          'error',
          'cancelled',
          'excluded',
          'skipped',
        ] as const
      ).map(
        (key) => ({
          key,
          label: formatMessage(runMessages[key]),
          value: counts[key],
          color: stateColors[key],
        }),
      ),
    [
      counts.running,
      counts.pending,
      counts.success,
      counts.error,
      counts.cancelled,
      counts.excluded,
      counts.skipped,
      stateColors,
      formatMessage,
    ],
  );

  const completionSegments = useMemo<Segment[]>(
    () => [
      {
        key: 'converted',
        label: formatMessage(runMessages.converted),
        value: counts.success,
        color: theme.success,
      },
      {
        key: 'failed',
        label: formatMessage(runMessages.failed),
        value: counts.error,
        color: theme.danger,
      },
      {
        key: 'other',
        label: formatMessage(runMessages.otherFinished),
        value: counts.cancelled + counts.excluded + counts.skipped,
        color: theme.warning,
      },
      {
        key: 'remaining',
        label: formatMessage(runMessages.remaining),
        value: counts.pending + counts.running,
        color: theme.border,
      },
    ],
    [
      counts.success,
      counts.error,
      counts.cancelled,
      counts.excluded,
      counts.skipped,
      counts.pending,
      counts.running,
      theme,
      formatMessage,
    ],
  );

  const donutOption = (
    segments: Segment[],
    centerValue: string,
    centerHint: string,
  ): EChartsCoreOption => ({
    backgroundColor: 'transparent',
    animationDuration: 150,
    title: [
      {
        text: centerValue,
        left: 'center',
        top: '37%',
        textStyle: { color: theme.text, fontSize: 17, fontWeight: 600 },
      },
      {
        text: centerHint,
        left: 'center',
        top: '55%',
        textStyle: { color: theme.textMuted, fontSize: 10, fontWeight: 400 },
      },
    ],
    tooltip: { ...tooltip, trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    series: [
      {
        type: 'pie',
        radius: ['58%', '80%'],
        center: ['50%', '50%'],
        avoidLabelOverlap: false,
        label: { show: false },
        labelLine: { show: false },
        itemStyle: { borderColor: theme.surface, borderWidth: 1 },
        emphasis: { scale: false },
        data: segments.map((segment) => ({
          name: segment.label,
          value: segment.value,
          itemStyle: { color: segment.color },
        })),
      },
    ],
  });

  const barOption = (values: number[], color: string): EChartsCoreOption => ({
    backgroundColor: 'transparent',
    animationDuration: 150,
    grid: { left: 0, right: 0, top: 4, bottom: 2 },
    xAxis: {
      type: 'category',
      show: false,
      data: values.map((_, index) => String(index)),
    },
    yAxis: { type: 'value', show: false, min: 0 },
    tooltip: {
      ...tooltip,
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: unknown) => {
        const point = Array.isArray(params) ? params[0] : undefined;
        const value = Number((point as { value?: number } | undefined)?.value);
        return `${formatNumber(Number.isFinite(value) ? value : 0, 1)} ${formatMessage(
          runMessages.perMinute,
        )}`;
      },
    },
    series: [
      {
        type: 'bar',
        data: values,
        barMaxWidth: 8,
        itemStyle: { color, borderRadius: [2, 2, 0, 0] },
      },
    ],
  });

  const lineOption = (
    values: number[],
    color: string,
    unit: string,
  ): EChartsCoreOption => ({
    backgroundColor: 'transparent',
    animationDuration: 150,
    grid: { left: 0, right: 0, top: 6, bottom: 2 },
    xAxis: { type: 'category', show: false, data: values.map((_, i) => String(i)) },
    yAxis: { type: 'value', show: false, min: 0 },
    tooltip: {
      ...tooltip,
      trigger: 'axis',
      formatter: (params: unknown) => {
        const point = Array.isArray(params) ? params[0] : undefined;
        const value = Number((point as { value?: number } | undefined)?.value);
        return `${formatNumber(Number.isFinite(value) ? value : 0, 1)} ${unit}`;
      },
    },
    series: [
      {
        type: 'line',
        data: values,
        smooth: true,
        showSymbol: false,
        lineStyle: { color, width: 2 },
        areaStyle: { color, opacity: 0.15 },
      },
    ],
  });

  const fileOption = useMemo(
    () =>
      barOption(
        telemetry.points.map((point) => point.filesPerMinute),
        theme.accent,
      ),
    [telemetry.points, theme, formatMessage],
  );
  const byteOption = useMemo(
    () =>
      lineOption(
        telemetry.points.map((point) => point.bytesPerSecond / (1024 * 1024)),
        theme.accent,
        formatMessage(runMessages.perSecond),
      ),
    [telemetry.points, theme, formatMessage],
  );
  const fpsOption = useMemo(
    () =>
      lineOption(
        telemetry.points.map((point) => point.fps),
        theme.success,
        formatMessage(runMessages.framesPerSecond),
      ),
    [telemetry.points, theme, formatMessage],
  );

  const sizeSummary = useMemo(
    () => summarizeSizeChanges(state.items),
    [state.items],
  );
  const sizePoints = useMemo(
    () => sizeSummary.points.slice(-SIZE_CHART_LIMIT),
    [sizeSummary],
  );

  const sizeAbsoluteOption = useMemo(() => {
    const pointAt = (params: unknown) => {
      const list = Array.isArray(params) ? params : [params];
      const index = Number(
        (list[0] as { dataIndex?: number } | undefined)?.dataIndex,
      );
      return Number.isInteger(index) ? sizePoints[index] : undefined;
    };
    return {
      backgroundColor: 'transparent',
      animationDuration: 150,
      grid: { left: 0, right: 0, top: 4, bottom: 2 },
      xAxis: {
        type: 'category',
        show: false,
        data: sizePoints.map((point) => point.path),
      },
      yAxis: { type: 'value', show: false, min: 0 },
      tooltip: {
        ...tooltip,
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        extraCssText: 'white-space: pre-line;',
        formatter: (params: unknown) => {
          const point = pointAt(params);
          if (!point) return '';
          const name = point.path.split(/[\\/]/).pop() ?? point.path;
          const change = formatSignedBytes(point.deltaBytes);
          const percent = formatSignedPercent(point.percent, 1);
          return point.expected
            ? formatMessage(runMessages.sizeExpectedTooltip, {
                name,
                written: formatBytes(point.writtenBytes),
                expected: formatBytes(point.afterBytes),
                change,
                percent,
              })
            : formatMessage(runMessages.sizeTooltip, {
                name,
                before: formatBytes(point.beforeBytes),
                after: formatBytes(point.afterBytes),
                change,
                percent,
              });
        },
      },
      series: [
        {
          name: formatMessage(runMessages.sizeBefore),
          type: 'bar',
          stack: 'before',
          data: sizePoints.map((point) => point.beforeBytes),
          barMaxWidth: 6,
          itemStyle: { color: theme.textMuted, borderRadius: [2, 2, 0, 0] },
        },
        {
          name: formatMessage(runMessages.sizeAfter),
          type: 'bar',
          stack: 'after',
          data: sizePoints.map((point) => ({
            value: point.expected ? point.writtenBytes : point.afterBytes,
            itemStyle: {
              color: theme.accent,
              borderRadius: point.expected ? [0, 0, 0, 0] : [2, 2, 0, 0],
            },
          })),
          barMaxWidth: 6,
        },
        {
          name: formatMessage(runMessages.sizeExpected),
          type: 'bar',
          stack: 'after',
          data: sizePoints.map((point) => ({
            value: point.expected
              ? Math.max(0, point.afterBytes - point.writtenBytes)
              : 0,
            itemStyle: {
              color: theme.accent,
              opacity: 0.35,
              borderRadius: [2, 2, 0, 0],
            },
          })),
          barMaxWidth: 6,
        },
      ],
    } as EChartsCoreOption;
  }, [sizePoints, tooltip, theme, formatMessage]);

  const sizePercentOption = useMemo(() => {
    const pointAt = (params: unknown) => {
      const list = Array.isArray(params) ? params : [params];
      const index = Number(
        (list[0] as { dataIndex?: number } | undefined)?.dataIndex,
      );
      return Number.isInteger(index) ? sizePoints[index] : undefined;
    };
    return {
      backgroundColor: 'transparent',
      animationDuration: 150,
      grid: { left: 0, right: 0, top: 8, bottom: 8 },
      xAxis: {
        type: 'category',
        show: false,
        data: sizePoints.map((point) => point.path),
      },
      yAxis: { type: 'value', show: false },
      tooltip: {
        ...tooltip,
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        extraCssText: 'white-space: pre-line;',
        formatter: (params: unknown) => {
          const point = pointAt(params);
          if (!point) return '';
          const name = point.path.split(/[\\/]/).pop() ?? point.path;
          const percent = formatSignedPercent(point.percent, 1);
          return point.expected
            ? formatMessage(runMessages.sizePercentExpectedTooltip, {
                name,
                percent,
                before: formatBytes(point.beforeBytes),
                after: formatBytes(point.afterBytes),
              })
            : formatMessage(runMessages.sizePercentTooltip, {
                name,
                percent,
                before: formatBytes(point.beforeBytes),
                after: formatBytes(point.afterBytes),
              });
        },
      },
      series: [
        {
          type: 'bar',
          data: sizePoints.map((point) => ({
            value: point.percent,
            itemStyle: {
              color:
                point.deltaBytes < 0
                  ? theme.success
                  : point.deltaBytes > 0
                    ? theme.danger
                    : theme.textMuted,
              opacity: point.expected ? 0.5 : 1,
              borderRadius:
                point.percent < 0 ? [0, 0, 2, 2] : [2, 2, 0, 0],
            },
          })),
          barMaxWidth: 8,
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: theme.border, width: 1 },
            data: [{ yAxis: 0 }],
          },
        },
      ],
    } as EChartsCoreOption;
  }, [sizePoints, tooltip, theme, formatMessage]);

  const statusOption = useMemo(
    () =>
      donutOption(
        statusSegments,
        formatNumber(telemetry.total),
        formatMessage(runMessages.filesLabel),
      ),
    [statusSegments, theme, telemetry.total, formatMessage],
  );
  const completionOption = useMemo(
    () =>
      donutOption(
        completionSegments,
        formatPercent(telemetry.fraction * 100),
        `${formatNumber(done)}/${formatNumber(telemetry.total)}`,
      ),
    [completionSegments, theme, telemetry.fraction, telemetry.total, done, formatMessage],
  );

  const megabytesPerSecond =
    telemetry.bytesPerSecond === null
      ? null
      : telemetry.bytesPerSecond / (1024 * 1024);

  const isComplete = state.status === 'completed';
  const isInterrupted = state.status === 'interrupted';
  const isPaused = state.status === 'paused';

  let remainingValue: string;
  let remainingHint: string;
  if (isInterrupted) {
    remainingValue = formatMessage(runMessages.interruptedLabel);
    remainingHint = formatMessage(runMessages.workDone, {
      done: formatNumber(done),
      total: formatNumber(telemetry.total),
    });
  } else if (isComplete) {
    remainingValue = formatMessage(runMessages.completeLabel);
    remainingHint = formatMessage(runMessages.elapsed, {
      duration: formatDuration(telemetry.elapsedSeconds),
    });
  } else if (isPaused) {
    remainingValue = formatMessage(runMessages.pausedLabel);
    remainingHint =
      telemetry.etaSeconds === null
        ? formatMessage(runMessages.workDone, {
            done: formatNumber(done),
            total: formatNumber(telemetry.total),
          })
        : formatMessage(runMessages.remainingWhenResumed, {
            duration: formatDuration(telemetry.etaSeconds),
          });
  } else if (telemetry.stalled) {
    remainingValue = formatMessage(runMessages.estimating);
    remainingHint = formatMessage(runMessages.stalled, { seconds: 15 });
  } else if (telemetry.etaSeconds === null) {
    remainingValue = formatMessage(runMessages.estimating);
    remainingHint = formatMessage(runMessages.workDone, {
      done: formatNumber(done),
      total: formatNumber(telemetry.total),
    });
  } else {
    remainingValue = formatDuration(telemetry.etaSeconds);
    remainingHint = formatMessage(runMessages.finishesAt, {
      time: formatClock(telemetry.finishAt),
    });
  }

  const sizePercentLabel =
    sizeSummary.percent === null
      ? '—'
      : formatSignedPercent(sizeSummary.percent);
  const sizeChangeLabel =
    sizeSummary.deltaBytes < 0
      ? formatMessage(runMessages.sizeSaved, {
          size: formatBytes(Math.abs(sizeSummary.deltaBytes)),
        })
      : sizeSummary.deltaBytes > 0
        ? formatMessage(runMessages.sizeLarger, {
            size: formatBytes(sizeSummary.deltaBytes),
          })
        : formatMessage(runMessages.sizeUnchanged);
  const sizeTotalsLabel = formatMessage(runMessages.sizeTotals, {
    before: formatBytes(sizeSummary.beforeBytes),
    after: formatBytes(sizeSummary.afterBytes),
    change: sizeChangeLabel,
    percent: sizePercentLabel,
  });
  const expectedPercentLabel =
    sizeSummary.expectedPercent === null
      ? '—'
      : formatSignedPercent(sizeSummary.expectedPercent);
  const expectedChangeLabel =
    sizeSummary.expectedDeltaBytes < 0
      ? formatMessage(runMessages.sizeSaved, {
          size: formatBytes(Math.abs(sizeSummary.expectedDeltaBytes)),
        })
      : sizeSummary.expectedDeltaBytes > 0
        ? formatMessage(runMessages.sizeLarger, {
            size: formatBytes(sizeSummary.expectedDeltaBytes),
          })
        : formatMessage(runMessages.sizeUnchanged);
  const expectedTotalsLabel = formatMessage(runMessages.sizeExpectedTotals, {
    count: formatNumber(sizeSummary.expectedFiles),
    before: formatBytes(sizeSummary.expectedBeforeBytes),
    after: formatBytes(sizeSummary.expectedAfterBytes),
    change: expectedChangeLabel,
    percent: expectedPercentLabel,
  });
  const sizeOmittedCount = sizeSummary.points.length - sizePoints.length;
  const hasActualSizes = sizeSummary.files > 0;
  const metricDelta = hasActualSizes
    ? sizeSummary.deltaBytes
    : sizeSummary.expectedDeltaBytes;
  const metricPercent = hasActualSizes
    ? sizePercentLabel
    : expectedPercentLabel;

  return (
    <Grid>
      <Card>
        <CardTitle>{formatMessage(runMessages.statusBreakdown)}</CardTitle>
        <ChartRow>
          <DonutWrap>
            <EChart
              option={statusOption}
              height={116}
              label={formatMessage(runMessages.statusBreakdown)}
            />
          </DonutWrap>
          <ChartLegend segments={statusSegments} />
        </ChartRow>
      </Card>

      <Card>
        <CardTitle>{formatMessage(runMessages.completion)}</CardTitle>
        <ChartRow>
          <DonutWrap>
            <EChart
              option={completionOption}
              height={116}
              label={formatMessage(runMessages.completion)}
            />
          </DonutWrap>
          <ChartLegend segments={completionSegments} />
        </ChartRow>
      </Card>

      <Card>
        <CardTitle>{formatMessage(runMessages.fileSpeed)}</CardTitle>
        <Metric>
          {telemetry.filesPerMinute === null
            ? '—'
            : formatNumber(telemetry.filesPerMinute, 1)}
          <Unit>{formatMessage(runMessages.perMinute)}</Unit>
        </Metric>
        <EChart
          option={fileOption}
          height={64}
          label={formatMessage(runMessages.fileSpeed)}
        />
        <Hint>
          {formatMessage(runMessages.workDone, {
            done: formatNumber(done),
            total: formatNumber(telemetry.total),
          })}{' '}
          ·{' '}
          {formatMessage(runMessages.elapsed, {
            duration: formatDuration(telemetry.elapsedSeconds),
          })}
        </Hint>
      </Card>

      <Card>
        <CardTitle>{formatMessage(runMessages.dataSpeed)}</CardTitle>
        <Metric>
          {megabytesPerSecond === null ? '—' : megabytesPerSecond.toFixed(1)}
          <Unit>{formatMessage(runMessages.perSecond)}</Unit>
        </Metric>
        <EChart
          option={byteOption}
          height={64}
          label={formatMessage(runMessages.dataSpeed)}
        />
        <Hint>
          {formatMessage(runMessages.processed, {
            size: formatBytes(telemetry.processedBytes),
          })}
        </Hint>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{formatMessage(runMessages.sizeChange)}</CardTitle>
          <SegmentedControl
            label={formatMessage(runMessages.sizeChange)}
            value={sizeView}
            onChange={(value) => setSizeView(value as 'absolute' | 'percent')}
            disabled={sizeSummary.files === 0}
            options={[
              {
                value: 'absolute',
                label: formatMessage(runMessages.sizeAbsolute),
              },
              {
                value: 'percent',
                label: formatMessage(runMessages.sizePercent),
              },
            ]}
          />
        </CardHeader>
        {sizeSummary.points.length === 0 ? (
          <Hint>{formatMessage(runMessages.sizeNoData)}</Hint>
        ) : (
          <>
            <Metric>
              {formatSignedBytes(metricDelta)}
              <Unit>{metricPercent}</Unit>
            </Metric>
            {sizeView === 'absolute' ? (
              <SizeLegend>
                <LegendItem>
                  <Swatch $color={theme.textMuted} aria-hidden="true" />
                  {formatMessage(runMessages.sizeBefore)}
                </LegendItem>
                <LegendItem>
                  <Swatch $color={theme.accent} aria-hidden="true" />
                  {formatMessage(runMessages.sizeAfter)}
                </LegendItem>
                {sizeSummary.expectedFiles > 0 && (
                  <LegendItem>
                    <Swatch
                      $color={theme.accent}
                      style={{ opacity: 0.35 }}
                      aria-hidden="true"
                    />
                    {formatMessage(runMessages.sizeExpected)}
                  </LegendItem>
                )}
              </SizeLegend>
            ) : (
              sizeSummary.expectedFiles > 0 && (
                <SizeLegend>
                  <LegendItem>
                    <Swatch
                      $color={theme.textMuted}
                      style={{ opacity: 0.5 }}
                      aria-hidden="true"
                    />
                    {formatMessage(runMessages.sizeExpected)}
                  </LegendItem>
                </SizeLegend>
              )
            )}
            <EChart
              option={
                sizeView === 'absolute'
                  ? sizeAbsoluteOption
                  : sizePercentOption
              }
              height={96}
              label={formatMessage(runMessages.sizeChange)}
            />
            {hasActualSizes && <Hint>{sizeTotalsLabel}</Hint>}
            {sizeSummary.expectedFiles > 0 && (
              <Hint>{expectedTotalsLabel}</Hint>
            )}
            <Hint>
              {hasActualSizes &&
                formatMessage(runMessages.sizeAcrossFiles, {
                  count: formatNumber(sizeSummary.files),
                })}
              {hasActualSizes && sizeSummary.expectedFiles > 0 && ' · '}
              {sizeSummary.expectedFiles > 0 &&
                formatMessage(runMessages.sizeExpectedAcross, {
                  count: formatNumber(sizeSummary.expectedFiles),
                })}
              {sizeOmittedCount > 0 &&
                ` · ${formatMessage(runMessages.sizeOmitted, {
                  count: formatNumber(sizeOmittedCount),
                })}`}
            </Hint>
          </>
        )}
      </Card>

      <Card>
        <CardTitle>{formatMessage(runMessages.framesPerSecondLabel)}</CardTitle>
        <Metric>
          {telemetry.fps === null ? '—' : formatNumber(telemetry.fps, 1)}
          <Unit>{formatMessage(runMessages.framesPerSecond)}</Unit>
        </Metric>
        <EChart
          option={fpsOption}
          height={64}
          label={formatMessage(runMessages.framesPerSecondLabel)}
        />
        <Hint>
          {telemetry.fps === null
            ? formatMessage(runMessages.frameRateUnavailable)
            : formatMessage(runMessages.frameRateScope, {
                count: counts.running,
              })}
        </Hint>
      </Card>

      <Card>
        <CardTitle>{formatMessage(runMessages.timeRemaining)}</CardTitle>
        <Metric>{remainingValue}</Metric>
        <Hint>{remainingHint}</Hint>
        <Hint>
          {formatMessage(runMessages.workDone, {
            done: formatNumber(done),
            total: formatNumber(telemetry.total),
          })}
        </Hint>
      </Card>
    </Grid>
  );
};
