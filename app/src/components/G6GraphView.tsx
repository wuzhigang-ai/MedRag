/**
 * G6GraphView — AntV G6 v5 powered knowledge graph.
 * Replaces Canvas 2D rendering with professional graph visualization.
 * Zero backend impact: consumes the same /api/graph JSON format.
 */
import { useEffect, useRef, useCallback } from "react";
import { Graph } from "@antv/g6";

interface GNode { id:number|string; label:string; group?:string; weight?:number; x?:number;y?:number; }
interface GEdge { id?:number; source:number|string; target:number|string; weight?:number; relationType?:string; }

const GROUP_COLORS: Record<string,string> = {
  disease:"#E84D4D", drug:"#3B82F6", symptom:"#F07850", treatment:"#10B981",
  check:"#8B5CF6", clinical_indicator:"#8B5CF6", exam:"#8B5CF6",
  anatomy:"#06B6D4", procedure:"#EC4899", guideline:"#D4A853",
  metric:"#3B82F6", gene:"#7C3AED", pathogen:"#DC2626", other:"#64748B",
};
const DEFAULT_COLOR = "#64748B";

function nodeColor(g: string) { return GROUP_COLORS[g] || DEFAULT_COLOR; }

function buildGraphData(nodes: GNode[], edges: GEdge[], isDark: boolean) {
  return {
    nodes: nodes.map(n => ({
      id: String(n.id),
      data: {
        label: n.label || String(n.id),
        group: n.group || "other",
        weight: n.weight || 1,
        nodeType: n.group || "other",
      },
      style: {
        fill: nodeColor(n.group || "other"),
        size: Math.min(36, 8 + (n.weight || 1) * 3),
        labelText: n.label?.length > 18 ? n.label.slice(0,16)+"…" : (n.label || ""),
        labelFill: isDark ? "#c8d5e8" : "#374151",
        labelFontSize: 11,
        labelPlacement: "bottom",
        labelOffsetY: 6,
        opacity: 0.88,
      },
    })),
    edges: edges.map((e, i) => ({
      id: String(e.id || `e${i}`),
      source: String(e.source),
      target: String(e.target),
      style: {
        stroke: isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)",
        lineWidth: 0.8 + (e.weight || 1) * 0.2,
        endArrow: false,
        opacity: 0.6,
      },
    })),
  };
}

export default function G6GraphView({ nodes, edges, search, filter, onNodeClick, onReady }: {
  nodes: GNode[]; edges: GEdge[];
  search: string; filter: string;
  onNodeClick?: (n: GNode) => void;
  onReady?: (g: Graph) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);

  const isDark = useCallback(() => {
    try {
      const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg-base").trim();
      return !bg || parseInt(bg.replace("#",""),16) < 0x888888;
    } catch { return true; }
  }, []);

  // Initialize G6 graph + render data — single effect to avoid race
  useEffect(() => {
    if (!containerRef.current) return;
    if (!nodes.length) return;
    const dark = isDark();
    const W = containerRef.current.clientWidth || 800;
    const H = containerRef.current.clientHeight || 500;

    // Destroy previous instance if exists
    if (graphRef.current) {
      try { graphRef.current.destroy(); } catch {}
      graphRef.current = null;
    }

    const data = buildGraphData(nodes, edges, dark);

    try {
      const g = new Graph({
        container: containerRef.current,
        width: W, height: H,
        autoFit: "view",
        padding: [60, 60, 60, 60],
        background: "transparent",
        animation: true,
        data,
        layout: {
          type: "d3-force",
          preventOverlap: true,
          nodeSize: 40,
          linkDistance: 100,
          animate: true,
          alphaDecay: 0.02,
          alphaMin: 0.001,
          collideStrength: 1,
          forceSimulationIterations: 120,
        },
        behaviors: [
          "drag-canvas",
          "zoom-canvas",
          { type: "drag-element", enableTransient: true },
          "hover-activate",
        ],
        node: {
          type: "circle",
          style: { size: 24, cursor: "pointer" },
          state: {
            active: { opacity: 0.9, lineWidth: 3, stroke: "#FFD700", shadowBlur: 12, shadowColor: "#FFD700" },
            inactive: { opacity: 0.15 },
            selected: { stroke: "#FFD700", lineWidth: 3, shadowBlur: 15, shadowColor: "#FFD700" },
          },
        },
        edge: {
          type: "line",
          style: { endArrow: false },
          state: {
            active: { stroke: "#FFD700", opacity: 0.8, lineWidth: 1.5 },
            inactive: { opacity: 0.05 },
          },
        },
      });

      g.render().then(() => {
        graphRef.current = g;
        if (onReady) onReady(g);
        applySearchFilter(g, search, filter);
      });
    } catch (e) {
      console.error("G6 init failed:", e);
    }

    return () => {
      if (graphRef.current) {
        try { graphRef.current.destroy(); } catch {}
        graphRef.current = null;
      }
    };
  }, [nodes.length, edges.length]);

  // Update search/filter highlights when they change
  useEffect(() => {
    const g = graphRef.current;
    if (!g) return;
    applySearchFilter(g, search, filter);
  }, [search, filter]);

  // Apply search + filter highlight
  useEffect(() => {
    const g = graphRef.current;
    if (!g) return;
    applySearchFilter(g, search, filter);
  }, [search, filter]);

  // Handle node click
  useEffect(() => {
    const g = graphRef.current;
    if (!g) return;
    const handler = (evt: any) => {
      const nodeId = evt?.target?.id;
      if (nodeId && onNodeClick) {
        const found = nodes.find(n => String(n.id) === nodeId);
        if (found) onNodeClick(found);
      }
    };
    g.on("node:click", handler);
    return () => { g.off("node:click", handler); };
  }, [nodes, onNodeClick]);

  // Resize on window change
  useEffect(() => {
    const onResize = () => {
      const g = graphRef.current;
      const c = containerRef.current;
      if (g && c) { g.setSize(c.clientWidth, c.clientHeight); }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%", minHeight: 500 }} />
  );
}

function applySearchFilter(g: Graph, search: string, filter: string) {
  try {
    const s = search.trim().toLowerCase();
    const f = filter;
    const nodeData = g.getNodeData();

    if (!s && !f) {
      // Reset all to normal
      nodeData.forEach(nd => {
        g.setElementState({ [nd.id]: {} });
      });
    } else {
      nodeData.forEach(nd => {
        const label = (nd.data?.label as string || "").toLowerCase();
        const group = nd.data?.group as string || "";
        const matchSearch = !s || label.includes(s);
        const matchFilter = !f || group === f;
        const match = matchSearch && matchFilter;
        g.setElementState({ [nd.id]: match ? "active" : "inactive" });
      });
    }

    // Also dim edges connected to inactive nodes
    if (s || f) {
      const edgeData = g.getEdgeData();
      edgeData.forEach(ed => {
        const srcId = String(ed.source);
        const tgtId = String(ed.target);
        const srcNode = g.getElementState(srcId);
        const tgtNode = g.getElementState(tgtId);
        const srcIsActive = !srcNode || !srcNode.inactive;
        const tgtIsActive = !tgtNode || !tgtNode.inactive;
        g.setElementState({ [ed.id!]: (srcIsActive && tgtIsActive) ? "active" : "inactive" });
      });
    }
  } catch { /* graph not ready yet */ }
}
