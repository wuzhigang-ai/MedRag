import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { FiSearch, FiGrid, FiList, FiEye, FiRotateCw, FiTrash2, FiDownload, FiFileText, FiCheckCircle, FiBook, FiImage, FiDatabase, FiChevronLeft, FiChevronRight, FiFilter } from "react-icons/fi";

type AStatus = "pending" | "parsing" | "parsed" | "reviewing" | "approved" | "rejected" | "error";
const sc: Record<AStatus, { label: string; cls: string }> = {
  pending: { label: "待解析", cls: "m-status-pending" },
  parsing: { label: "解析中", cls: "m-status-parsing" },
  parsed: { label: "已解析", cls: "m-status-parsed" },
  reviewing: { label: "审核中", cls: "m-status-pending" },
  approved: { label: "已入库", cls: "m-status-approved" },
  rejected: { label: "已驳回", cls: "m-status-error" },
  error: { label: "异常", cls: "m-status-error" },
};

export default function LibraryPage() {
  const [view, setView] = useState<"list" | "card">("list");
  const [search, setSearch] = useState("");
  const [statusF, setStatusF] = useState("");
  const [typeF, setTypeF] = useState("");
  const [selId, setSelId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const ps = 6;

  const utils = trpc.useUtils();
  const { data: articles, isLoading } = trpc.articles.list.useQuery({ search: search || undefined, status: statusF || undefined, articleType: typeF || undefined });
  const { data: stats } = trpc.articles.stats.useQuery();
  const del = trpc.articles.delete.useMutation({ onSuccess: () => { utils.articles.list.invalidate(); utils.articles.stats.invalidate(); } });

  const tp = Math.ceil((articles?.length ?? 0) / ps);
  const pa = articles?.slice((page - 1) * ps, page * ps);
  const sel = articles?.find((a) => a.id === selId);

  return (
    <div style={{ display: "flex", gap: 14, height: "100%" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
        {/* Header */}
        <div className="m-card" style={{ padding: "12px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 12 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--tx-900)", flexShrink: 0, whiteSpace: "nowrap" }}>文献库管理</h3>
            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
              <button onClick={() => setView("list")} title="列表视图" style={{ width: 38, height: 38, borderRadius: 9, border: `1.5px solid ${view === "list" ? "var(--m-primary)" : "var(--bd-200)"}`, background: view === "list" ? "rgba(37,99,235,0.06)" : "var(--bg-elevated)", color: view === "list" ? "var(--m-primary)" : "var(--tx-300)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all 0.2s", flexShrink: 0, overflow: "visible" }}>
                <span style={{ display: "flex", alignItems: "center", justifyContent: "center" }}><FiList size={18} /></span>
              </button>
              <button onClick={() => setView("card")} title="卡片视图" style={{ width: 38, height: 38, borderRadius: 9, border: `1.5px solid ${view === "card" ? "var(--m-primary)" : "var(--bd-200)"}`, background: view === "card" ? "rgba(37,99,235,0.06)" : "var(--bg-elevated)", color: view === "card" ? "var(--m-primary)" : "var(--tx-300)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all 0.2s", flexShrink: 0, overflow: "visible" }}>
                <span style={{ display: "flex", alignItems: "center", justifyContent: "center" }}><FiGrid size={18} /></span>
              </button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div style={{ position: "relative", flex: 1, minWidth: 180 }}>
              <FiSearch size={13} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--tx-100)" }} />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索文献..." className="m-input" style={{ paddingLeft: 34, fontSize: 12, height: 32 }} />
            </div>
            <select value={statusF} onChange={(e) => setStatusF(e.target.value)} className="m-input" style={{ width: 110, fontSize: 12, height: 32, cursor: "pointer" }}>
              <option value="">全部状态</option><option value="pending">待解析</option><option value="parsed">已解析</option><option value="approved">已入库</option>
            </select>
            <select value={typeF} onChange={(e) => setTypeF(e.target.value)} className="m-input" style={{ width: 110, fontSize: 12, height: 32, cursor: "pointer" }}>
              <option value="">全部类型</option><option value="clinical_trial">临床试验</option><option value="meta_analysis">Meta分析</option><option value="guideline">指南</option>
            </select>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          {[{l:"文献总量",v:stats?.total??0,i:<FiBook size={15}/>,c:"var(--m-primary)"},{l:"已入库",v:stats?.approved??0,i:<FiCheckCircle size={15}/>,c:"var(--m-green)"},{l:"解析完成",v:stats?.parsed??0,i:<FiImage size={15}/>,c:"var(--m-cyan)"},{l:"知识节点",v:stats?.inKb??0,i:<FiDatabase size={15}/>,c:"var(--m-gold)"}].map((s,i)=>(
            <div key={i} className="m-card" style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
              <div className="m-icon-box" style={{ width: 34, height: 34, background: `${s.c}10`, color: s.c, borderRadius: 9 }}>{s.i}</div>
              <div><div style={{ fontSize: 18, fontWeight: 700, color: "var(--tx-900)" }}>{s.v}</div><div style={{ fontSize: 10, color: "var(--tx-100)" }}>{s.l}</div></div>
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="m-card" style={{ flex: 1, overflow: "auto", padding: 14 }}>
          {isLoading ? <div style={{ textAlign: "center", color: "var(--tx-100)", padding: 40, fontSize: 13 }}>加载中...</div> : view === "list" ? (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr style={{ borderBottom: "1.5px solid var(--bd-200)" }}>
                {["文献名称","类型","状态","科室","文本块","操作"].map((h) => <th key={h} style={{ textAlign: "left", padding: "8px 10px", fontWeight: 700, color: "var(--tx-300)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>)}
              </tr></thead>
              <tbody>{pa?.map((a) => (
                <tr key={a.id} onClick={() => setSelId(a.id)} style={{ borderBottom: "1px solid var(--bd-100)", cursor: "pointer", background: selId === a.id ? "rgba(37,99,235,0.03)" : "transparent", transition: "background 0.15s" }} onMouseEnter={(e) => { if (selId !== a.id) e.currentTarget.style.background = "var(--bg-hover)"; }} onMouseLeave={(e) => { if (selId !== a.id) e.currentTarget.style.background = "transparent"; }}>
                  <td style={{ padding: "8px 10px" }}><div style={{ fontWeight: 600, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</div><div style={{ fontSize: 10, color: "var(--tx-100)", marginTop: 1 }}>{a.journal}</div></td>
                  <td style={{ padding: "8px 10px" }}><span style={{ fontSize: 10, color: "var(--tx-100)" }}>{a.articleType === "clinical_trial" ? "临床" : a.articleType === "meta_analysis" ? "Meta" : "指南"}</span></td>
                  <td style={{ padding: "8px 10px" }}><span className={`m-badge ${sc[a.status as AStatus]?.cls || ""}`} style={{ fontSize: 9, padding: "1px 6px" }}>{sc[a.status as AStatus]?.label}</span></td>
                  <td style={{ padding: "8px 10px", color: "var(--tx-300)", fontSize: 11 }}>{a.department}</td>
                  <td style={{ padding: "8px 10px" }}><span className="m-badge m-tag-primary" style={{ fontSize: 9 }}>{a.textSegmentsCount}</span></td>
                  <td style={{ padding: "8px 10px" }}><div style={{ display: "flex", gap: 3 }} onClick={(e) => e.stopPropagation()}>
                    <button className="m-btn m-btn-ghost m-btn-sm" style={{ padding: "2px 5px" }}><FiEye size={12} /></button>
                    <button className="m-btn m-btn-ghost m-btn-sm" style={{ padding: "2px 5px", color: "var(--m-orange)" }}><FiRotateCw size={12} /></button>
                    <button onClick={() => del.mutate({ id: a.id })} className="m-btn m-btn-ghost m-btn-sm" style={{ padding: "2px 5px", color: "var(--m-red)" }}><FiTrash2 size={12} /></button>
                  </div></td>
                </tr>
              ))}</tbody>
            </table>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 12 }}>
              {pa?.map((a) => (
                <div key={a.id} onClick={() => setSelId(a.id)} style={{ padding: 14, borderRadius: 12, border: `1.5px solid ${selId === a.id ? "rgba(37,99,235,0.2)" : "var(--bd-100)"}`, background: selId === a.id ? "rgba(37,99,235,0.03)" : "var(--bg-surface)", cursor: "pointer", transition: "all 0.2s" }}>
                  <div style={{ height: 80, borderRadius: 8, background: "var(--bg-hover)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--tx-100)", marginBottom: 10 }}><FiFileText size={30} /></div>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{a.title}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span className={`m-badge ${sc[a.status as AStatus]?.cls || ""}`} style={{ fontSize: 9 }}>{sc[a.status as AStatus]?.label}</span>
                    <span style={{ fontSize: 10, color: "var(--tx-100)" }}>{a.department}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {tp > 1 && <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 6, marginTop: 12 }}>
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="m-btn m-btn-ghost m-btn-sm" style={{ padding: "2px 8px" }}><FiChevronLeft size={12} /></button>
            <span style={{ fontSize: 12, color: "var(--tx-300)", minWidth: 50, textAlign: "center" }}>{page} / {tp}</span>
            <button onClick={() => setPage((p) => Math.min(tp, p + 1))} disabled={page === tp} className="m-btn m-btn-ghost m-btn-sm" style={{ padding: "2px 8px" }}><FiChevronRight size={12} /></button>
          </div>}
        </div>
      </div>

      {/* Detail Panel */}
      {sel && (
        <div style={{ width: 280, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="m-card" style={{ padding: 14, flex: 1, overflow: "auto" }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, lineHeight: 1.4, color: "var(--tx-900)" }}>{sel.title}</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 11 }}>
              {[{l:"状态",v:<span className={`m-badge ${sc[sel.status as AStatus]?.cls || ""}`} style={{ fontSize: 9 }}>{sc[sel.status as AStatus]?.label}</span>},{l:"作者",v:(sel.authors as string[] || []).join(", ")},{l:"期刊",v:sel.journal},{l:"发表",v:sel.publishDate},{l:"DOI",v:sel.doi},{l:"大小",v:sel.fileSize?`${(sel.fileSize/1024/1024).toFixed(1)}MB`:"-"}].map((item,i)=>(
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid var(--bd-100)" }}>
                  <span style={{ color: "var(--tx-100)", fontSize: 10 }}>{item.l}</span>
                  <span style={{ color: "var(--tx-500)", textAlign: "right", maxWidth: 160, wordBreak: "break-all" }}>{item.v}</span>
                </div>
              ))}
              <div style={{ padding: "5px 0" }}>
                <span style={{ color: "var(--tx-100)", fontSize: 10, display: "block", marginBottom: 4 }}>关键词</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>{((sel.keywords as string[] | null) || []).map((kw,i)=><span key={i} className="m-badge m-tag-primary" style={{ fontSize: 9, padding: "1px 5px" }}>{kw}</span>)}</div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginTop: 4 }}>
                {[{v:sel.textSegmentsCount,c:"var(--m-primary)",l:"文本块"},{v:sel.figuresCount,c:"var(--m-cyan)",l:"图表"},{v:sel.knowledgeNodesCount,c:"var(--m-gold)",l:"节点"}].map((s,i)=>(
                  <div key={i} style={{ textAlign: "center", padding: "8px 4px", background: "var(--bg-hover)", borderRadius: 8 }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: s.c }}>{s.v}</div>
                    <div style={{ fontSize: 9, color: "var(--tx-100)", marginTop: 1 }}>{s.l}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
              <button className="m-btn m-btn-primary m-btn-sm" style={{ width: "100%" }}><FiDownload size={12} />导出结构化数据</button>
              <button className="m-btn m-btn-secondary m-btn-sm" style={{ width: "100%" }}><FiRotateCw size={12} />重新解析</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
