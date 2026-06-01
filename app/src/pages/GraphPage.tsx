/**
 * GraphPage — 医学知识图谱 · 多类型配色 · 双主题自适应 · 力导向布局
 *
 * Features:
 * - Type-colored nodes matching G6 palette (13 medical categories)
 * - Interactive legend with click-to-filter + count badges
 * - Rich node detail panel with relation navigation
 * - Search + type filter with visual feedback
 * - Zoom / Fit / Export controls
 * - Loading / Error / Empty state coverage
 * - Keyboard shortcut panel (toggleable)
 * - Fullscreen-ready layout
 */
import { useState, useCallback, useRef } from "react";
import { trpc } from "@/providers/trpc";
import {
  FiSearch, FiZoomIn, FiZoomOut, FiMaximize, FiDownload,
  FiFilter, FiSliders, FiInfo, FiX, FiRefreshCw, FiBarChart2, FiCrosshair,
} from "react-icons/fi";
import G6GraphView from "@/components/G6GraphView";
import type { Graph } from "@antv/g6";

// ═══ Node type → display color (matches G6GraphView NC palette) ═══
const ntColors: Record<string, string> = {
  disease: "#DD0000", drug: "#0055DD", symptom: "#DD4400",
  treatment: "#00AA44", clinical_indicator: "#6600DD", anatomy: "#0099AA",
  procedure: "#DD0077", gene: "#5500DD", pathogen: "#CC0000",
  guideline: "#BB9900", other: "#667788", check: "#7722DD",
  exam: "#7722DD", metric: "#0055DD",
};

const ntLabels: Record<string, string> = {
  disease: "疾病", drug: "药物", symptom: "症状", treatment: "治疗",
  clinical_indicator: "指标", anatomy: "解剖", procedure: "手术",
  gene: "基因", pathogen: "病原体", other: "其他", check: "检查",
  exam: "检查", metric: "指标", guideline: "指南",
};

const rtLabels: Record<string, string> = {
  treats: "治疗", causes: "导致", associated_with: "相关",
  contraindicated: "禁忌", diagnoses: "诊断", prevents: "预防",
  symptom_of: "症状", interacts_with: "相互作用", related_to: "关联",
};

// Edge type → display color for relation badges
const rtColors: Record<string, string> = {
  treats: "#55DD88", causes: "#EE6666", associated_with: "#5599EE",
  contraindicated: "#EE8844", diagnoses: "#9966EE", prevents: "#55CCDD",
  symptom_of: "#EE8844", interacts_with: "#EE66AA", related_to: "#8899AA",
};

