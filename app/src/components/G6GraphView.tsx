/**
 * G6GraphView — Medical Knowledge Graph · Type-Based Coloring · Dual-Theme · Cinema Grade
 *
 * Features:
 * - 13 medical entity type colors with distinct dark/light variants
 * - Edge relation type coloring + labels on active edges
 * - HTML tooltip overlay with rich entity preview
 * - Neighbor highlight on hover (degree-1 bidirectional)
 * - Minimap, zoom, drag behaviors
 * - Keyboard: F = fit view, Escape = deselect
 * - Robust abort-guard + theme-adaptive architecture
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { Graph } from "@antv/g6";

// ═══ Medical Entity Color Palette — High Brightness ═══
const NC: Record<string, { f: string; s: string; df: string; ds: string }> = {
  disease:    { f: "#FF5252", s: "#FF1744", df: "#FF8A80", ds: "#FF5252" },
  drug:       { f: "#448AFF", s: "#2979FF", df: "#82B1FF", ds: "#448AFF" },
  symptom:    { f: "#FF6E40", s: "#FF3D00", df: "#FF9E80", ds: "#FF6E40" },
  treatment:  { f: "#00E676", s: "#00C853", df: "#69F0AE", ds: "#00E676" },
  check:      { f: "#B388FF", s: "#7C4DFF", df: "#B388FF", ds: "#7C4DFF" },
  exam:       { f: "#B388FF", s: "#7C4DFF", df: "#B388FF", ds: "#7C4DFF" },
  clinical_indicator: { f: "#7C4DFF", s: "#651FFF", df: "#B388FF", ds: "#7C4DFF" },
  anatomy:    { f: "#00E5FF", s: "#00B8D4", df: "#18FFFF", ds: "#00E5FF" },
  procedure:  { f: "#FF4081", s: "#F50057", df: "#FF80AB", ds: "#FF4081" },
  gene:       { f: "#651FFF", s: "#651FFF", df: "#B388FF", ds: "#7C4DFF" },
  pathogen:   { f: "#FF1744", s: "#D50000", df: "#FF5252", ds: "#FF1744" },
  guideline:  { f: "#FFD740", s: "#FFC400", df: "#FFE57F", ds: "#FFD740" },
  metric:     { f: "#448AFF", s: "#2979FF", df: "#82B1FF", ds: "#448AFF" },
  other:      { f: "#90A4AE", s: "#78909C", df: "#B0BEC5", ds: "#90A4AE" },
};

// ═══ Edge Relation Color Palette — High Visibility ═══
const EC: Record<string, { l: string; d: string }> = {
  treats:          { l: "rgba(0,230,118,0.85)",   d: "rgba(105,240,174,0.90)" },
  causes:          { l: "rgba(255,23,68,0.80)",    d: "rgba(255,82,82,0.85)" },
  associated_with: { l: "rgba(68,138,255,0.75)",   d: "rgba(130,177,255,0.80)" },
  contraindicated: { l: "rgba(255,61,0,0.80)",     d: "rgba(255,110,64,0.85)" },
  diagnoses:       { l: "rgba(124,77,255,0.80)",   d: "rgba(179,136,255,0.85)" },
  prevents:        { l: "rgba(0,229,255,0.80)",    d: "rgba(24,255,255,0.85)" },
  symptom_of:      { l: "rgba(255,110,64,0.80)",   d: "rgba(255,158,128,0.85)" },
  interacts_with:  { l: "rgba(255,64,129,0.80)",   d: "rgba(255,128,171,0.85)" },
  related_to:      { l: "rgba(144,164,174,0.70)",  d: "rgba(176,190,197,0.75)" },
};
const EDGE_DEFAULT = { l: "rgba(144,164,174,0.65)", d: "rgba(176,190,197,0.70)" };

function nc(g: string) { return NC[g] || NC.other; }
function ec(r: string, dark: boolean) { const c = EC[r] || EDGE_DEFAULT; return dark ? c.d : c.l; }

interface GNode { id: number | string; label: string; group?: string; weight?: number; description?: string }
interface GEdge { id?: number; source: number | string; target: number | string; weight?: number; relationType?: string }

function isDark(): boolean {
  try {
    const a = document.documentElement.getAttribute("data-theme");
    return a === "dark" || (!a && window.matchMedia("(prefers-color-scheme:dark)").matches);
  } catch { return true; }
}

function buildData(nodes: GNode[], edges: GEdge[], dark: boolean) {
  const nodeMap = new Map(nodes.map(n => [String(n.id), n]));
  const maxW = Math.max(1, ...nodes.map(n => n.weight || 1));

  return {
    nodes: nodes.map(n => {
      const c = nc(n.group || "other");
      const w = n.weight || 1;
      // Size: 14–48px radius, proportional to sqrt(weight / maxWeight)
      const r = 14 + Math.sqrt(w / maxW) * 34;
      const lbl = (n.label || "").length > 22 ? (n.label || "").slice(0, 20) + "…" : (n.label || "");
      return {
        id: String(n.id),
        data: { label: n.label, group: n.group || "other", weight: w, description: n.description || "" },
        style: {
          size: r * 2,
          fill: dark ? c.df : c.f,
          stroke: dark ? c.ds : c.s,
          lineWidth: dark ? 3 : 3.5,
          labelText: lbl,
          labelFill: dark ? "#FFFFFF" : "#0B1628",
          labelFontSize: 11,
          labelFontWeight: 600,
          labelPlacement: "bottom",
          labelOffsetY: r / 2 + 6,
          cursor: "pointer",
          shadowColor: dark ? c.df : c.f,
          shadowBlur: 12,
          shadowOffsetX: 0,
          shadowOffsetY: 0,
        },
        states: ["active", "inactive", "selected"],
      };
    }),
    edges: edges.map((e, i) => ({
      id: String(e.id || `e-${i}`),
      source: String(e.source),
      target: String(e.target),
      data: { relationType: e.relationType || "related_to", weight: e.weight || 1 },
      style: {
        stroke: ec(e.relationType || "", dark),
        lineWidth: 1.2 + (e.weight || 1) * 0.2,
        endArrow: false,
      },
      states: ["active", "inactive"],
    })),
  };
}

function applyHL(g: Graph, search: string, filter: string) {
  try {
    const s = search.trim().toLowerCase(), f = filter;
    const nd = g.getNodeData();
    if (!s && !f) {
      // Reset all states — use [] not {} for G6 v5 compatibility
      const reset: Record<string, string[]> = {};
      nd.forEach(n => { reset[n.id] = []; });
      g.setElementState(reset);
      // Also reset edges
      const ereset: Record<string, string[]> = {};
      g.getEdgeData().forEach(e => { ereset[e.id!] = []; });
      g.setElementState(ereset);
      return;
    }
    // Batch node states
    const nstates: Record<string, string | string[]> = {};
    nd.forEach(n => {
      const l = ((n.data?.label as string) || "").toLowerCase();
      const gr = (n.data?.group as string) || "";
      nstates[n.id] = (!s || l.includes(s)) && (!f || gr === f) ? "active" : "inactive";
    });
    g.setElementState(nstates);
    // Batch edge states based on connected node states
    const estates: Record<string, string | string[]> = {};
    g.getEdgeData().forEach(e => {
      const sa = g.getElementState(String(e.source));
      const ta = g.getElementState(String(e.target));
      const bothActive = !sa?.includes("inactive") && !ta?.includes("inactive");
      estates[e.id!] = bothActive ? "active" : "inactive";
    });
    g.setElementState(estates);
  } catch (err) { console.error("applyHL error:", err); }
}

export default function G6GraphView({ nodes, edges, search, filter, onNodeClick, onReady }: {
  nodes: GNode[]; edges: GEdge[]; search: string; filter: string;
  onNodeClick?: (n: GNode) => void; onReady?: (g: Graph) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [theme, setTheme] = useState(isDark() ? "dark" : "light");

  // ── Theme observer ──
  useEffect(() => {
    const check = () => setTheme(isDark() ? "dark" : "light");
    const obs = new MutationObserver(check);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    window.matchMedia("(prefers-color-scheme:dark)").addEventListener("change", check);
    return () => {
      obs.disconnect();
      window.matchMedia("(prefers-color-scheme:dark)").removeEventListener("change", check);
    };
  }, []);

  // ── Tooltip manager ──
  const showTooltip = useCallback((clientX: number, clientY: number, nodeData: any) => {
    const el = tooltipRef.current;
    if (!el) return;
    const grp = nodeData.group || "other";
    const c = nc(grp);
    const ntLabels: Record<string, string> = {
      disease: "疾病", drug: "药物", symptom: "症状", treatment: "治疗",
      check: "检查", exam: "检查", clinical_indicator: "指标", anatomy: "解剖",
      procedure: "手术", gene: "基因", pathogen: "病原体", guideline: "指南",
      metric: "指标", other: "其他",
    };
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
        <div style="width:10px;height:10px;border-radius:50%;background:${c.f};flex-shrink:0;"></div>
        <span style="font-size:9px;padding:1px 6px;border-radius:4px;background:var(--bg-hover);color:var(--tx-300);">${ntLabels[grp] || grp}</span>
        ${nodeData.weight > 0 ? `<span style="font-size:9px;color:var(--tx-200);">权重${nodeData.weight}</span>` : ""}
      </div>
      <div style="font-weight:700;font-size:13px;color:var(--tx-900);margin-bottom:2px;">${nodeData.label || "?"}</div>
      ${nodeData.description ? `<div style="font-size:10px;color:var(--tx-500);line-height:1.5;max-width:200px;">${nodeData.description.slice(0, 120)}${nodeData.description.length > 120 ? "…" : ""}</div>` : ""}
    `;
    const rect = el.getBoundingClientRect();
    const cx = clientX + 16, cy = clientY - rect.height / 2;
    el.style.left = `${Math.min(cx, window.innerWidth - rect.width - 10)}px`;
    el.style.top = `${Math.min(Math.max(cy, 10), window.innerHeight - rect.height - 10)}px`;
    el.style.display = "block";
  }, []);

  const hideTooltip = useCallback(() => {
    const el = tooltipRef.current;
    if (el) el.style.display = "none";
  }, []);

  // ── Main graph effect ──
  useEffect(() => {
    const c = containerRef.current;
    if (!c || !nodes.length) return;
    const dark = theme === "dark", W = c.clientWidth || 800, H = c.clientHeight || 500;
    let aborted = false;

    // Destroy previous graph
    if (graphRef.current) { try { graphRef.current.destroy(); } catch { /* ok */ } graphRef.current = null; }
    while (c.firstChild) c.removeChild(c.firstChild);

    // Recreate tooltip element
    const tip = document.createElement("div");
    tip.style.cssText = "display:none;position:fixed;z-index:9999;pointer-events:none;padding:8px 10px;border-radius:var(--r-sm,8px);background:var(--bg-surface,#fff);border:1px solid var(--bd-100,#e2e8f0);box-shadow:var(--sh-lg,0 8px 30px rgba(15,43,91,0.08));font-size:11px;max-width:240px;";
    c.appendChild(tip);
    tooltipRef.current = tip;

    try {
      const g = new Graph({
        container: c,
        width: W,
        height: H,
        autoFit: "view",
        padding: [80, 80, 80, 80],
        animation: false,
        background: "transparent",
        data: buildData(nodes, edges, dark),
        layout: {
          type: "d3-force",
          preventOverlap: true,
          nodeSize: 48,
          linkDistance: 140,
          animate: true,
          alphaDecay: 0.012,
          alphaMin: 0.001,
          collideStrength: 1.5,
          forceSimulationIterations: 200,
        },
        behaviors: [
          "drag-canvas",
          "zoom-canvas",
          { type: "drag-element", enableTransient: true },
          { type: "hover-activate", degree: 1, direction: "both" },
        ],
        plugins: [{
          type: "minimap",
          size: [150, 110],
          position: "right-bottom",
          style: {
            background: dark ? "#1e293b" : "#f8fafc",
            border: `1px solid ${dark ? "#334155" : "#e2e8f0"}`,
            borderRadius: 6,
          },
        }],
        node: {
          type: "circle",
          state: {
            active: {
              stroke: "#FFD700",
              lineWidth: 5,
              labelFontSize: 13,
              labelFontWeight: 700,
              shadowColor: "rgba(255,215,0,0.8)",
              shadowBlur: 20,
            },
            inactive: { opacity: dark ? 0.15 : 0.12 },
            selected: {
              stroke: "#FFD700",
              lineWidth: 6,
              labelFontSize: 14,
              labelFontWeight: 700,
              labelFill: "#FFD700",
              shadowColor: "rgba(255,215,0,0.9)",
              shadowBlur: 28,
            },
          },
        },
        edge: {
          type: "line",
          state: {
            active: { stroke: "#FFD700", lineWidth: 4, shadowColor: "rgba(255,215,0,0.6)", shadowBlur: 10 },
            inactive: { opacity: dark ? 0.10 : 0.08 },
          },
        },
      });

      g.render().then(() => {
        if (aborted) { try { g.destroy(); } catch { /* ok */ } return; }
        graphRef.current = g;
        if (onReady) onReady(g);
        applyHL(g, search, filter);
      });

      // ── Node click → select + callback ──
      g.on("node:click", (evt: any) => {
        const nid = evt?.target?.id;
        if (!nid || !onNodeClick) return;
        const found = nodes.find(n => String(n.id) === nid);
        if (!found) return;
        // Deselect all others, select this one
        const nstates: Record<string, string[]> = {};
        g.getNodeData().forEach(nd => { nstates[nd.id] = nd.id === nid ? ["selected"] : []; });
        g.setElementState(nstates);
        onNodeClick(found);
      });

      // ── Canvas click → deselect ──
      g.on("canvas:click", () => {
        const reset: Record<string, string[]> = {};
        g.getNodeData().forEach(nd => { reset[nd.id] = []; });
        g.setElementState(reset);
      });

      // ── Node hover → tooltip ──
      g.on("node:pointerenter", (evt: any) => {
        const nd = evt?.target?.id ? g.getNodeData().find((n: any) => n.id === evt.target.id) : null;
        if (nd?.data && evt.clientX) {
          showTooltip(evt.clientX, evt.clientY, nd.data);
        }
      });
      g.on("node:pointermove", (evt: any) => {
        if (tooltipRef.current?.style.display === "block" && evt.clientX) {
          tooltipRef.current.style.left = `${Math.min(evt.clientX + 16, window.innerWidth - 250)}px`;
          tooltipRef.current.style.top = `${Math.min(Math.max(evt.clientY - 30, 10), window.innerHeight - 100)}px`;
        }
      });
      g.on("node:pointerleave", () => hideTooltip());

      // ── Keyboard shortcuts ──
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "f" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); try { g.fitView({ padding: 80 }); } catch { /* ok */ } }
        if (e.key === "Escape") { g.getNodeData().forEach(nd => g.setElementState({ [nd.id]: {} })); }
      };
      window.addEventListener("keydown", onKey);

      return () => {
        aborted = true;
        window.removeEventListener("keydown", onKey);
        try { g.destroy(); } catch { /* ok */ }
        graphRef.current = null;
        tooltipRef.current = null;
      };
    } catch (e) { console.error("G6:", e); }
  }, [nodes.length, edges.length, theme]);

  // ── Search/filter reapply ──
  useEffect(() => {
    const g = graphRef.current;
    if (g) applyHL(g, search, filter);
  }, [search, filter]);

  // ── Resize handler ──
  useEffect(() => {
    const r = () => {
      const g = graphRef.current, c = containerRef.current;
      if (g && c) g.setSize(c.clientWidth, c.clientHeight);
    };
    window.addEventListener("resize", r);
    return () => window.removeEventListener("resize", r);
  }, []);

  return <div ref={containerRef} style={{ width: "100%", height: "100%", minHeight: 500 }} />;
}
