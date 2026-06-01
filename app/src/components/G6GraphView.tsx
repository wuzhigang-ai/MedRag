/**
 * G6GraphView — Medical Knowledge Graph · Create Once, Update In-Place
 *
 * Architecture: Graph created once on mount, styles updated in-place via
 * updateNodeData/updateEdgeData on theme/data change. No destroy/recreate
 * cycles. This eliminates ALL G6 destroy race conditions.
 *
 * - 3D sphere illusion via offset shadows
 * - Floating animation at 8fps via setInterval
 * - Extreme contrast dual-theme palette
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { Graph } from "@antv/g6";

// ═══ Extreme Contrast Color Palette ═══
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

const EC: Record<string, { l: string; d: string }> = {
  treats: { l: "#008833", d: "#55FF88" }, causes: { l: "#CC0000", d: "#FF5555" },
  associated_with: { l: "#0055AA", d: "#5599FF" }, contraindicated: { l: "#CC3300", d: "#FF7733" },
  diagnoses: { l: "#6622BB", d: "#AA55FF" }, prevents: { l: "#007788", d: "#44EEFF" },
  symptom_of: { l: "#CC4400", d: "#FF8855" }, interacts_with: { l: "#BB0055", d: "#FF4499" },
  related_to: { l: "#667788", d: "#AABBCC" },
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

function buildNodeStyle(n: GNode, dark: boolean) {
  const c = nc(n.group || "other");
  const r = 16 + Math.sqrt((n.weight || 1) / 10) * 36;
  const lbl = (n.label || "").length > 22 ? (n.label || "").slice(0, 20) + "…" : (n.label || "");
  return {
    size: r * 2,
    fill: dark ? c.df : c.f,
    stroke: dark ? c.ds : c.s,
    lineWidth: dark ? 4 : 4.5,
    labelText: lbl,
    labelFill: dark ? "#FFFFFF" : "#000000",
    labelFontSize: 12,
    labelFontWeight: 700 as const,
    labelPlacement: "bottom" as const,
    labelOffsetY: r / 2 + 6,
    cursor: "pointer" as const,
    shadowColor: dark ? "rgba(0,0,0,0.6)" : "rgba(0,0,0,0.45)",
    shadowBlur: dark ? 18 : 12,
    shadowOffsetX: 3,
    shadowOffsetY: 4,
  };
}

function buildEdgeStyle(e: GEdge, dark: boolean) {
  return {
    stroke: ec(e.relationType || "", dark),
    lineWidth: 3 + (e.weight || 1) * 0.5,
    endArrow: false,
    shadowColor: dark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.10)",
    shadowBlur: 6,
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
      estates[e.id!] = (!sa?.includes("inactive") && !ta?.includes("inactive")) ? "active" : "inactive";
    });
    g.setElementState(estates);
  } catch (err) { /* ignore */ }
}

// Batch-update all styles in-place (no destroy/recreate)
function refreshStyles(g: Graph, nodes: GNode[], edges: GEdge[], dark: boolean) {
  try {
    const nUpdates = nodes.map(n => ({ id: String(n.id), style: buildNodeStyle(n, dark) }));
    g.updateNodeData(nUpdates);
    const eUpdates = edges.map((e, i) => ({ id: String(e.id || `e-${i}`), style: buildEdgeStyle(e, dark) }));
    g.updateEdgeData(eUpdates);
  } catch { /* ignore */ }
}

