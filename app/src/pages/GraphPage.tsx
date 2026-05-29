import { useState, useEffect, useRef, useCallback } from "react";
import { trpc } from "@/providers/trpc";
import { FiSearch, FiZoomIn, FiZoomOut, FiMaximize, FiActivity, FiDatabase, FiInfo, FiShare2 } from "react-icons/fi";

const ntColors: Record<string, string> = {
  disease: "#E84D4D", drug: "#2563EB", symptom: "#F07850", treatment: "#10B981",
  clinical_indicator: "#7C6FDB", anatomy: "#00C4B4", procedure: "#DB2777",
  gene: "#7C3AED", pathogen: "#B91C1C", other: "#64748B",
};
const ntLabels: Record<string, string> = {
  disease: "疾病", drug: "药物", symptom: "症状", treatment: "治疗", clinical_indicator: "指标",
  anatomy: "解剖", procedure: "手术", gene: "基因", pathogen: "病原体", other: "其他",
};
const rtLabels: Record<string, string> = {
  treats: "治疗", causes: "导致", associated_with: "相关", contraindicated: "禁忌",
  diagnoses: "诊断", prevents: "预防", symptom_of: "症状", interacts_with: "相互作用", related_to: "关联",
};

interface GNode { id: number; label: string; nodeType: string; x: number; y: number; vx: number; vy: number; description?: string | null; occurrenceCount?: number | null; icd10Code?: string | null; meshTerm?: string | null; }
interface GEdge { id: number; source: number; target: number; relationType: string; strength: number | null; }

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

  const { data: gd } = trpc.knowledge.getGraph.useQuery();
  const { data: stats } = trpc.knowledge.stats.useQuery();

  const nodes: GNode[] = (gd?.nodes ?? []).map((n) => ({ ...n, x: 300 + Math.random() * 400, y: 200 + Math.random() * 300, vx: 0, vy: 0 }));
  const edges: GEdge[] = (gd?.edges ?? []).map((e) => ({ ...e, source: e.sourceNodeId, target: e.targetNodeId }));

  useEffect(() => {
    if (!nodes.length || !cvRef.current) return;
    const cv = cvRef.current;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    let aid: number;
    const sn = [...nodes];
    const se = edges.map((e) => ({ ...e, sn: sn.find((n) => n.id === e.source)!, tn: sn.find((n) => n.id === e.target)! }));

    const sim = () => {
      for (let i = 0; i < sn.length; i++) {
        for (let j = i + 1; j < sn.length; j++) {
          const a = sn[i], b = sn[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const f = 2500 / (d * d);
          a.vx -= (dx / d) * f; a.vy -= (dy / d) * f;
          b.vx += (dx / d) * f; b.vy += (dy / d) * f;
        }
      }
      for (const e of se) {
        if (!e.sn || !e.tn) continue;
        const dx = e.tn.x - e.sn.x, dy = e.tn.y - e.sn.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - 130) * 0.003;
        e.sn.vx += (dx / d) * f; e.sn.vy += (dy / d) * f;
        e.tn.vx -= (dx / d) * f; e.tn.vy -= (dy / d) * f;
      }
      const cx = cv.width / 2, cy = cv.height / 2;
      for (const n of sn) {
        n.vx += (cx - n.x) * 0.0004; n.vy += (cy - n.y) * 0.0004;
        n.vx *= 0.88; n.vy *= 0.88;
        n.x += n.vx; n.y += n.vy;
        n.x = Math.max(30, Math.min(cv.width - 30, n.x));
        n.y = Math.max(30, Math.min(cv.height - 30, n.y));
      }
    };

    const draw = () => {
      sim();
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.save(); ctx.translate(pan.x, pan.y); ctx.scale(zoom, zoom);
      // Draw connections with glow
      for (const e of se) {
        const a = e.sn, b = e.tn;
        if (!a || !b) continue;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = `rgba(37,99,235,${0.06 + (e.strength || 0.5) * 0.1})`;
        ctx.lineWidth = 0.8 + (e.strength || 0.5) * 1.5;
        ctx.stroke();
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        ctx.font = "9px Inter,sans-serif";
        const tw = ctx.measureText(rtLabels[e.relationType] || e.relationType).width;
        ctx.fillStyle = "var(--bg-surface)"; ctx.fillRect(mx - tw / 2 - 3, my - 5, tw + 6, 10);
        ctx.fillStyle = "var(--tx-100)"; ctx.textAlign = "center"; ctx.fillText(rtLabels[e.relationType] || e.relationType, mx, my + 2);
      }
      // Draw nodes
      for (const n of sn) {
        const isSel = selNode?.id === n.id;
        const color = ntColors[n.nodeType] || "#64748B";
        const r = 7 + (n.occurrenceCount || 1) * 1.2;
        if (isSel) {
          ctx.beginPath(); ctx.arc(n.x, n.y, r + 10, 0, Math.PI * 2);
          ctx.fillStyle = `${color}12`; ctx.fill();
          ctx.beginPath(); ctx.arc(n.x, n.y, r + 6, 0, Math.PI * 2);
          ctx.strokeStyle = `${color}40`; ctx.lineWidth = 1; ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.fill();
        // Inner highlight
        ctx.beginPath(); ctx.arc(n.x - r * 0.25, n.y - r * 0.25, r * 0.4, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.2)"; ctx.fill();
        ctx.font = "10px Inter,sans-serif";
        ctx.fillStyle = "var(--tx-700)"; ctx.textAlign = "center";
        ctx.fillText(n.label, n.x, n.y + r + 13);
      }
      ctx.restore(); aid = requestAnimationFrame(draw);
    };

    const resize = () => { const c = ctrRef.current; if (c) { cv.width = c.clientWidth; cv.height = c.clientHeight; } };
    resize(); window.addEventListener("resize", resize); draw();
    return () => { cancelAnimationFrame(aid); window.removeEventListener("resize", resize); };
  }, [nodes.length, edges.length, selNode, zoom, pan, filter]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const cv = cvRef.current; if (!cv) return;
    const rect = cv.getBoundingClientRect();
    const x = (e.clientX - rect.left - pan.x) / zoom, y = (e.clientY - rect.top - pan.y) / zoom;
    for (const n of nodes) {
      const r = 7 + (n.occurrenceCount || 1) * 1.2 + 8;
      if ((x - n.x) ** 2 + (y - n.y) ** 2 < r * r) { setSelNode(n); return; }
    }
    setSelNode(null);
  }, [nodes, zoom, pan]);

  const handleWheel = useCallback((e: React.WheelEvent) => { e.preventDefault(); setZoom((z) => Math.max(0.3, Math.min(3, z * (e.deltaY > 0 ? 0.9 : 1.1)))); }, []);
  const handleMD = useCallback((e: React.MouseEvent) => { setDragging(true); setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y }); }, [pan]);
  const handleMM = useCallback((e: React.MouseEvent) => { if (!dragging) return; setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y }); }, [dragging, dragStart]);
  const handleMU = useCallback(() => setDragging(false), []);

  return (
    <div style={{ display: "flex", gap: 12, height: "100%" }}>
      {/* Canvas */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
        {/* Toolbar */}
        <div className="m-card" style={{ padding: "8px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", minWidth: 0, flexWrap: "nowrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1, flexWrap: "nowrap", overflow: "hidden" }}>
            <div style={{ position: "relative", flexShrink: 0 }}>
              <FiSearch size={12} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--tx-100)" }} />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索节点..." className="m-input" style={{ paddingLeft: 28, height: 30, fontSize: 12, width: 170 }} />
            </div>
            <select value={filter} onChange={(e) => setFilter(e.target.value)} className="m-input" style={{ height: 30, fontSize: 12, width: 110, cursor: "pointer" }}>
              <option value="">全部类型</option>{Object.entries(ntLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={() => setZoom((z) => Math.min(3, z * 1.2))} className="m-btn m-btn-ghost" style={{ width: 28, height: 28, padding: 0 }}><FiZoomIn size={13} /></button>
            <button onClick={() => setZoom((z) => Math.max(0.3, z * 0.8))} className="m-btn m-btn-ghost" style={{ width: 28, height: 28, padding: 0 }}><FiZoomOut size={13} /></button>
            <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} className="m-btn m-btn-ghost" style={{ width: 28, height: 28, padding: 0 }}><FiMaximize size={13} /></button>
          </div>
        </div>

        {/* Canvas area */}
        <div ref={ctrRef} style={{ flex: 1, borderRadius: 12, border: "1px solid var(--bd-100)", overflow: "hidden", position: "relative", background: "var(--bg-surface)", cursor: dragging ? "grabbing" : "grab", boxShadow: "var(--sh-xs)" }}>
          <canvas ref={cvRef} onClick={handleClick} onWheel={handleWheel} onMouseDown={handleMD} onMouseMove={handleMM} onMouseUp={handleMU} onMouseLeave={handleMU} style={{ width: "100%", height: "100%", display: "block" }} />
          <div className="m-glass" style={{ position: "absolute", bottom: 10, left: 10, padding: "6px 12px", borderRadius: 8, fontSize: 11, display: "flex", gap: 14 }}>
            <span><strong style={{ color: "var(--m-primary)" }}>{stats?.totalNodes ?? 0}</strong> <span style={{ color: "var(--tx-100)" }}>节点</span></span>
            <span><strong style={{ color: "var(--m-cyan)" }}>{stats?.totalEdges ?? 0}</strong> <span style={{ color: "var(--tx-100)" }}>关系</span></span>
          </div>
        </div>
      </div>

      {/* Right Panel */}
      <div style={{ width: 230, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {/* Legend */}
        <div className="m-card" style={{ padding: 12 }}>
          <h4 style={{ fontSize: 11, fontWeight: 700, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--tx-100)" }}>节点类型</h4>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {Object.entries(ntLabels).map(([t, l]) => {
              const c = stats?.nodeTypes?.[t] || 0;
              return (
                <div key={t} onClick={() => setFilter(filter === t ? "" : t)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "3px 6px", borderRadius: 6, cursor: "pointer", fontSize: 11, background: filter === t ? "rgba(37,99,235,0.06)" : "transparent", transition: "all 0.15s" }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: ntColors[t], flexShrink: 0 }} />
                  <span style={{ flex: 1, color: "var(--tx-500)" }}>{l}</span>
                  <span style={{ color: "var(--tx-100)", fontSize: 10 }}>{c}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Node Detail */}
        {selNode ? (
          <div className="m-card" style={{ padding: 12, flex: 1, overflow: "auto" }}>
            <h4 style={{ fontSize: 11, fontWeight: 700, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--tx-100)" }}>节点详情</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 11 }}>
              <div><div style={{ color: "var(--tx-100)", fontSize: 10, marginBottom: 1 }}>名称</div><div style={{ fontWeight: 700, fontSize: 13, color: "var(--tx-900)" }}>{selNode.label}</div></div>
              <div><div style={{ color: "var(--tx-100)", fontSize: 10, marginBottom: 1 }}>类型</div><div style={{ display: "flex", alignItems: "center", gap: 5 }}><div style={{ width: 7, height: 7, borderRadius: "50%", background: ntColors[selNode.nodeType] }} />{ntLabels[selNode.nodeType]}</div></div>
              {selNode.icd10Code && <div><div style={{ color: "var(--tx-100)", fontSize: 10 }}>ICD-10</div><span className="m-badge m-tag-primary" style={{ fontSize: 9 }}>{selNode.icd10Code}</span></div>}
              {selNode.meshTerm && <div><div style={{ color: "var(--tx-100)", fontSize: 10 }}>MeSH</div><div>{selNode.meshTerm}</div></div>}
              <div><div style={{ color: "var(--tx-100)", fontSize: 10 }}>频次</div><div>{selNode.occurrenceCount} 次</div></div>
              <div><div style={{ color: "var(--tx-100)", fontSize: 10, marginBottom: 4 }}>关联关系</div>
                {edges.filter((e) => e.source === selNode.id || e.target === selNode.id).map((e) => {
                  const oid = e.source === selNode.id ? e.target : e.source;
                  const on = nodes.find((n) => n.id === oid);
                  return <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 0", borderBottom: "1px solid var(--bd-100)", fontSize: 10 }}><span className="m-badge m-tag-cyan" style={{ fontSize: 8, padding: "1px 4px" }}>{rtLabels[e.relationType]}</span><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{on?.label}</span></div>;
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="m-card" style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--tx-100)", fontSize: 11, textAlign: "center", gap: 6 }}><FiInfo size={22} /><p>点击图谱节点<br />查看详细信息</p></div>
        )}
      </div>
    </div>
  );
}
