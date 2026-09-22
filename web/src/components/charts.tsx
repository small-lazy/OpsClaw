"use client";
import { useEffect, useRef } from "react";
import * as echarts from "echarts";
export default function TrendChart({
  rows,
}: {
  rows: { date: string; detected: number; covered: number }[];
}) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current) return;
    const chart = echarts.init(el.current);
    chart.setOption({
      animationDuration: 450,
      textStyle: { fontFamily: "Segoe UI, Microsoft YaHei, sans-serif" },
      tooltip: {
        trigger: "axis",
        backgroundColor: "#fff",
        borderColor: "#e2e8f0",
        textStyle: { color: "#334155", fontSize: 13 },
      },
      grid: { top: 25, left: 36, right: 16, bottom: 28 },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: rows.map((r) => r.date),
        axisLine: { lineStyle: { color: "#e2e8f0" } },
        axisTick: { show: false },
        axisLabel: { color: "#8895a7", fontSize: 12, margin: 13 },
      },
      yAxis: {
        type: "value",
        min: 0,
        splitNumber: 3,
        axisLabel: { color: "#8895a7", fontSize: 12 },
        splitLine: { lineStyle: { color: "#edf1f5", type: "dashed" } },
      },
      series: [
        {
          name: "新发现缺口",
          type: "line",
          smooth: 0.28,
          data: rows.map((r) => r.detected),
          symbolSize: 6,
          lineStyle: { width: 2.5, color: "#3974ed" },
          itemStyle: { color: "#3974ed", borderColor: "#fff", borderWidth: 2 },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "rgba(59,130,246,.14)" },
              { offset: 1, color: "rgba(59,130,246,0)" },
            ]),
          },
        },
        {
          name: "已覆盖缺口",
          type: "line",
          smooth: 0.28,
          data: rows.map((r) => r.covered),
          symbolSize: 5,
          lineStyle: { width: 2, color: "#229d80" },
          itemStyle: { color: "#229d80", borderColor: "#fff", borderWidth: 1 },
        },
      ],
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(el.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [rows]);
  return (
    <div
      className="trend-chart"
      ref={el}
      role="img"
      aria-label={rows
        .map((r) => `${r.date}：新发现 ${r.detected}，已覆盖 ${r.covered}`)
        .join("；")}
    />
  );
}