export default function G6GraphView({ nodes, edges, search, filter, onNodeClick, onReady }: {
  nodes: GNode[]; edges: GEdge[]; search: string; filter: string;
  onNodeClick?: (n: GNode) => void; onReady?: (g: Graph) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph | null>(null);
  const animTimerRef = useRef<number>(0);
  const animTimeoutRef = useRef<number>(0);
  const posMapRef = useRef<Map<string, { x: number; y: number; vx: number; vy: number }>>(new Map());
  const [theme, setTheme] = useState(isDark() ? "dark" : "light");

  // ── Theme detection ──
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

  // Track whether graph has been created (survives re-renders)
  const hasGraphRef = useRef(false);

  // ── Graph creation — ONCE when data first arrives, NEVER destroyed until unmount ──
  useEffect(() => {
    const c = containerRef.current;
    if (!c || !nodes.length || hasGraphRef.current) return;
    hasGraphRef.current = true;
    const dark = theme === "dark";
    const W = c.clientWidth || 800, H = c.clientHeight || 500;

    // Clean container
    while (c.firstChild) c.removeChild(c.firstChild);

    const g = new Graph({
      container: c, width: W, height: H,
      autoFit: "view", padding: [80, 80, 80, 80],
      animation: false, background: "transparent",
      data: {
        nodes: nodes.map(n => ({
          id: String(n.id),
          data: { label: n.label, group: n.group || "other", weight: n.weight || 1, description: n.description || "" },
          style: buildNodeStyle(n, dark),
          states: ["active", "inactive", "selected"],
        })),
        edges: edges.map((e, i) => ({
          id: String(e.id || `e-${i}`),
          source: String(e.source), target: String(e.target),
          data: { relationType: e.relationType || "related_to", weight: e.weight || 1 },
          style: buildEdgeStyle(e, dark),
          states: ["active", "inactive"],
        })),
      },
      layout: {
        type: "d3-force", preventOverlap: true, nodeSize: 52,
        linkDistance: 170, animate: true, alphaDecay: 0.012,
        alphaMin: 0.001, collideStrength: 1.8, forceSimulationIterations: 200,
      },
      behaviors: ["drag-canvas", "zoom-canvas",
        { type: "drag-element", enableTransient: true },
        { type: "hover-activate", degree: 1, direction: "both" },
      ],
      plugins: [{
        type: "minimap", size: [150, 110], position: "right-bottom",
        style: { background: dark ? "#1e293b" : "#ffffff", border: `2px solid ${dark ? "#AABBCC" : "#667788"}`, borderRadius: 6 },
      }],
      node: {
        type: "circle",
        state: {
          active: { stroke: "#FFFFFF", lineWidth: 7, labelFontSize: 14, labelFontWeight: 700, labelFill: "#FFFFFF", shadowColor: "rgba(255,255,255,0.95)", shadowBlur: 40 },
          inactive: { opacity: dark ? 0.20 : 0.15 },
          selected: { stroke: "#FFFFFF", lineWidth: 9, labelFontSize: 16, labelFontWeight: 700, labelFill: "#FFD700", shadowColor: "rgba(255,215,0,0.95)", shadowBlur: 50 },
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
      graphRef.current = g;
      if (onReady) onReady(g);
      applyHL(g, search, filter);
      startFloatAnim(g);
    }).catch(() => { /* render rejected */ });

    // ── Event handlers ──
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

    // Tooltip overlay
    const tip = document.createElement("div");
    tip.style.cssText = "display:none;position:fixed;z-index:9999;pointer-events:none;padding:8px 10px;border-radius:8px;background:var(--bg-surface,#fff);border:1px solid var(--bd-100);box-shadow:var(--sh-lg);font-size:11px;max-width:240px;";
    c.appendChild(tip);

    g.on("node:pointerenter", (evt: any) => {
      const nd = evt?.target?.id ? g.getNodeData().find((n: any) => n.id === evt.target.id) : null;
      if (!nd?.data || !evt.clientX) return;
      const grp = nd.data.group || "other";
      const color = nc(grp);
      const labels: Record<string, string> = {
        disease: "疾病", drug: "药物", symptom: "症状", treatment: "治疗",
        check: "检查", exam: "检查", clinical_indicator: "指标", anatomy: "解剖",
        procedure: "手术", gene: "基因", pathogen: "病原体", guideline: "指南",
        metric: "指标", other: "其他",
      };
      tip.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
          <div style="width:10px;height:10px;border-radius:50%;background:${color.f};flex-shrink:0;"></div>
          <span style="font-size:9px;padding:1px 6px;border-radius:4px;background:var(--bg-hover);color:var(--tx-300);">${labels[grp] || grp}</span>
          ${nd.data.weight > 0 ? `<span style="font-size:9px;color:var(--tx-200);">权重${nd.data.weight}</span>` : ""}
        </div>
        <div style="font-weight:700;font-size:13px;color:var(--tx-900);margin-bottom:2px;">${nd.data.label || "?"}</div>
        ${nd.data.description ? `<div style="font-size:10px;color:var(--tx-500);line-height:1.5;max-width:200px;">${nd.data.description.slice(0, 120)}${nd.data.description.length > 120 ? "…" : ""}</div>` : ""}
      `;
      const rect = tip.getBoundingClientRect();
      tip.style.left = `${Math.min(evt.clientX + 16, window.innerWidth - rect.width - 10)}px`;
      tip.style.top = `${Math.min(Math.max(evt.clientY - rect.height / 2, 10), window.innerHeight - rect.height - 10)}px`;
      tip.style.display = "block";
    });
    g.on("node:pointermove", (evt: any) => {
      if (tip.style.display === "block" && evt.clientX) {
        tip.style.left = `${Math.min(evt.clientX + 16, window.innerWidth - 250)}px`;
        tip.style.top = `${Math.min(Math.max(evt.clientY - 30, 10), window.innerHeight - 100)}px`;
      }
    });
    g.on("node:pointerleave", () => { tip.style.display = "none"; });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "f" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); try { g.fitView({ padding: 80 }); } catch { /* ok */ } }
      if (e.key === "Escape") { const r: Record<string, string[]> = {}; g.getNodeData().forEach(nd => { r[nd.id] = []; }); g.setElementState(r); }
    };
    window.addEventListener("keydown", onKey);

    // ── Brownian drift + hard circular boundary ──
    function startFloatAnim(graph: Graph) {
      const posMap = posMapRef.current;
      posMap.clear();
      animTimeoutRef.current = window.setTimeout(() => {
        if (graphRef.current !== graph) return;
        // Capture centroid + boundary radius
        let cx = 0, cy = 0;
        try {
          graph.getNodeData().forEach((n: any) => {
            const pos = graph.getElementPosition(n.id);
            if (pos) {
              posMap.set(n.id, { x: pos[0], y: pos[1], vx: 0, vy: 0 });
              cx += pos[0]; cy += pos[1];
            }
          });
        } catch { /* ok */ }
        const ids = Array.from(posMap.keys());
        if (ids.length === 0) return;
        cx /= ids.length; cy /= ids.length;
        let R = 0;
        ids.forEach(id => {
          const p = posMap.get(id); if (!p) return;
          R = Math.max(R, Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2));
        });
        R *= 1.05; // 5% margin
        animTimerRef.current = window.setInterval(() => {
          if (graphRef.current !== graph) return;
          try {
            const allIds = Array.from(posMap.keys());
            if (allIds.length === 0) return;
            const batchSize = Math.min(80, allIds.length);
            const pool = [...allIds]; const batch: string[] = [];
            for (let i = 0; i < batchSize && pool.length > 0; i++) {
              batch.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
            }
            const updates: { id: string; style: { x: number; y: number } }[] = [];
            for (const id of batch) {
              const p = posMap.get(id); if (!p) continue;
              p.vx += (Math.random() - 0.5) * 3;
              p.vy += (Math.random() - 0.5) * 3;
              p.vx *= 0.88; p.vy *= 0.88;
              const spd = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
              if (spd > 6) { p.vx *= 6 / spd; p.vy *= 6 / spd; }
              // Hard boundary: bounce back if outside circle
              let nx = p.x + p.vx, ny = p.y + p.vy;
              const dist = Math.sqrt((nx - cx) ** 2 + (ny - cy) ** 2);
              if (dist > R) {
                // Reflect velocity and clamp position to boundary
                const ndx = (nx - cx) / dist, ndy = (ny - cy) / dist;
                nx = cx + ndx * R;
                ny = cy + ndy * R;
                // Bounce: reverse velocity component away from center
                p.vx *= -0.5; p.vy *= -0.5;
              }
              p.x = nx; p.y = ny;
              updates.push({ id, style: { x: p.x, y: p.y } });
            }
            if (updates.length > 0 && graphRef.current === graph) {
              graph.updateNodeData(updates);
              try { graph.draw(); } catch { /* ok */ }
            }
          } catch { /* ok */ }
        }, 80);
      }, 1500);
    }

    // ── Cleanup — ONLY on unmount ──
    return () => {
      hasGraphRef.current = false;
      if (animTimerRef.current) { clearInterval(animTimerRef.current); animTimerRef.current = 0; }
      if (animTimeoutRef.current) { clearTimeout(animTimeoutRef.current); animTimeoutRef.current = 0; }
      window.removeEventListener("keydown", onKey);
      try { g.destroy(); } catch { /* ok */ }
      graphRef.current = null;
    };
  }, [nodes.length > 0]); // re-evaluate only when data first appears, cleanup only on unmount

  // ── Theme update — refresh styles in-place (no destroy) ──
  useEffect(() => {
    const g = graphRef.current;
    if (!g || !nodes.length) return;
    const dark = theme === "dark";
    refreshStyles(g, nodes, edges, dark);
    // Update state opacities via graph config is not possible,
    // but existing states still work with in-place updates
  }, [theme]); // only theme changes trigger style refresh

  // ── Data update — when nodes/edges change externally ──
  useEffect(() => {
    const g = graphRef.current;
    if (!g || !nodes.length) return;
    const dark = theme === "dark";
    try { g.setData({ nodes: [], edges: [] }); } catch { /* ok */ }
    // Re-populate with new data
    const nd = nodes.map(n => ({
      id: String(n.id),
      data: { label: n.label, group: n.group || "other", weight: n.weight || 1, description: n.description || "" },
      style: buildNodeStyle(n, dark),
      states: ["active", "inactive", "selected"],
    }));
    const ed = edges.map((e, i) => ({
      id: String(e.id || `e-${i}`),
      source: String(e.source), target: String(e.target),
      data: { relationType: e.relationType || "related_to", weight: e.weight || 1 },
      style: buildEdgeStyle(e, dark),
      states: ["active", "inactive"],
    }));
    try { g.setData({ nodes: nd, edges: ed }); } catch { /* ok */ }
    g.render().then(() => {
      if (graphRef.current === g) {
        applyHL(g, search, filter);
        // Restart animation with new positions
        startFloatAnimInternal(g);
      }
    }).catch(() => { /* render rejected */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length, edges.length]);

  function startFloatAnimInternal(graph: Graph) {
    if (animTimerRef.current) { clearInterval(animTimerRef.current); animTimerRef.current = 0; }
    if (animTimeoutRef.current) { clearTimeout(animTimeoutRef.current); animTimeoutRef.current = 0; }
    const posMap = posMapRef.current;
    posMap.clear();
    animTimeoutRef.current = window.setTimeout(() => {
      if (graphRef.current !== graph) return;
      let cx = 0, cy = 0;
      try {
        graph.getNodeData().forEach((n: any) => {
          const pos = graph.getElementPosition(n.id);
          if (pos) {
            posMap.set(n.id, { x: pos[0], y: pos[1], vx: 0, vy: 0 });
            cx += pos[0]; cy += pos[1];
          }
        });
      } catch { /* ok */ }
      const ids = Array.from(posMap.keys());
      if (ids.length === 0) return;
      cx /= ids.length; cy /= ids.length;
      let R = 0;
      ids.forEach(id => {
        const p = posMap.get(id); if (!p) return;
        R = Math.max(R, Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2));
      });
      R *= 1.05;
      animTimerRef.current = window.setInterval(() => {
        if (graphRef.current !== graph) return;
        try {
          const allIds = Array.from(posMap.keys());
          if (allIds.length === 0) return;
          const batchSize = Math.min(80, allIds.length);
          const pool = [...allIds]; const batch: string[] = [];
          for (let i = 0; i < batchSize && pool.length > 0; i++) {
            batch.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
          }
          const updates: { id: string; style: { x: number; y: number } }[] = [];
          for (const id of batch) {
            const p = posMap.get(id); if (!p) continue;
            p.vx += (Math.random() - 0.5) * 3;
            p.vy += (Math.random() - 0.5) * 3;
            p.vx *= 0.88; p.vy *= 0.88;
            const spd = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
            if (spd > 6) { p.vx *= 6 / spd; p.vy *= 6 / spd; }
            let nx = p.x + p.vx, ny = p.y + p.vy;
            const dist = Math.sqrt((nx - cx) ** 2 + (ny - cy) ** 2);
            if (dist > R) {
              const ndx = (nx - cx) / dist, ndy = (ny - cy) / dist;
              nx = cx + ndx * R; ny = cy + ndy * R;
              p.vx *= -0.5; p.vy *= -0.5;
            }
            p.x = nx; p.y = ny;
            updates.push({ id, style: { x: p.x, y: p.y } });
          }
          if (updates.length > 0 && graphRef.current === graph) {
            graph.updateNodeData(updates);
            try { graph.draw(); } catch { /* ok */ }
          }
        } catch { /* ok */ }
      }, 80);
    }, 1500);
  }

  // ── Search/filter ──
  useEffect(() => {
    const g = graphRef.current;
    if (g) { try { applyHL(g, search, filter); } catch { /* ok */ } }
  }, [search, filter]);

  // ── Resize ──
  useEffect(() => {
    const r = () => { try { const g = graphRef.current, c = containerRef.current; if (g && c) g.setSize(c.clientWidth, c.clientHeight); } catch { /* ok */ } };
    window.addEventListener("resize", r);
    return () => window.removeEventListener("resize", r);
  }, []);

  return <div ref={containerRef} style={{ width: "100%", height: "100%", minHeight: 500 }} />;
}
