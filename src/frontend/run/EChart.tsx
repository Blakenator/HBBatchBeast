import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import {
  AriaComponent,
  GridComponent,
  MarkLineComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';

echarts.use([
  PieChart,
  BarChart,
  LineChart,
  GridComponent,
  TitleComponent,
  TooltipComponent,
  MarkLineComponent,
  AriaComponent,
  SVGRenderer,
]);

interface EChartProps {
  option: EChartsCoreOption;
  height: number;
  label: string;
}

/**
 * Thin ECharts host: ECharts owns its canvas and needs an explicit resize
 * signal, so a ResizeObserver bridges the responsive card layout to it.
 */
export const EChart: React.FC<EChartProps> = ({ option, height, label }) => {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const instance = echarts.init(element, undefined, { renderer: 'svg' });
    chart.current = instance;
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => instance.resize());
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  // Progress can tick many times per second; coalesce bursts into one draw.
  useEffect(() => {
    const instance = chart.current;
    if (!instance) return;
    const timer = setTimeout(
      () => instance.setOption(option, { notMerge: true }),
      120,
    );
    return () => clearTimeout(timer);
  }, [option]);

  return (
    <div
      ref={host}
      role="img"
      aria-label={label}
      style={{ width: '100%', height }}
    />
  );
};
