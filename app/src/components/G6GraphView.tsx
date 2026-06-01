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

// ═══ Medical Entity Color Palette — Extreme Fluorescent Brightness ═══
// Dark fills (df): near-neon against #080E1A background
// Light fills (f): saturated against #F0F4F8 background
// All strokes: white for maximum visibility
const NC: Record<string, { f: string; s: string; df: string; ds: string }> = {
  disease:    { f: "#FF2222", s: "#FFFFFF", df: "#FF4444", ds: "#FFFFFF" },
  drug:       { f: "#2277FF", s: "#FFFFFF", df: "#4499FF", ds: "#FFFFFF" },
  symptom:    { f: "#FF5500", s: "#FFFFFF", df: "#FF7722", ds: "#FFFFFF" },
  treatment:  { f: "#00DD44", s: "#FFFFFF", df: "#22FF66", ds: "#FFFFFF" },
  check:      { f: "#9944FF", s: "#FFFFFF", df: "#BB66FF", ds: "#FFFFFF" },
  exam:       { f: "#9944FF", s: "#FFFFFF", df: "#BB66FF", ds: "#FFFFFF" },
  clinical_indicator: { f: "#8833FF", s: "#FFFFFF", df: "#AA55FF", ds: "#FFFFFF" },
  anatomy:    { f: "#00CCDD", s: "#FFFFFF", df: "#22EEFF", ds: "#FFFFFF" },
  procedure:  { f: "#FF2288", s: "#FFFFFF", df: "#FF44AA", ds: "#FFFFFF" },
  gene:       { f: "#7722FF", s: "#FFFFFF", df: "#9944FF", ds: "#FFFFFF" },
  pathogen:   { f: "#FF0000", s: "#FFFFFF", df: "#FF2222", ds: "#FFFFFF" },
  guideline:  { f: "#FFCC00", s: "#FFFFFF", df: "#FFEE33", ds: "#FFFFFF" },
  metric:     { f: "#2277FF", s: "#FFFFFF", df: "#4499FF", ds: "#FFFFFF" },
  other:      { f: "#8899AA", s: "#FFFFFF", df: "#AABBCC", ds: "#FFFFFF" },
};

// ═══ Edge Colors — Fully Opaque, Maximum Brightness ═══
const EC: Record<string, { l: string; d: string }> = {
  treats:          { l: "#00CC44", d: "#44FF88" },
  causes:          { l: "#FF2222", d: "#FF5555" },
  associated_with: { l: "#3388FF", d: "#66AAFF" },
  contraindicated: { l: "#FF4400", d: "#FF7733" },
  diagnoses:       { l: "#8833FF", d: "#AA66FF" },
  prevents:        { l: "#00CCDD", d: "#44EEFF" },
  symptom_of:      { l: "#FF6622", d: "#FF8855" },
  interacts_with:  { l: "#FF1177", d: "#FF4499" },
  related_to:      { l: "#8899AA", d: "#AABBCC" },
};
const EDGE_DEFAULT = { l: "#8899AA", d: "#AABBCC" };

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
      const r = 16 + Math.sqrt(w / maxW) * 36;
      const lbl = (n.label || "").length > 22 ? (n.label || "").slice(0, 20) + "…" : (n.label || "");
      return {
        id: String(n.id),
        data: { label: n.label, group: n.group || "other", weight: w, description: n.description || "" },
        style: {
          size: r * 2,
          fill: dark ? c.df : c.f,
          stroke: dark ? "#FFFFFF" : c.s,
          lineWidth: dark ? 3.5 : 4,
          labelText: lbl,
          labelFill: dark ? "#FFFFFF" : "#000000",
          labelFontSize: 12,
          labelFontWeight: 700,
          labelPlacement: "bottom",
          labelOffsetY: r / 2 + 6,
          cursor: "pointer",
          shadowColor: dark ? c.df : c.f,
          shadowBlur: dark ? 25 : 18,
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
        lineWidth: 2.5 + (e.weight || 1) * 0.4,
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
          linkDistance: 160,
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
            border: `2px solid ${dark ? "#8899AA" : "#c5d2de"}`,
            borderRadius: 6,
          },
        }],
        node: {
          type: "circle",
          state: {
            active: {
              stroke: "#FFFFFF",
              lineWidth: 6,
              labelFontSize: 14,
              labelFontWeight: 700,
              labelFill: "#FFFFFF",
              shadowColor: "rgba(255,255,255,0.9)",
              shadowBlur: 35,
            },
            inactive: { opacity: dark ? 0.22 : 0.18 },
            selected: {
              stroke: "#FFFFFF",
              lineWidth: 8,
              labelFontSize: 16,
              labelFontWeight: 700,
              labelFill: "#FFD700",
              shadowColor: "rgba(255,215,0,0.95)",
              shadowBlur: 45,
            },
          },
        },
        edge: {
          type: "line",
          state: {
            active: { stroke: "#FFFFFF", lineWidth: 5, shadowColor: "rgba(255,255,255,0.7)", shadowBlur: 15 },
            inactive: { opacity: dark ? 0.15 : 0.12 },
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
