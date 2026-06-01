/**
 * G6GraphView — Medical Knowledge Graph · 3D Sphere Nodes · Floating Animation · Extreme Contrast
 *
 * - 3D node illusion via gradient-like dual-layer shadow + offset
 * - Subtle random floating animation (breathing effect) on all nodes
 * - Extreme contrast dual-theme: dark saturated fills (light bg) / bright neon fills (dark bg)
 * - White strokes on dark, black strokes on light — maximum visibility
 * - Golden-white glow on hover/select
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { Graph } from "@antv/g6";

// ═══ Extreme Contrast Color Palette ═══
// Light theme (f/s): very dark saturated fills on white bg → maximum visibility
// Dark theme (df/ds): bright neon fills + white stroke on near-black bg → maximum pop
const NC: Record<string, { f: string; s: string; df: string; ds: string }> = {
  disease:    { f: "#CC0000", s: "#660000", df: "#FF5555", ds: "#FFFFFF" },
  drug:       { f: "#0055CC", s: "#002266", df: "#5599FF", ds: "#FFFFFF" },
  symptom:    { f: "#CC4400", s: "#662200", df: "#FF7733", ds: "#FFFFFF" },
  treatment:  { f: "#008833", s: "#004411", df: "#33FF66", ds: "#FFFFFF" },
  check:      { f: "#6622CC", s: "#331166", df: "#BB66FF", ds: "#FFFFFF" },
  exam:       { f: "#6622CC", s: "#331166", df: "#BB66FF", ds: "#FFFFFF" },
  clinical_indicator: { f: "#5500CC", s: "#220066", df: "#AA55FF", ds: "#FFFFFF" },
  anatomy:    { f: "#007788", s: "#003344", df: "#22EEFF", ds: "#FFFFFF" },
  procedure:  { f: "#CC0066", s: "#660033", df: "#FF4499", ds: "#FFFFFF" },
  gene:       { f: "#4400CC", s: "#220066", df: "#9944FF", ds: "#FFFFFF" },
  pathogen:   { f: "#BB0000", s: "#550000", df: "#FF3333", ds: "#FFFFFF" },
  guideline:  { f: "#AA8800", s: "#554400", df: "#FFDD33", ds: "#FFFFFF" },
  metric:     { f: "#0055CC", s: "#002266", df: "#5599FF", ds: "#FFFFFF" },
  other:      { f: "#556677", s: "#334455", df: "#AABBCC", ds: "#FFFFFF" },
};

// ═══ Edge colors — fully opaque ═══
const EC: Record<string, { l: string; d: string }> = {
  treats:          { l: "#008833", d: "#55FF88" },
  causes:          { l: "#CC0000", d: "#FF5555" },
  associated_with: { l: "#0055AA", d: "#5599FF" },
  contraindicated: { l: "#CC3300", d: "#FF7733" },
  diagnoses:       { l: "#6622BB", d: "#AA55FF" },
  prevents:        { l: "#007788", d: "#44EEFF" },
  symptom_of:      { l: "#CC4400", d: "#FF8855" },
  interacts_with:  { l: "#BB0055", d: "#FF4499" },
  related_to:      { l: "#667788", d: "#AABBCC" },
};
const EDGE_DEFAULT = { l: "#667788", d: "#AABBCC" };

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
  const maxW = Math.max(1, ...nodes.map(n => n.weight || 1));
  return {
    nodes: nodes.map(n => {
      const c = nc(n.group || "other");
      const w = n.weight || 1;
      const r = 16 + Math.sqrt(w / maxW) * 36;
      const lbl = (n.label || "").length > 22 ? (n.label || "").slice(0, 20) + "…" : (n.label || "");
      return {
        id: String(n.id),
        data: { label: n.label, group: n.group || "other", weight: w, description: n.description || "" },
        style: {
          size: r * 2,
          fill: dark ? c.df : c.f,
          stroke: dark ? c.ds : c.s,
          lineWidth: dark ? 4 : 4.5,
          labelText: lbl,
          labelFill: dark ? "#FFFFFF" : "#000000",
          labelFontSize: 12,
          labelFontWeight: dark ? 700 : 700,
          labelPlacement: "bottom",
          labelOffsetY: r / 2 + 6,
          cursor: "pointer",
          // 3D depth illusion via offset shadow
          shadowColor: dark ? "rgba(0,0,0,0.6)" : "rgba(0,0,0,0.45)",
          shadowBlur: dark ? 18 : 12,
          shadowOffsetX: 3,
          shadowOffsetY: 4,
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
        lineWidth: 3 + (e.weight || 1) * 0.5,
        endArrow: false,
        shadowColor: dark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.10)",
        shadowBlur: 6,
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
      const reset: Record<string, string[]> = {};
      nd.forEach(n => { reset[n.id] = []; });
      g.setElementState(reset);
      const ereset: Record<string, string[]> = {};
      g.getEdgeData().forEach(e => { ereset[e.id!] = []; });
      g.setElementState(ereset);
      return;
    }
    const nstates: Record<string, string | string[]> = {};
    nd.forEach(n => {
      const l = ((n.data?.label as string) || "").toLowerCase();
      const gr = (n.data?.group as string) || "";
      nstates[n.id] = (!s || l.includes(s)) && (!f || gr === f) ? "active" : "inactive";
    });
    g.setElementState(nstates);
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
  const animFrameRef = useRef<number>(0);
  const nodePositionsRef = useRef<Map<string, { x: number; y: number; vx: number; vy: number }>>(new Map());
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

  // ── Tooltip ──
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

  // ── Floating animation — setInterval at 120ms (~8fps), 25 random nodes/tick ──
  const startFloatAnimation = useCallback((g: Graph) => {
    const posMap = nodePositionsRef.current;
    posMap.clear();
    // Delay to let d3-force layout settle before capturing positions
    setTimeout(() => {
      if (!graphRef.current || graphRef.current !== g) return;
      try {
        g.getNodeData().forEach((n: any) => {
          const pos = g.getElementPosition(n.id);
          if (pos) posMap.set(n.id, { x: pos[0], y: pos[1], vx: 0, vy: 0 });
        });
      } catch { /* ok */ }

      const interval = setInterval(() => {
        if (!graphRef.current || graphRef.current !== g) { clearInterval(interval); return; }
        try {
          const allIds = Array.from(posMap.keys());
          if (allIds.length === 0) return;
          const batchSize = Math.min(25, allIds.length);
          const batch: string[] = [];
          const pool = [...allIds];
          for (let i = 0; i < batchSize && pool.length > 0; i++) {
            const idx = Math.floor(Math.random() * pool.length);
            batch.push(pool[idx]);
            pool.splice(idx, 1);
          }
          const updates: { id: string; style: { x: number; y: number } }[] = [];
          for (const id of batch) {
            const p = posMap.get(id);
            if (!p) continue;
            p.vx += (Math.random() - 0.5) * 0.15;
            p.vy += (Math.random() - 0.5) * 0.15;
            p.vx *= 0.85; p.vy *= 0.85;
            const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
            if (speed > 2.0) { p.vx *= 2.0 / speed; p.vy *= 2.0 / speed; }
            p.x += p.vx;
            p.y += p.vy;
            updates.push({ id, style: { x: p.x, y: p.y } });
          }
          if (updates.length > 0) {
            try { g.updateNodeData(updates); } catch { /* ok */ }
          }
        } catch { /* ok */ }
      }, 120);

      animFrameRef.current = interval as unknown as number;
    }, 800);
  }, []);

  // ── Main graph effect ──
  useEffect(() => {
    const c = containerRef.current;
    if (!c || !nodes.length) return;
    const dark = theme === "dark", W = c.clientWidth || 800, H = c.clientHeight || 500;
    let aborted = false;

    // Kill animation loop
    if (animFrameRef.current) { clearInterval(animFrameRef.current); animFrameRef.current = 0; }
    // Destroy previous
    if (graphRef.current) { try { graphRef.current.destroy(); } catch { /* ok */ } graphRef.current = null; }
    while (c.firstChild) c.removeChild(c.firstChild);

    // Tooltip element
    const tip = document.createElement("div");
    tip.style.cssText = "display:none;position:fixed;z-index:9999;pointer-events:none;padding:8px 10px;border-radius:8px;background:var(--bg-surface,#fff);border:1px solid var(--bd-100);box-shadow:var(--sh-lg);font-size:11px;max-width:240px;";
    c.appendChild(tip);
    tooltipRef.current = tip;

    try {
      const g = new Graph({
        container: c, width: W, height: H,
        autoFit: "view",
        padding: [80, 80, 80, 80],
        animation: false,
        background: "transparent",
        data: buildData(nodes, edges, dark),
        layout: {
          type: "d3-force",
          preventOverlap: true,
          nodeSize: 52,
          linkDistance: 170,
          animate: true,
          alphaDecay: 0.012,
          alphaMin: 0.001,
          collideStrength: 1.8,
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
            background: dark ? "#1e293b" : "#ffffff",
            border: `2px solid ${dark ? "#AABBCC" : "#667788"}`,
            borderRadius: 6,
          },
        }],
        node: {
          type: "circle",
          state: {
            active: {
              stroke: "#FFFFFF",
              lineWidth: 7,
              labelFontSize: 14,
              labelFontWeight: 700,
              labelFill: "#FFFFFF",
              shadowColor: "rgba(255,255,255,0.95)",
              shadowBlur: 40,
              shadowOffsetX: 0,
              shadowOffsetY: 0,
            },
            inactive: { opacity: dark ? 0.20 : 0.15 },
            selected: {
              stroke: "#FFFFFF",
              lineWidth: 9,
              labelFontSize: 16,
              labelFontWeight: 700,
              labelFill: "#FFD700",
              shadowColor: "rgba(255,215,0,0.95)",
              shadowBlur: 50,
              shadowOffsetX: 0,
              shadowOffsetY: 0,
            },
          },
        },
        edge: {
          type: "line",
          state: {
            active: { stroke: "#FFFFFF", lineWidth: 6, shadowColor: "rgba(255,255,255,0.8)", shadowBlur: 18 },
            inactive: { opacity: dark ? 0.12 : 0.10 },
          },
        },
      });

      g.render().then(() => {
        if (aborted) { try { g.destroy(); } catch { /* ok */ } return; }
        graphRef.current = g;
        if (onReady) onReady(g);
        applyHL(g, search, filter);
        // Start floating animation
        startFloatAnimation(g);
      });

      // ── Events ──
      g.on("node:click", (evt: any) => {
        const nid = evt?.target?.id;
        if (!nid || !onNodeClick) return;
        const found = nodes.find(n => String(n.id) === nid);
        if (!found) return;
        const nstates: Record<string, string[]> = {};
        g.getNodeData().forEach(nd => { nstates[nd.id] = nd.id === nid ? ["selected"] : []; });
        g.setElementState(nstates);
        onNodeClick(found);
      });

      g.on("canvas:click", () => {
        const reset: Record<string, string[]> = {};
        g.getNodeData().forEach(nd => { reset[nd.id] = []; });
        g.setElementState(reset);
      });

      g.on("node:pointerenter", (evt: any) => {
        const nd = evt?.target?.id ? g.getNodeData().find((n: any) => n.id === evt.target.id) : null;
        if (nd?.data && evt.clientX) showTooltip(evt.clientX, evt.clientY, nd.data);
      });
      g.on("node:pointermove", (evt: any) => {
        if (tooltipRef.current?.style.display === "block" && evt.clientX) {
          tooltipRef.current.style.left = `${Math.min(evt.clientX + 16, window.innerWidth - 250)}px`;
          tooltipRef.current.style.top = `${Math.min(Math.max(evt.clientY - 30, 10), window.innerHeight - 100)}px`;
        }
      });
      g.on("node:pointerleave", () => hideTooltip());

      const onKey = (e: KeyboardEvent) => {
        if (e.key === "f" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); try { g.fitView({ padding: 80 }); } catch { /* ok */ } }
        if (e.key === "Escape") { const r: Record<string, string[]> = {}; g.getNodeData().forEach(nd => { r[nd.id] = []; }); g.setElementState(r); }
      };
      window.addEventListener("keydown", onKey);

      return () => {
        aborted = true;
        if (animFrameRef.current) { clearInterval(animFrameRef.current); animFrameRef.current = 0; }
        window.removeEventListener("keydown", onKey);
        try { g.destroy(); } catch { /* ok */ }
        graphRef.current = null;
        tooltipRef.current = null;
      };
    } catch (e) { console.error("G6:", e); }
  }, [nodes.length, edges.length, theme]);

  // ── Search/filter ──
  useEffect(() => {
    const g = graphRef.current;
    if (g) applyHL(g, search, filter);
  }, [search, filter]);

  // ── Resize ──
  useEffect(() => {
    const r = () => { const g = graphRef.current, c = containerRef.current; if (g && c) g.setSize(c.clientWidth, c.clientHeight); };
    window.addEventListener("resize", r);
    return () => window.removeEventListener("resize", r);
  }, []);

  return <div ref={containerRef} style={{ width: "100%", height: "100%", minHeight: 500 }} />;
}
