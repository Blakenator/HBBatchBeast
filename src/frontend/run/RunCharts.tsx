import React, { useMemo } from 'react';
import styled from 'styled-components';
import { useIntl } from 'react-intl';
import type { EChartsCoreOption } from 'echarts/core';
import { RunItemState, RunStatePayload } from './types';
import { RunTelemetry } from './useRunTelemetry';
import { runMessages } from './messages';
import { EChart } from './EChart';
import { useThemeMode } from '../ui/useThemeMode';
import { tokens } from '../ui/theme';
import {
  formatBytes,
  formatClock,
  formatDuration,
  formatNumber,
  formatPercent,
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
  const done = counts.success + counts.error + counts.cancelled + counts.skipped;

  const statusSegments = useMemo<Segment[]>(
    () =>
      (['running', 'pending', 'success', 'error', 'cancelled', 'skipped'] as const).map(
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
        value: counts.cancelled + counts.skipped,
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
