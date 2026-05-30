/**
 * GraphPage — Obsidian-style knowledge graph visualization.
 * Canvas force-directed layout with full light/dark theme support.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { trpc } from "@/providers/trpc";
import { FiSearch, FiZoomIn, FiZoomOut, FiMaximize, FiInfo } from "react-icons/fi";

const ntColors: Record<string, string> = {
  disease: "#E84D4D", drug: "#3B82F6", symptom: "#F07850", treatment: "#10B981",
  clinical_indicator: "#8B5CF6", anatomy: "#06B6D4", procedure: "#EC4899",
  gene: "#7C3AED", pathogen: "#DC2626", other: "#64748B",
};
const ntLabels: Record<string, string> = {
  disease: "疾病", drug: "药物", symptom: "症状", treatment: "治疗", clinical_indicator: "指标",
  anatomy: "解剖", procedure: "手术", gene: "基因", pathogen: "病原体", other: "其他",
};
const rtLabels: Record<string, string> = {
  treats: "治疗", causes: "导致", associated_with: "相关", contraindicated: "禁忌",
  diagnoses: "诊断", prevents: "预防", symptom_of: "症状", interacts_with: "相互作用", related_to: "关联",
};

interface GNode { id: number; label: string; nodeType: string; x: number; y: number; vx: number; vy: number; description?: string | null; occurrenceCount?: number | null; icd10Code?: string | null; meshTerm?: string | null; group?: string; weight?: number; }
interface GEdge { id: number; source: number; target: number; relationType: string; strength: number | null; }

function getThemeColors(): { bg: string; text: string; textMuted: string; surface: string; edgeLight: string; edgeDark: string } {
  const s = getComputedStyle(document.documentElement);
  return {
    bg: s.getPropertyValue("--bg-base").trim() || "#0c1222",
    text: s.getPropertyValue("--tx-700").trim() || "#c8d5e8",
    textMuted: s.getPropertyValue("--tx-300").trim() || "#7a8db0",
    surface: s.getPropertyValue("--bg-surface").trim() || "#1a2235",
    edgeLight: s.getPropertyValue("--bd-100").trim() || "rgba(255,255,255,0.06)",
    edgeDark: s.getPropertyValue("--bd-200").trim() || "rgba(255,255,255,0.12)",
  };
}

export default function GraphPage() {
  const cvRef = useRef<HTMLCanvasElement>(null);
  const ctrRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [selNode, setSelNode] = useState<GNode | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [hoverNode, setHoverNode] = useState<GNode | null>(null);

  const { data: gd } = trpc.knowledge.getGraph.useQuery();
  const { data: stats } = trpc.knowledge.stats.useQuery();

  const nodes: GNode[] = (gd?.nodes ?? []).map((n) => ({
    ...n, id: n.id ?? Math.random(), label: n.label ?? "?", nodeType: n.nodeType ?? "other",
    x: 300 + Math.random() * 400, y: 200 + Math.random() * 300, vx: 0, vy: 0,
  }));
  const edges: GEdge[] = (gd?.edges ?? []).map((e) => ({
    ...e, source: e.sourceNodeId ?? e.source ?? 0, target: e.targetNodeId ?? e.target ?? 0,
  }));

  // Build node type stats from real data
  const nodeTypeStats: Record<string, number> = {};
  nodes.forEach(n => { nodeTypeStats[n.nodeType] = (nodeTypeStats[n.nodeType] || 0) + 1; });

  useEffect(() => {
    if (!nodes.length || !cvRef.current) return;
    const cv = cvRef.current;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    let aid: number;

    const resize = () => {
      const c = ctrRef.current;
      if (c) { cv.width = c.clientWidth * devicePixelRatio; cv.height = c.clientHeight * devicePixelRatio; cv.style.width = c.clientWidth + "px"; cv.style.height = c.clientHeight + "px"; ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); }
    };
    resize(); window.addEventListener("resize", resize);

    // Physics simulation
    const sn = JSON.parse(JSON.stringify(nodes)) as GNode[];
    const se = edges.map((e) => ({
      ...e, sn: sn.find((n) => n.id === e.source)!, tn: sn.find((n) => n.id === e.target)!,
    })).filter(e => e.sn && e.tn);

    const filteredNodes = filter ? sn.filter(n => n.nodeType === filter) : sn;
    const filteredSet = new Set(filteredNodes.map(n => n.id));

    const sim = () => {
      for (let i = 0; i < sn.length; i++) {
        for (let j = i + 1; j < sn.length; j++) {
          const a = sn[i], b = sn[j];
          const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
          const f = 3000 / (d * d);
          a.vx -= (dx / d) * f * 0.5; a.vy -= (dy / d) * f * 0.5;
          b.vx += (dx / d) * f * 0.5; b.vy += (dy / d) * f * 0.5;
        }
      }
      for (const e of se) {
        if (!e.sn || !e.tn) continue;
        const dx = e.tn.x - e.sn.x, dy = e.tn.y - e.sn.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - 140) * 0.002;
        e.sn.vx += (dx / d) * f; e.sn.vy += (dy / d) * f;
        e.tn.vx -= (dx / d) * f; e.tn.vy -= (dy / d) * f;
      }
      const cx = cv.width / devicePixelRatio / 2, cy = cv.height / devicePixelRatio / 2;
      for (const n of sn) {
        n.vx += (cx - n.x) * 0.0003; n.vy += (cy - n.y) * 0.0003;
        n.vx *= 0.85; n.vy *= 0.85;
        n.x += n.vx; n.y += n.vy;
        n.x = Math.max(20, Math.min(cv.width / devicePixelRatio - 20, n.x));
        n.y = Math.max(20, Math.min(cv.height / devicePixelRatio - 20, n.y));
      }
    };

    const draw = () => {
      sim();
      const tc = getThemeColors();
      const w = cv.width / devicePixelRatio, h = cv.height / devicePixelRatio;
      ctx.clearRect(0, 0, w, h);
      // Background grid
      ctx.strokeStyle = tc.edgeLight; ctx.lineWidth = 0.5;
      const gs = 60;
      for (let x = (pan.x % gs + gs) % gs; x < w; x += gs) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = (pan.y % gs + gs) % gs; y < h; y += gs) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

      ctx.save(); ctx.translate(pan.x, pan.y); ctx.scale(zoom, zoom);

      // Edges
      for (const e of se) {
        const a = e.sn, b = e.tn;
        if (!a || !b) continue;
        const isFiltered = !filter || (filteredSet.has(a.id) && filteredSet.has(b.id));
        const isHighlighted = hoverNode && (a.id === hoverNode.id || b.id === hoverNode.id);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = isHighlighted ? "rgba(59,130,246,0.4)"
          : isFiltered ? tc.edgeDark
          : "rgba(100,100,120,0.04)";
        ctx.lineWidth = isHighlighted ? 2 : isFiltered ? 1 : 0.5;
        ctx.stroke();
        // Edge label
        if (isFiltered && zoom > 0.6) {
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          const lbl = rtLabels[e.relationType] || e.relationType;
          ctx.font = "9px Inter, system-ui, sans-serif";
          const tw = ctx.measureText(lbl).width;
          ctx.fillStyle = tc.surface; ctx.fillRect(mx - tw / 2 - 3, my - 5, tw + 6, 10);
          ctx.fillStyle = tc.textMuted; ctx.textAlign = "center"; ctx.fillText(lbl, mx, my + 3);
        }
      }

      // Nodes
      for (const n of sn) {
        const isFiltered = !filter || filteredSet.has(n.id);
        if (!isFiltered) continue;
        const isSel = selNode?.id === n.id;
        const isHover = hoverNode?.id === n.id;
        const color = ntColors[n.nodeType] || ntColors.other;
        const r = 6 + Math.min((n.weight || n.occurrenceCount || 1) * 1.5, 16);

        // Glow for selected/hovered
        if (isSel || isHover) {
          ctx.beginPath(); ctx.arc(n.x, n.y, r + 14, 0, Math.PI * 2);
          const glow = ctx.createRadialGradient(n.x, n.y, r, n.x, n.y, r + 14);
          glow.addColorStop(0, color + "40"); glow.addColorStop(1, "transparent");
          ctx.fillStyle = glow; ctx.fill();
          ctx.beginPath(); ctx.arc(n.x, n.y, r + 8, 0, Math.PI * 2);
          ctx.strokeStyle = color + "60"; ctx.lineWidth = 2; ctx.stroke();
        }
        // Main circle
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.fill();
        // Inner specular highlight
        ctx.beginPath(); ctx.arc(n.x - r * 0.3, n.y - r * 0.3, r * 0.35, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.fill();
        // Label (always visible, theme-colored)
        ctx.font = `${10 + Math.min(r * 0.3, 3)}px Inter, system-ui, sans-serif`;
        ctx.fillStyle = tc.text; ctx.textAlign = "center";
        const labelY = n.y + r + 12;
        // Label background for readability
        const lw = ctx.measureText(n.label).width;
        ctx.fillStyle = tc.surface + "cc"; ctx.fillRect(n.x - lw / 2 - 3, labelY - 8, lw + 6, 14);
        ctx.fillStyle = tc.text; ctx.fillText(n.label, n.x, labelY + 1);
      }
      ctx.restore();
      aid = requestAnimationFrame(draw);
    };

    draw();
    return () => { cancelAnimationFrame(aid); window.removeEventListener("resize", resize); };
  }, [nodes.length, edges.length, selNode, hoverNode, zoom, pan, filter]);

  const canvasToNode = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const cv = cvRef.current; if (!cv) return null;
    const rect = cv.getBoundingClientRect();
    const x = (e.clientX - rect.left - pan.x) / zoom, y = (e.clientY - rect.top - pan.y) / zoom;
    for (const n of nodes) {
      const r = 10 + (n.occurrenceCount || 1) * 1.5 + 8;
      if ((x - n.x) ** 2 + (y - n.y) ** 2 < r * r) return n;
    }
    return null;
  }, [nodes, zoom, pan]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const n = canvasToNode(e); setSelNode(n);
  }, [canvasToNode]);

  const handleMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const n = canvasToNode(e); setHoverNode(n);
    const cv = cvRef.current; if (cv) cv.style.cursor = n ? "pointer" : dragging ? "grabbing" : "grab";
  }, [canvasToNode, dragging]);

  const handleWheel = useCallback((e: React.WheelEvent) => { e.preventDefault(); setZoom((z) => Math.max(0.2, Math.min(4, z * (e.deltaY > 0 ? 0.92 : 1.08)))); }, []);
  const handleMD = useCallback((e: React.MouseEvent) => { setDragging(true); setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y }); }, [pan]);
  const handleMM = useCallback((e: React.MouseEvent) => { if (!dragging) return; setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y }); }, [dragging, dragStart]);
  const handleMU = useCallback(() => setDragging(false), []);

  return (
    <div style={{ display: "flex", gap: 12, height: "100%" }}>
      {/* Main area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
        {/* Toolbar */}
        <div className="m-card" style={{ padding: "8px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
            <div style={{ position: "relative", flexShrink: 0 }}>
              <FiSearch size={12} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--tx-100)", zIndex: 1 }} />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索节点..." className="m-input" style={{ paddingLeft: 28, height: 30, fontSize: 12, width: 170 }} />
            </div>
            <select value={filter} onChange={(e) => setFilter(e.target.value)} className="m-input" style={{ height: 30, fontSize: 12, width: 110, cursor: "pointer" }}>
              <option value="">全部类型</option>{Object.entries(ntLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={() => setZoom((z) => Math.min(4, z * 1.2))} className="m-btn m-btn-ghost" style={{ width: 28, height: 28, padding: 0 }}><FiZoomIn size={13} /></button>
            <button onClick={() => setZoom((z) => Math.max(0.2, z * 0.8))} className="m-btn m-btn-ghost" style={{ width: 28, height: 28, padding: 0 }}><FiZoomOut size={13} /></button>
            <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} className="m-btn m-btn-ghost" style={{ width: 28, height: 28, padding: 0 }}><FiMaximize size={13} /></button>
          </div>
        </div>

        {/* Canvas */}
        <div ref={ctrRef} style={{ flex: 1, borderRadius: 10, overflow: "hidden", background: "var(--bg-base)", border: "1px solid var(--bd-100)", position: "relative", minHeight: 400 }}>
          <canvas ref={cvRef} onClick={handleClick} onMouseMove={handleMove} onWheel={handleWheel} onMouseDown={handleMD} onMouseMoveCapture={handleMM} onMouseUp={handleMU} onMouseLeave={handleMU}
            style={{ width: "100%", height: "100%", display: "block" }} />
          {/* Floating stats */}
          <div style={{ position: "absolute", bottom: 10, left: 10, display: "flex", gap: 6, pointerEvents: "none" }}>
            <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 6, background: "var(--bg-surface)", border: "1px solid var(--bd-100)", color: "var(--tx-300)", fontFamily: "monospace" }}>
              {nodes.length} 节点
            </span>
            <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 6, background: "var(--bg-surface)", border: "1px solid var(--bd-100)", color: "var(--tx-300)", fontFamily: "monospace" }}>
              {edges.length} 关系
            </span>
            {filter && <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 6, background: "var(--bg-surface)", border: "1px solid var(--bd-100)", color: "var(--m-cyan)", fontFamily: "monospace" }}>
              {ntLabels[filter] || filter}
            </span>}
          </div>
        </div>
      </div>

      {/* Right Panel */}
      <div style={{ width: 220, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {/* Legend */}
        <div className="m-card" style={{ padding: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--tx-700)", marginBottom: 8 }}>节点类型</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {Object.entries(ntLabels).filter(([k]) => (nodeTypeStats[k] || 0) > 0).map(([k, v]) => (
              <div key={k} onClick={() => setFilter(filter === k ? "" : k)}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 6px", borderRadius: 5, cursor: "pointer", background: filter === k ? "var(--bg-hover)" : "transparent", transition: "background 0.15s", fontSize: 11 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: ntColors[k], flexShrink: 0 }} />
                <span style={{ flex: 1, color: "var(--tx-500)" }}>{v}</span>
                <span style={{ color: "var(--tx-100)", fontSize: 10, fontFamily: "monospace" }}>{nodeTypeStats[k] || 0}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Node Detail */}
        <div className="m-card" style={{ padding: 12, flex: 1, overflow: "auto" }}>
          {selNode ? (
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--tx-900)", marginBottom: 2, wordBreak: "break-all" }}>{selNode.label}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: ntColors[selNode.nodeType], flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: "var(--tx-300)" }}>{ntLabels[selNode.nodeType] || selNode.nodeType}</span>
                {selNode.group && <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 3, background: "var(--bg-hover)", color: "var(--tx-100)" }}>{selNode.group}</span>}
              </div>
              {selNode.icd10Code && <div style={{ fontSize: 10, color: "var(--tx-300)", marginBottom: 3 }}>ICD-10: <span style={{ fontFamily: "monospace", color: "var(--m-cyan)" }}>{selNode.icd10Code}</span></div>}
              {selNode.meshTerm && <div style={{ fontSize: 10, color: "var(--tx-300)", marginBottom: 3 }}>MeSH: <span style={{ fontFamily: "monospace", color: "var(--m-primary)" }}>{selNode.meshTerm}</span></div>}
              {selNode.occurrenceCount != null && <div style={{ fontSize: 10, color: "var(--tx-100)" }}>出现 {selNode.occurrenceCount} 次</div>}
              {selNode.description && <div style={{ fontSize: 10, color: "var(--tx-300)", marginTop: 6, lineHeight: 1.5 }}>{selNode.description}</div>}
              {/* Connected edges */}
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "var(--tx-400)", marginBottom: 4 }}>关联关系</div>
                {edges.filter(e => e.source === selNode.id || e.target === selNode.id).slice(0, 15).map((e, i) => {
                  const oid = e.source === selNode.id ? e.target : e.source;
                  const on = nodes.find(n => n.id === oid);
                  return (
                    <div key={i} style={{ fontSize: 10, padding: "3px 6px", borderRadius: 4, background: "var(--bg-elevated)", marginBottom: 2, display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ color: "var(--m-cyan)", flexShrink: 0 }}>{rtLabels[e.relationType] || e.relationType}</span>
                      <span style={{ color: "var(--tx-300)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{on?.label || `#${oid}`}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--tx-100)", fontSize: 11, textAlign: "center", gap: 6 }}>
              <FiInfo size={22} style={{ opacity: 0.3 }} />
              <p>点击图谱节点<br />查看详细信息</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
