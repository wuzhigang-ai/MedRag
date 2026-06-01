/**
 * G6GraphView — AntV G6 v5 电影级知识图谱渲染引擎
 * 深色主题 · 辉光节点 · 贝塞尔曲线 · 最小地图 · 悬停提示 · 键盘快捷键
 */
import { useEffect, useRef, useCallback } from "react";
import { Graph } from "@antv/g6";

// ── 节点类型 · 电影级配色 ──
const GROUP_COLORS: Record<string, [string,string]> = {
  disease:    ["#E84D4D","#FF6B6B"], drug:       ["#3B82F6","#60A5FA"],
  symptom:    ["#F07850","#FF9A76"], treatment:   ["#10B981","#34D399"],
  check:      ["#8B5CF6","#A78BFA"], exam:        ["#8B5CF6","#A78BFA"],
  clinical_indicator:["#8B5CF6","#A78BFA"],
  anatomy:    ["#06B6D4","#22D3EE"], procedure:   ["#EC4899","#F472B6"],
  gene:       ["#7C3AED","#9B6BFF"], pathogen:    ["#DC2626","#FF4040"],
  guideline:  ["#D4A853","#F0D080"], metric:      ["#3B82F6","#60A5FA"],
  other:      ["#64748B","#94A3B8"],
};
function nodeColors(g: string): [string,string] { return GROUP_COLORS[g] || GROUP_COLORS.other; }

interface GNode { id:number|string; label:string; group?:string; weight?:number; description?:string; }
interface GEdge { id?:number; source:number|string; target:number|string; weight?:number; relationType?:string; }

function buildGraphData(nodes: GNode[], edges: GEdge[], dark: boolean) {
  return {
    nodes: nodes.map(n => {
      const [fill, glow] = nodeColors(n.group || "other");
      const r = Math.min(32, 10 + (n.weight || 1) * 2.2);
      const lbl = (n.label || "").length > 20 ? (n.label||"").slice(0,18)+"…" : (n.label||"");
      return {
        id: String(n.id),
        data: { label: n.label, group: n.group||"other", weight: n.weight||1, description: n.description||"", _color: fill, _glow: glow },
        style: {
          size: r * 2,
          fill, stroke: dark ? glow+"88" : fill+"44",
          lineWidth: 1.5,
          labelText: lbl,
          labelFill: dark ? "#e2e8f0" : "#374151",
          labelFontSize: 10,
          labelPlacement: "bottom",
          labelOffsetY: r / 2 + 6,
          shadowBlur: 6, shadowColor: glow+"44",
          cursor: "pointer",
        },
        states: ["active","inactive","selected"],
      };
    }),
    edges: edges.map((e, i) => ({
      id: String(e.id || `e${i}`),
      source: String(e.source), target: String(e.target),
      style: {
        stroke: dark ? "rgba(148,163,184,0.20)" : "rgba(100,116,139,0.25)",
        lineWidth: 0.6 + (e.weight||1) * 0.15,
        endArrow: false,
      },
      states: ["active","inactive"],
    })),
  };
}

// ── 搜索/筛选高亮 ──
function applyHighlight(g: Graph, search: string, filter: string) {
  try {
    const s = search.trim().toLowerCase(); const f = filter;
    const nd = g.getNodeData();
    if (!s && !f) { nd.forEach(n => g.setElementState({ [n.id]: {} })); return; }
    nd.forEach(n => {
      const lbl = ((n.data?.label as string)||"").toLowerCase();
      const grp = (n.data?.group as string)||"";
      g.setElementState({ [n.id]: (!s||lbl.includes(s)) && (!f||grp===f) ? "active" : "inactive" });
    });
    const ed = g.getEdgeData();
    ed.forEach(e => {
      const sa = g.getElementState(String(e.source)); const ta = g.getElementState(String(e.target));
      g.setElementState({ [e.id!]: (!sa?.inactive&&!ta?.inactive) ? {} : "inactive" });
    });
  } catch {}
}