export default function GraphPage() {
  const { data: gd, isLoading, error, refetch } = trpc.knowledge.getGraph.useQuery();
  const graphRef = useRef<Graph | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [selNode, setSelNode] = useState<any>(null);
  const [showPanel, setShowPanel] = useState(false);
  const [showStats, setShowStats] = useState(false);

  const rawNodes = (gd?.nodes ?? []).map((n: any) => ({
    ...n, id: n.id ?? Math.random(),
    label: n.label ?? "?",
    group: n.group ?? n.nodeType ?? "other",
  }));
  const rawEdges = (gd?.edges ?? []).map((e: any) => ({
    ...e,
    source: e.sourceNodeId ?? e.source ?? 0,
    target: e.targetNodeId ?? e.target ?? 0,
  }));

  // ── Stats ──
  const nodeTypeStats: Record<string, number> = {};
  rawNodes.forEach((n: any) => { const g = n.group || n.nodeType; nodeTypeStats[g] = (nodeTypeStats[g] || 0) + 1; });
  const edgeTypeStats: Record<string, number> = {};
  rawEdges.forEach((e: any) => { const r = e.relationType || "related_to"; edgeTypeStats[r] = (edgeTypeStats[r] || 0) + 1; });

  // Sort node types by count desc
  const sortedNodeTypes = Object.entries(ntLabels)
    .filter(([k]) => (nodeTypeStats[k] || 0) > 0)
    .sort(([, a], [, b]) => (nodeTypeStats[b] || 0) - (nodeTypeStats[a] || 0));

  const handleGraphReady = useCallback((g: Graph) => { graphRef.current = g; }, []);

  // ── Zoom / View controls ──
  const zoomIn = () => { try { const g = graphRef.current; if (g) g.zoomTo((g.getZoom() || 1) * 1.35); } catch { /* ok */ } };
  const zoomOut = () => { try { const g = graphRef.current; if (g) g.zoomTo((g.getZoom() || 1) / 1.35); } catch { /* ok */ } };
  const resetView = () => { try { graphRef.current?.fitView({ padding: 80 }); } catch { /* ok */ } };
  const focusNode = () => {
    try {
      const g = graphRef.current;
      if (g && selNode) {
        g.focusItem(String(selNode.id), { duration: 500, easing: "easeCubic" });
      }
    } catch { /* ok */ }
  };

  // ── Export ──
  const exportPNG = useCallback(async () => {
    try {
      const g = graphRef.current;
      if (!g) return;
      const d = document.documentElement.getAttribute("data-theme");
      const url = await g.toDataURL({
        type: "image/png",
        backgroundColor: d === "dark" ? "#080E1A" : "#F0F4F8",
      });
      const a = document.createElement("a");
      a.download = `medrag-graph-${rawNodes.length}n-${rawEdges.length}e.png`;
      a.href = url;
      a.click();
    } catch { /* ok */ }
  }, [rawNodes.length, rawEdges.length]);

  // ── Connected edges for selected node ──
  const connectedEdges = selNode
    ? rawEdges.filter((e: any) => String(e.source) === String(selNode.id) || String(e.target) === String(selNode.id))
    : [];
  const neighborNodes = selNode
    ? connectedEdges.map((e: any) => {
        const oid = String(e.source) === String(selNode.id) ? e.target : e.source;
        return rawNodes.find((n: any) => String(n.id) === String(oid));
      }).filter(Boolean)
    : [];

  return (
    <div style={{ display: "flex", gap: 12, height: "100%" }}>
      {/* ═══ Main area ═══ */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
        {/* ── Toolbar ── */}
        <div className="m-card" style={{
          padding: "6px 12px", display: "flex", alignItems: "center", gap: 8,
          flexWrap: "wrap", flexShrink: 0,
        }}>
          {/* Search */}
          <div style={{ position: "relative", flexShrink: 0 }}>
            <FiSearch size={12} style={{
              position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
              color: "var(--tx-100)", zIndex: 1, pointerEvents: "none",
            }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索医学实体…"
              className="m-input"
              style={{ paddingLeft: 28, height: 30, fontSize: 11, width: 180, borderRadius: 8 }}
            />
            {search && (
              <FiX size={12} onClick={() => setSearch("")} style={{
                position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                cursor: "pointer", color: "var(--tx-200)",
              }} />
            )}
          </div>

          {/* Type filter */}
          <select
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="m-input"
            style={{ height: 30, fontSize: 11, width: 100, cursor: "pointer", borderRadius: 8 }}
          >
            <option value="">全部类型</option>
            {sortedNodeTypes.map(([k, v]) => (
              <option key={k} value={k}>{v} ({nodeTypeStats[k] || 0})</option>
            ))}
          </select>
          {filter && (
            <span
              onClick={() => setFilter("")}
              style={{ fontSize: 10, color: "var(--m-cyan)", cursor: "pointer", whiteSpace: "nowrap" }}
            >
              清除筛选
            </span>
          )}

          <div style={{ flex: 1 }} />

          {/* Stats badge */}
          <span style={{
            fontSize: 10, color: "var(--tx-200)", whiteSpace: "nowrap",
            background: "var(--bg-hover)", padding: "2px 8px", borderRadius: 6,
          }}>
            {rawNodes.length} 节点 · {rawEdges.length} 关系
          </span>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 3 }}>
            <button onClick={zoomIn} className="m-btn m-btn-ghost" style={{ width: 28, height: 28, padding: 0, borderRadius: 8 }} title="放大 (滚轮)">
              <FiZoomIn size={13} />
            </button>
            <button onClick={zoomOut} className="m-btn m-btn-ghost" style={{ width: 28, height: 28, padding: 0, borderRadius: 8 }} title="缩小 (滚轮)">
              <FiZoomOut size={13} />
            </button>
            <button onClick={resetView} className="m-btn m-btn-ghost" style={{ width: 28, height: 28, padding: 0, borderRadius: 8 }} title="重置视图 (F键)">
              <FiMaximize size={13} />
            </button>
            {selNode && (
              <button onClick={focusNode} className="m-btn m-btn-ghost" style={{ width: 28, height: 28, padding: 0, borderRadius: 8 }} title="聚焦选中节点">
                <FiCrosshair size={13} />
              </button>
            )}
            <button onClick={exportPNG} className="m-btn m-btn-ghost" style={{ width: 28, height: 28, padding: 0, borderRadius: 8 }} title="导出PNG">
              <FiDownload size={13} />
            </button>
            <button
              onClick={() => setShowPanel(!showPanel)}
              className="m-btn m-btn-ghost"
              style={{
                width: 28, height: 28, padding: 0, borderRadius: 8,
                background: showPanel ? "var(--m-cyan)18" : "",
                color: showPanel ? "var(--m-cyan)" : "",
              }}
              title="快捷键面板"
            >
              <FiSliders size={13} />
            </button>
          </div>
        </div>

        {/* ── Graph Canvas ── */}
        <div style={{
          flex: 1, borderRadius: 12, overflow: "hidden",
          background: "var(--bg-base)",
          border: "1px solid var(--bd-100)",
          position: "relative", minHeight: 450,
        }}>
          {isLoading ? (
            <div style={{
              height: "100%", display: "flex", alignItems: "center",
              justifyContent: "center", flexDirection: "column", gap: 12,
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: "50%",
                border: "2px solid var(--bd-200)", borderTopColor: "var(--m-cyan)",
                animation: "spin 1s linear infinite",
              }} />
              <p style={{ fontSize: 12, color: "var(--tx-300)" }}>正在加载知识图谱…</p>
            </div>
          ) : error ? (
            <div style={{
              height: "100%", display: "flex", alignItems: "center",
              justifyContent: "center", flexDirection: "column", gap: 12,
            }}>
              <FiInfo size={28} style={{ color: "var(--m-red)", opacity: 0.5 }} />
              <p style={{ fontSize: 12, color: "var(--tx-300)" }}>图谱数据加载失败</p>
              <button onClick={() => refetch()} className="m-btn m-btn-ghost" style={{ fontSize: 11 }}>
                <FiRefreshCw size={11} style={{ marginRight: 4 }} />重试
              </button>
            </div>
          ) : !rawNodes.length ? (
            <div style={{
              height: "100%", display: "flex", alignItems: "center",
              justifyContent: "center", flexDirection: "column", gap: 12,
            }}>
              <div style={{
                width: 48, height: 48, borderRadius: 14,
                background: "var(--bg-elevated)",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "var(--tx-100)",
              }}>
                <FiFilter size={20} />
              </div>
              <p style={{ fontSize: 13, fontWeight: 600, color: "var(--tx-500)" }}>暂无知识图谱数据</p>
              <p style={{ fontSize: 11, color: "var(--tx-200)" }}>上传医学文献并完成解析后，系统将自动构建知识图谱</p>
            </div>
          ) : (
            <>
              <G6GraphView
                nodes={rawNodes}
                edges={rawEdges}
                search={search}
                filter={filter}
                onNodeClick={setSelNode}
                onReady={handleGraphReady}
              />
              {/* Keyboard shortcuts overlay */}
              {showPanel && (
                <div style={{
                  position: "absolute", top: 10, right: 10,
                  background: "var(--bg-surface)dd", backdropFilter: "blur(12px)",
                  border: "1px solid var(--bd-100)", borderRadius: 8,
                  padding: "10px 14px", zIndex: 10, fontSize: 10,
                  color: "var(--tx-300)", lineHeight: 2,
                }}>
                  <div style={{ fontWeight: 700, marginBottom: 4, color: "var(--tx-500)", fontSize: 11 }}>快捷键</div>
                  <div><b style={{ color: "var(--m-cyan)" }}>F</b> 重置视图</div>
                  <div><b style={{ color: "var(--m-cyan)" }}>Esc</b> 取消选中</div>
                  <div><b style={{ color: "var(--m-cyan)" }}>滚轮</b> 缩放画布</div>
                  <div><b style={{ color: "var(--m-cyan)" }}>拖拽</b> 平移画布</div>
                  <div><b style={{ color: "var(--m-cyan)" }}>拖拽节点</b> 调整位置</div>
                  <div><b style={{ color: "var(--m-cyan)" }}>悬停节点</b> 预览详情</div>
                  <div><b style={{ color: "var(--m-cyan)" }}>点击节点</b> 查看完整信息</div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ═══ Right Sidebar ═══ */}
      <div style={{ width: 240, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10, overflow: "auto" }}>
        {/* ── Stats toggle ── */}
        <div style={{ display: "flex", gap: 4 }}>
          <button
            onClick={() => setShowStats(false)}
            className="m-btn m-btn-ghost"
            style={{
              flex: 1, fontSize: 10, padding: "4px 8px", borderRadius: 8,
              background: !showStats ? "var(--bg-hover)" : "transparent",
              color: !showStats ? "var(--tx-700)" : "var(--tx-200)",
              fontWeight: !showStats ? 600 : 400,
            }}
          >
            图例
          </button>
          <button
            onClick={() => setShowStats(true)}
            className="m-btn m-btn-ghost"
            style={{
              flex: 1, fontSize: 10, padding: "4px 8px", borderRadius: 8,
              background: showStats ? "var(--bg-hover)" : "transparent",
              color: showStats ? "var(--tx-700)" : "var(--tx-200)",
              fontWeight: showStats ? 600 : 400,
            }}
          >
            <FiBarChart2 size={10} style={{ marginRight: 2 }} />统计
          </button>
        </div>

        {showStats ? (
          /* ── Statistics Panel ── */
          <div className="m-card" style={{ padding: 10, borderRadius: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--tx-500)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              图谱统计
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
              <div style={{ background: "var(--bg-elevated)", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--m-primary)" }}>{rawNodes.length}</div>
                <div style={{ fontSize: 9, color: "var(--tx-300)" }}>实体节点</div>
              </div>
              <div style={{ background: "var(--bg-elevated)", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--m-green)" }}>{rawEdges.length}</div>
                <div style={{ fontSize: 9, color: "var(--tx-300)" }}>关系边</div>
              </div>
              <div style={{ background: "var(--bg-elevated)", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--m-cyan)" }}>{Object.keys(nodeTypeStats).length}</div>
                <div style={{ fontSize: 9, color: "var(--tx-300)" }}>实体类型</div>
              </div>
              <div style={{ background: "var(--bg-elevated)", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--m-orange)" }}>{Object.keys(edgeTypeStats).length}</div>
                <div style={{ fontSize: 9, color: "var(--tx-300)" }}>关系类型</div>
              </div>
            </div>
            {/* Type distribution bars */}
            <div style={{ fontSize: 9, fontWeight: 600, color: "var(--tx-400)", marginBottom: 4 }}>
              实体类型分布
            </div>
            {sortedNodeTypes.slice(0, 8).map(([k, v]) => {
              const pct = rawNodes.length > 0 ? ((nodeTypeStats[k] || 0) / rawNodes.length * 100) : 0;
              return (
                <div key={k} style={{ marginBottom: 3, display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: ntColors[k] || "#64748B", flexShrink: 0 }} />
                  <span style={{ fontSize: 9, color: "var(--tx-500)", width: 32, flexShrink: 0 }}>{v}</span>
                  <div style={{ flex: 1, height: 4, borderRadius: 2, background: "var(--bg-hover)", overflow: "hidden" }}>
                    <div style={{ height: "100%", borderRadius: 2, background: ntColors[k] || "#64748B", width: `${Math.max(pct, 2)}%`, transition: "width 0.5s ease" }} />
                  </div>
                  <span style={{ fontSize: 8, color: "var(--tx-200)", width: 20, textAlign: "right", flexShrink: 0 }}>{Math.round(pct)}%</span>
                </div>
              );
            })}
          </div>
        ) : (
          /* ── Legend Panel ── */
          <div className="m-card" style={{ padding: 10, borderRadius: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--tx-500)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              节点类型 · 图例
            </div>
            <div style={{ fontSize: 9, color: "var(--tx-200)", marginBottom: 6 }}>
              点击类型筛选图谱
            </div>
            {sortedNodeTypes.map(([k, v]) => (
              <div
                key={k}
                onClick={() => setFilter(filter === k ? "" : k)}
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "4px 8px",
                  borderRadius: 6, cursor: "pointer",
                  background: filter === k ? "var(--bg-hover)" : "transparent",
                  fontSize: 10, transition: "all 0.15s",
                }}
              >
                <div style={{
                  width: 10, height: 10, borderRadius: "50%",
                  background: ntColors[k] || "#64748B",
                  boxShadow: filter === k ? `0 0 8px ${ntColors[k]}40` : "none",
                  flexShrink: 0,
                  transition: "box-shadow 0.2s",
                }} />
                <span style={{ flex: 1, color: filter === k ? "var(--tx-700)" : "var(--tx-500)", fontWeight: filter === k ? 600 : 400 }}>
                  {v}
                </span>
                <span style={{ color: "var(--tx-200)", fontSize: 9, fontFamily: "monospace" }}>
                  {nodeTypeStats[k] || 0}
                </span>
              </div>
            ))}
            {sortedNodeTypes.length === 0 && (
              <div style={{ fontSize: 10, color: "var(--tx-200)", textAlign: "center", padding: 12 }}>
                暂无节点数据
              </div>
            )}
          </div>
        )}

        {/* ── Node Detail Panel ── */}
        {selNode ? (
          <div className="m-card" style={{ padding: 10, borderRadius: 12, animation: "fadeIn 0.25s ease" }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--tx-900)", wordBreak: "break-all", flex: 1 }}>
                {selNode.label}
              </div>
              <FiX
                size={14}
                style={{ cursor: "pointer", color: "var(--tx-200)", flexShrink: 0, marginLeft: 4 }}
                onClick={() => setSelNode(null)}
              />
            </div>

            {/* Type + Weight badges */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "2px 8px", borderRadius: 6,
                background: `${ntColors[selNode.group || selNode.nodeType] || "#64748B"}18`,
                border: `1px solid ${ntColors[selNode.group || selNode.nodeType] || "#64748B"}30`,
              }}>
                <div style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: ntColors[selNode.group || selNode.nodeType] || "#64748B",
                }} />
                <span style={{ fontSize: 9, color: "var(--tx-300)" }}>
                  {ntLabels[selNode.group || selNode.nodeType] || selNode.group || selNode.nodeType || "其他"}
                </span>
              </div>
              {selNode.weight > 0 && (
                <span style={{ fontSize: 9, color: "var(--tx-200)", background: "var(--bg-hover)", padding: "2px 6px", borderRadius: 6 }}>
                  {selNode.weight} 关联
                </span>
              )}
              <span style={{ fontSize: 9, color: "var(--tx-200)", background: "var(--bg-hover)", padding: "2px 6px", borderRadius: 6 }}>
                {connectedEdges.length} 条关系
              </span>
            </div>

            {/* Description */}
            {selNode.description && (
              <div style={{
                fontSize: 10, color: "var(--tx-300)", lineHeight: 1.6,
                marginBottom: 8, padding: "8px 10px", borderRadius: 8,
                background: "var(--bg-base)", border: "1px solid var(--bd-100)",
              }}>
                {selNode.description}
              </div>
            )}

            {/* Connected relations */}
            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: "var(--tx-400)", marginBottom: 4 }}>
                关联关系 ({connectedEdges.length})
              </div>
              {connectedEdges.slice(0, 20).map((e: any, i: number) => {
                const oid = String(e.source) === String(selNode.id) ? e.target : e.source;
                const on = rawNodes.find((n: any) => String(n.id) === String(oid));
                const rt = e.relationType || "related_to";
                const isSource = String(e.source) === String(selNode.id);
                return (
                  <div
                    key={i}
                    onClick={() => { const n = rawNodes.find((x: any) => String(x.id) === String(oid)); if (n) setSelNode(n); }}
                    style={{
                      fontSize: 9, padding: "4px 8px", borderRadius: 6,
                      background: "var(--bg-elevated)", marginBottom: 2,
                      display: "flex", alignItems: "center", gap: 4,
                      cursor: "pointer", transition: "background 0.15s",
                    }}
                    onMouseEnter={e => { (e.target as HTMLElement).style.background = "var(--bg-hover)"; }}
                    onMouseLeave={e => { (e.target as HTMLElement).style.background = "var(--bg-elevated)"; }}
                    title={on?.label || ""}
                  >
                    {/* Direction indicator */}
                    <span style={{ fontSize: 7, color: "var(--tx-100)", flexShrink: 0 }}>
                      {isSource ? "→" : "←"}
                    </span>
                    {/* Relation type badge */}
                    <span style={{
                      color: rtColors[rt] || "#64748B",
                      flexShrink: 0, fontSize: 8, fontWeight: 600,
                      background: `${rtColors[rt] || "#64748B"}15`,
                      padding: "1px 4px", borderRadius: 3,
                    }}>
                      {rtLabels[rt] || rt}
                    </span>
                    {/* Target node name */}
                    <span style={{
                      color: "var(--tx-500)", overflow: "hidden",
                      textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
                    }}>
                      {on?.label || `#${String(oid).slice(0, 8)}`}
                    </span>
                  </div>
                );
              })}
              {connectedEdges.length === 0 && (
                <div style={{ fontSize: 9, color: "var(--tx-200)", textAlign: "center", padding: 10 }}>
                  暂无关联关系
                </div>
              )}
              {connectedEdges.length > 20 && (
                <div style={{ fontSize: 9, color: "var(--tx-200)", textAlign: "center", padding: 4 }}>
                  …还有 {connectedEdges.length - 20} 条关系
                </div>
              )}
            </div>

            {/* Actions */}
            <div style={{ marginTop: 8, display: "flex", gap: 4 }}>
              <button onClick={focusNode} className="m-btn m-btn-ghost" style={{ flex: 1, fontSize: 10, padding: "4px 8px", borderRadius: 6 }}>
                <FiCrosshair size={10} style={{ marginRight: 3 }} />聚焦
              </button>
              <button onClick={() => setSelNode(null)} className="m-btn m-btn-ghost" style={{ flex: 1, fontSize: 10, padding: "4px 8px", borderRadius: 6 }}>
                取消选中
              </button>
            </div>
          </div>
        ) : (
          /* ── Empty state ── */
          <div className="m-card" style={{
            padding: 14, textAlign: "center", color: "var(--tx-200)",
            fontSize: 10, borderRadius: 12,
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: 12,
              background: "var(--bg-elevated)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 10",
            }}>
              <FiInfo size={18} style={{ opacity: 0.4 }} />
            </div>
            <p style={{ lineHeight: 1.6 }}>
              点击图谱中的节点<br />查看实体详细信息
            </p>
            <p style={{ fontSize: 9, color: "var(--tx-100)", marginTop: 6 }}>
              按 <b style={{ color: "var(--m-cyan)" }}>F</b> 重置视图 · 按 <b style={{ color: "var(--m-cyan)" }}>Esc</b> 取消选中
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
