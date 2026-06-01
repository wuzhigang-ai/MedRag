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

// ═══ 100x Brightness Color Palette ═══
const NC: Record<string, { f: string; s: string; df: string; ds: string }> = {
  disease:    { f: "#DD0000", s: "#880000", df: "#FFAAAA", ds: "#FFFFFF" },
  drug:       { f: "#0055DD", s: "#002288", df: "#AADDFF", ds: "#FFFFFF" },
  symptom:    { f: "#DD4400", s: "#882200", df: "#FFBB99", ds: "#FFFFFF" },
  treatment:  { f: "#00AA44", s: "#005522", df: "#99FFCC", ds: "#FFFFFF" },
  check:      { f: "#7722DD", s: "#441188", df: "#EECCFF", ds: "#FFFFFF" },
  exam:       { f: "#7722DD", s: "#441188", df: "#EECCFF", ds: "#FFFFFF" },
  clinical_indicator: { f: "#6600DD", s: "#330088", df: "#CCBBFF", ds: "#FFFFFF" },
  anatomy:    { f: "#0099AA", s: "#004455", df: "#AAFFFF", ds: "#FFFFFF" },
  procedure:  { f: "#DD0077", s: "#880044", df: "#FFBBDD", ds: "#FFFFFF" },
  gene:       { f: "#5500DD", s: "#220088", df: "#CCAAFF", ds: "#FFFFFF" },
  pathogen:   { f: "#CC0000", s: "#770000", df: "#FF9999", ds: "#FFFFFF" },
  guideline:  { f: "#BB9900", s: "#664400", df: "#FFF0AA", ds: "#FFFFFF" },
  metric:     { f: "#0055DD", s: "#002288", df: "#AADDFF", ds: "#FFFFFF" },
  other:      { f: "#667788", s: "#445566", df: "#EEEEFF", ds: "#FFFFFF" },
};

const EC: Record<string, { l: string; d: string }> = {
  treats: { l: "#00AA44", d: "#AAFFCC" }, causes: { l: "#DD0000", d: "#FFAAAA" },
  associated_with: { l: "#0066CC", d: "#AADDFF" }, contraindicated: { l: "#DD4400", d: "#FFBB99" },
  diagnoses: { l: "#7722DD", d: "#EECCFF" }, prevents: { l: "#0099AA", d: "#AAFFFF" },
  symptom_of: { l: "#DD5500", d: "#FFBB99" }, interacts_with: { l: "#DD0077", d: "#FFBBEE" },
  related_to: { l: "#8899AA", d: "#DDEEFF" },
};
const EDGE_DEFAULT = { l: "#8899AA", d: "#DDEEFF" };

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
    lineWidth: dark ? 5 : 5.5,
    labelText: lbl,
    labelFill: dark ? "#FFFFFF" : "#000000",
    labelFontSize: 12,
    labelFontWeight: 700 as const,
    labelPlacement: "bottom" as const,
    labelOffsetY: r / 2 + 6,
    cursor: "pointer" as const,
    shadowColor: dark ? c.df : c.f,
    shadowBlur: dark ? 30 : 20,
    shadowOffsetX: 3,
    shadowOffsetY: 4,
  };
}

function buildEdgeStyle(e: GEdge, dark: boolean) {
  return {
    stroke: ec(e.relationType || "", dark),
    lineWidth: 4 + (e.weight || 1) * 0.8,
    endArrow: false,
    shadowColor: dark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.15)",
    shadowBlur: 10,
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
  const destroyedRef = useRef(false);
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
          active: { stroke: "#FFFFFF", lineWidth: 10, labelFontSize: 16, labelFontWeight: 700, labelFill: "#FFFFFF", shadowColor: "rgba(255,255,255,0.98)", shadowBlur: 60 },
          inactive: { opacity: dark ? 0.25 : 0.20 },
          selected: { stroke: "#FFD700", lineWidth: 12, labelFontSize: 18, labelFontWeight: 700, labelFill: "#FFD700", shadowColor: "rgba(255,215,0,0.98)", shadowBlur: 70 },
        },
      },
      edge: {
        type: "line",
        state: {
          active: { stroke: "#FFFFFF", lineWidth: 8, shadowColor: "rgba(255,255,255,0.9)", shadowBlur: 25 },
          inactive: { opacity: dark ? 0.18 : 0.14 },
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
      destroyedRef.current = false;
      const posMap = posMapRef.current;
      posMap.clear();
      animTimeoutRef.current = window.setTimeout(() => {
        if (destroyedRef.current || graphRef.current !== graph) return;
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
          if (destroyedRef.current || graphRef.current !== graph) return;
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
                const ndx = (nx - cx) / dist, ndy = (ny - cy) / dist;
                nx = cx + ndx * R; ny = cy + ndy * R;
                p.vx *= -0.5; p.vy *= -0.5;
              }
              // Collision avoidance: push away from nearby nodes
              for (const oid of allIds) {
                if (oid === id) continue;
                const o = posMap.get(oid); if (!o) continue;
                const dx = nx - o.x, dy = ny - o.y;
                const d = Math.sqrt(dx * dx + dy * dy);
                const MIN_GAP = 35;
                if (d < MIN_GAP && d > 0.1) {
                  const push = (MIN_GAP - d) * 0.5;
                  nx += (dx / d) * push;
                  ny += (dy / d) * push;
                }
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
      destroyedRef.current = true;
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
    destroyedRef.current = false;
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
        if (destroyedRef.current || graphRef.current !== graph) return;
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
            // Collision avoidance
            for (const oid of allIds) {
              if (oid === id) continue;
              const o = posMap.get(oid); if (!o) continue;
              const dx = nx - o.x, dy = ny - o.y;
              const d = Math.sqrt(dx * dx + dy * dy);
              if (d < 35 && d > 0.1) {
                const push = (35 - d) * 0.5;
                nx += (dx / d) * push;
                ny += (dy / d) * push;
              }
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