export default function G6GraphView({ nodes, edges, search, filter, onNodeClick, onReady }: {
  nodes: GNode[]; edges: GEdge[]; search: string; filter: string;
  onNodeClick?: (n: GNode) => void; onReady?: (g: Graph) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);
  const readyRef = useRef(false);

  const isDark = useCallback(() => {
    try { const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg-base").trim(); return !bg || parseInt(bg.replace("#",""),16) < 0x888888; } catch { return true; }
  }, []);

  // ── Init + render ──
  useEffect(() => {
    const c = containerRef.current; if (!c || !nodes.length) return;
    const dark = isDark();
    const W = c.clientWidth || 800; const H = c.clientHeight || 500;

    if (graphRef.current) { try { graphRef.current.destroy(); } catch {} }

    const data = buildGraphData(nodes, edges, dark);
    try {
      const g = new Graph({
        container: c, width: W, height: H,
        autoFit: "view", padding: [80,80,80,80],
        animation: true, background: "transparent",
        data,
        layout: {
          type: "d3-force", preventOverlap: true, nodeSize: 48,
          linkDistance: 120, animate: true, alphaDecay: 0.015,
          alphaMin: 0.001, collideStrength: 1.2, forceSimulationIterations: 150,
        },
        behaviors: [
          "drag-canvas", "zoom-canvas",
          { type: "drag-element", enableTransient: true },
          { type: "hover-activate", degree: 1, direction: "both" },
        ],
        plugins: [
          { type: "minimap", size: [160,120], position: "right-bottom",
            style: { background: dark?"#1e293b":"#f8fafc", border:"1px solid "+ (dark?"#334155":"#e2e8f0"), borderRadius:6 } },
        ],
        node: {
          type: "circle",
          state: {
            active: { opacity: 1, stroke: "#FFD700", lineWidth: 3, shadowBlur: 20, shadowColor: "#FFD700", labelFontSize: 12 },
            inactive: { opacity: 0.12, shadowBlur: 0 },
            selected: { stroke: "#FFD700", lineWidth: 4, shadowBlur: 24, shadowColor: "#FFD700", labelFontSize: 14, labelFill: "#FFD700" },
          },
        },
        edge: {
          type: "cubic-horizontal",
          style: { endArrow: false, curveOffset: 20 },
          state: {
            active: { stroke: "#FFD700", opacity: 0.5, lineWidth: 1.8 },
            inactive: { opacity: 0.03 },
          },
        },
      });

      g.render().then(() => {
        graphRef.current = g; readyRef.current = true;
        if (onReady) onReady(g);
        applyHighlight(g, search, filter);
      });

      // Node click
      g.on("node:click", (evt: any) => {
        const nid = evt?.target?.id;
        if (nid && onNodeClick) {
          const found = nodes.find(n => String(n.id) === nid);
          if (found) {
            // Set selected state
            g.getNodeData().forEach(nd => g.setElementState({ [nd.id]: nd.id === nid ? "selected" : {} }));
            onNodeClick(found);
          }
        }
      });
      // Canvas click deselects
      g.on("canvas:click", () => {
        g.getNodeData().forEach(nd => g.setElementState({ [nd.id]: {} }));
      });

      // Keyboard shortcuts
      const onKey = (e: KeyboardEvent) => {
        if (!readyRef.current) return;
        try {
          if (e.key === "f" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); g.fitView({ padding: 80 }); }
          if (e.key === "0" && e.ctrlKey) { e.preventDefault(); g.fitView({ padding: 80 }); }
        } catch {}
      };
      window.addEventListener("keydown", onKey);

      return () => {
        window.removeEventListener("keydown", onKey);
        try { g.destroy(); } catch {}
        graphRef.current = null; readyRef.current = false;
      };
    } catch (e) { console.error("G6:", e); }
  }, [nodes.length, edges.length]);

  // ── Search/filter highlight ──
  useEffect(() => {
    const g = graphRef.current; if (!g) return;
    applyHighlight(g, search, filter);
  }, [search, filter]);

  // ── Resize ──
  useEffect(() => {
    const r = () => { const g = graphRef.current, c = containerRef.current; if (g&&c) g.setSize(c.clientWidth, c.clientHeight); };
    window.addEventListener("resize", r); return () => window.removeEventListener("resize", r);
  }, []);

  return <div ref={containerRef} style={{ width:"100%", height:"100%", minHeight:500 }} />;
}
