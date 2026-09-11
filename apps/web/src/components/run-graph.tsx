"use client";
import {
  ReactFlow,
  Background,
  Controls,
  Position,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Run } from "../lib/types";
const stages = [
  ["detect", "发现缺口"],
  ["investigate", "证据调查"],
  ["plan", "行动规划"],
  ["approve", "人工审批"],
  ["execute", "执行与回读"],
  ["observe", "后续观察"],
];
export default function RunGraph({
  run,
  selected,
  onSelect,
}: {
  run: Run;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const nodes = stages.map(([id, label], i) => {
    const event = run.events
      .slice()
      .reverse()
      .find((e) => e.node === id);
    const current =
      event?.status === "waiting_approval" ||
      event?.status === "waiting_observation";
    return {
      id,
      position: { x: (i % 3) * 240 + 20, y: Math.floor(i / 3) * 170 + 20 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        label: (
          <div className="graph-node">
            <span
              className={`node-dot ${event ? "done" : ""} ${current ? "waiting" : ""}`}
            >
              {event ? (current ? "◷" : "✓") : i + 1}
            </span>
            <div>
              <strong>{label}</strong>
              <small>
                {current
                  ? event?.status === "waiting_observation"
                    ? "等待新数据"
                    : "等待人工审批"
                  : event
                    ? "已完成"
                    : "尚未开始"}
              </small>
            </div>
          </div>
        ),
      },
      style: {
        width: 205,
        borderRadius: 12,
        padding: 16,
        border: `${selected === id ? 2 : 1}px solid ${selected === id ? "#2563eb" : current ? "#f1c67a" : "#dde5ef"}`,
        background: current ? "#fffcf5" : "#fff",
        boxShadow: "0 3px 8px #15234805",
      },
    };
  });
  const edges = stages
    .slice(1)
    .map(([id], i) => ({
      id: `edge-${id}`,
      source: stages[i][0],
      target: id,
      type: "smoothstep",
      style: {
        stroke: run.events.some((e) => e.node === id) ? "#80aaf1" : "#cbd5e1",
        strokeWidth: 1.5,
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: "#a1b7d7" },
    }));
  return (
    <div className="run-graph">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodeClick={(_, node) => onSelect(node.id)}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={true}
        minZoom={0.45}
        maxZoom={1.6}
      >
        <Background color="#d9e1ee" gap={18} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
