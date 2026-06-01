import { useState, useRef, useCallback, useEffect } from "react";
import { trpc } from "@/providers/trpc";
import { useToast } from "@/providers/toast";
import { ConfirmDialog } from "./AdminLayout";
import { api } from "@/lib/api";
import {
  FiUpload, FiFileText, FiCheckCircle, FiXCircle, FiRotateCw,
  FiSettings, FiDatabase, FiChevronDown, FiChevronRight,
  FiLayers, FiImage, FiTag, FiClock, FiAlertCircle,
  FiTrash2, FiEye, FiPlus, FiCheck, FiTrendingUp,
  FiHardDrive, FiCpu, FiShield, FiSearch, FiFilter,
  FiMoreHorizontal, FiArrowRight, FiActivity, FiBox
} from "react-icons/fi";

type ArticleStatus = "pending" | "parsing" | "parsed" | "reviewing" | "approved" | "rejected" | "error";

const statusConfig: Record<ArticleStatus, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  pending:   { label: "待解析", color: "#D97706", bg: "rgba(217,119,6,0.08)", icon: <FiClock size={10} /> },
  parsing:   { label: "解析中", color: "#00C4B4", bg: "rgba(0,196,180,0.08)", icon: <FiActivity size={10} /> },
  parsed:    { label: "已解析", color: "#2563EB", bg: "rgba(37,99,235,0.08)", icon: <FiCheckCircle size={10} /> },
  reviewing: { label: "审核中", color: "#D97706", bg: "rgba(217,119,6,0.08)", icon: <FiShield size={10} /> },
  approved:  { label: "已入库", color: "#10B981", bg: "rgba(16,185,129,0.08)", icon: <FiDatabase size={10} /> },
  rejected:  { label: "已驳回", color: "#E84D4D", bg: "rgba(232,77,77,0.08)", icon: <FiXCircle size={10} /> },
  error:     { label: "异常",   color: "#E84D4D", bg: "rgba(232,77,77,0.08)", icon: <FiAlertCircle size={10} /> },
};

const segLabels: Record<string, string> = {
  abstract: "摘要", introduction: "引言", methods: "方法",
  results_primary: "主要结局", results_secondary: "次要结局",
  subgroup_analysis: "亚组分析", sensitivity_analysis: "敏感性分析",
  discussion: "讨论", conclusion: "结论", references: "参考文献", other: "其他",
};
const segColors: Record<string, string> = {
  abstract: "#2563EB", introduction: "#0891B2", methods: "#D97706",
  results_primary: "#059669", results_secondary: "#7C6FDB",
  subgroup_analysis: "#E07BA2", sensitivity_analysis: "#3B9AD9",
  discussion: "#D97706", conclusion: "#059669", references: "#9CA3AF", other: "#6B7280",
};

// Real pipeline phases matching upload_tasks status flow
const flowPhases = [
  { label: "MinerU 2.5-Pro 识别中", icon: <FiCpu size={10} />, color: "var(--m-cyan)", status: "parsing" },
  { label: "智能语义分块中", icon: <FiLayers size={10} />, color: "var(--m-gold)", status: "cross_validating" },
  { label: "FAISS 向量化入库中", icon: <FiDatabase size={10} />, color: "var(--m-green)", status: "indexing_faiss" },
  { label: "LightRAG 知识图谱构建中", icon: <FiTrendingUp size={10} />, color: "var(--m-primary)", status: "indexing_lightrag" },
  { label: "完成", icon: <FiCheckCircle size={10} />, color: "#10B981", status: "done" },
];

const TASK_STATUS_LABELS: Record<string, string> = {
  received: "排队中", parsing: "MinerU 2.5-Pro 识别中", cross_validating: "智能语义分块中",
  postprocessing: "语义分块中", indexing_faiss: "FAISS 向量入库中",
  indexing_lightrag: "LightRAG 知识图谱构建中", done: "已完成", failed: "失败",
};

export default function ParsingPage() {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [parsingProgress, setParsingProgress] = useState(0);
  const [parsePhase, setParsePhase] = useState(0);
  const [parseStatusText, setParseStatusText] = useState("");
  const [activeTaskUuid, setActiveTaskUuid] = useState<string | null>(null);
  const [expandedSegments, setExpandedSegments] = useState<Set<number>>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [showTaskCenter, setShowTaskCenter] = useState(true);
  const [showUploadHistory, setShowUploadHistory] = useState(true);
  const [taskList, setTaskList] = useState<any[]>([]);

  const utils = trpc.useUtils();
  const { data: articles, isLoading, refetch: refetchArticles } = trpc.articles.list.useQuery();
  const { data: detail } = trpc.articles.get.useQuery(
    { id: selectedId! }, { enabled: !!selectedId },
  );
  const updateStatus = trpc.articles.updateStatus.useMutation({
    onSuccess: () => { utils.articles.list.invalidate(); toast.success("状态更新成功"); },
  });
  const approveArticle = trpc.articles.approve.useMutation({
    onSuccess: () => { utils.articles.list.invalidate(); utils.articles.get.invalidate(); toast.success("文献已入库"); },
  });
  const deleteArticle = trpc.articles.delete.useMutation({
    onSuccess: () => {
      utils.articles.list.invalidate();
      setSelectedId(null); setDeleteTarget(null); toast.success("文献已删除");
    },
  });

  const selected = articles?.find((a: any) => a.id === selectedId);
  const phases = ["MinerU 2.5-Pro 识别中", "智能语义分块中", "FAISS 向量入库中", "LightRAG 图谱构建"];

  // Map task status to phase index for progress display
  const getTaskPhase = (status: string) => {
    const map: Record<string,number> = { received:0, parsing:0, cross_validating:1, postprocessing:1, chunking:2, indexing_faiss:2, indexing_lightrag:3, indexing:3, done:4, partial:3, failed:-1 };
    return map[status] ?? 0;
  };
  const getFaissLabel = (task: any) => {
    const fs = task.faissStatus || task.faiss_status;
    if (fs === "success" || (task.faissChunksAdded || task.faiss_chunks_added) > 0) return { icon: "✅", label: "已入库", cls: "m-tag-green" };
    if (fs === "processing") return { icon: "⏳", label: "处理中", cls: "m-status-parsing" };
    if (fs === "failed") return { icon: "❌", label: "失败", cls: "m-status-error" };
    if (task.status === "done" || task.status === "partial") return { icon: "✅", label: "已完成", cls: "m-tag-green" };
    return { icon: "⬜", label: "待处理", cls: "m-status-pending" };
  };
  const getLightragLabel = (task: any) => {
    const ls = task.lightragStatus || task.lightrag_status;
    const ent = task.lightragEntities || task.lightrag_entities;
    if (ls === "success" || ent > 0) return { icon: "✅", label: `${ent || ""} 实体`, cls: "m-tag-green" };
    if (ls === "processing") return { icon: "⏳", label: "构建中", cls: "m-status-parsing" };
    if (ls === "failed" || task.status === "partial") return { icon: "⚠️", label: "未完成", cls: "m-status-pending" };
    if (task.status === "done") return { icon: "✅", label: "已完成", cls: "m-tag-green" };
    return { icon: "⬜", label: "待处理", cls: "m-status-pending" };
  };
  const formatTime = (t: string) => {
    if (!t) return "—";
    try { const d = new Date(t); return `${d.getMonth()+1}/${d.getDate()} ${d.getHours().toString().padStart(2,"0")}:${d.getMinutes().toString().padStart(2,"0")}`; }
    catch { return t?.substring(0,16) || "—"; }
  };

  // ── 文献归宿：智能判定上传类型 ──
  const getUploadDestiny = (task: any, allTasks: any[]) => {
    const md5 = task.fileMd5 || task.file_md5;
    const fn = task.filename || "";
    const chunks = task.faissChunksAdded || task.faiss_chunks_added || 0;
    const isUpdate = task.faissIsUpdate || task.faiss_is_update;
    const st = task.status;
    // Find same-MD5 tasks that are done (successfully ingested)
    const sameMd5Done = allTasks.filter(t =>
      (t.fileMd5 || t.file_md5) === md5 && md5 && t.status === "done" && t.task_uuid !== task.task_uuid
    );
    // Find same-filename tasks that are done
    const sameNameDone = allTasks.filter(t =>
      (t.filename || "") === fn && t.status === "done" && t.task_uuid !== task.task_uuid
    );

    if (isUpdate || (chunks > 0 && sameNameDone.length > 0 && (sameMd5Done.length === 0 || md5 !== sameNameDone[0]?.file_md5)))
      return { icon: "🔄", label: "版本更新", desc: "文献内容已变更，重新入库", color: "var(--m-cyan)" };
    if (st === "failed" && sameMd5Done.length > 0)
      return { icon: "💤", label: "重复入梦", desc: "相同内容已在此前成功入库", color: "var(--tx-100)" };
    if (st === "failed" && sameNameDone.length > 0 && md5 && sameNameDone[0] && (sameNameDone[0].file_md5 || sameNameDone[0].fileMd5) === md5)
      return { icon: "💤", label: "重复入梦", desc: "相同内容已在此前成功入库", color: "var(--tx-100)" };
    if (st === "failed" && chunks === 0)
      return { icon: "🌫️", label: "未竟之章", desc: "处理中断，未能完成入库", color: "var(--tx-100)" };
    if (sameMd5Done.length > 0)
      return { icon: "🌊", label: "似曾相识", desc: "相同 MD5 的文献已存在于知识库", color: "var(--m-gold)" };
    if (chunks > 0 && st === "done")
      return { icon: "✨", label: "新篇入阁", desc: "首次纳入知识库，开辟新知", color: "var(--m-green)" };
    if (chunks > 0)
      return { icon: "📖", label: "部分收录", desc: "已部分入库，可被检索", color: "var(--m-gold)" };
    return { icon: "⏳", label: "待定之章", desc: "尚未完成处理流程", color: "var(--tx-200)" };
  };

  // Fetch task history
  useEffect(() => {
    fetch("/api/upload/history").then(r => r.json()).then(d => setTaskList(d?.tasks || [])).catch(() => {});
  }, [isParsing]);

  // Poll active task status
  useEffect(() => {
    if (!activeTaskUuid) return;
    const timer = setInterval(async () => {
      try {
        const r = await fetch(`/api/upload/${activeTaskUuid}/status`);
        const task = await r.json();
        if (!task) return;
        setParseStatusText(TASK_STATUS_LABELS[task.status] || task.status);
        // Weighted progress based on real phase durations
        const progressWeights: Record<string, number> = {
          received:0, parsing:10, cross_validating:18, postprocessing:25,
          indexing_faiss:50, chunking:55, indexing_lightrag:80, indexing:80,
          done:100, partial:92, failed:100,
        };
        const phaseMap: Record<string, number> = { received:0, parsing:0, cross_validating:1, postprocessing:1, indexing_faiss:2, indexing_lightrag:3, done:4 };
        const phase = phaseMap[task.status] ?? 0;
        setParsePhase(Math.min(phase, 3));
        setParsingProgress(progressWeights[task.status] ?? Math.min((phase / 4) * 100 + 10, 95));
        if (task.status === "done") {
          setIsParsing(false); setParsingProgress(100); setParsePhase(4);
          setParseStatusText("完成");
          setActiveTaskUuid(null);
          toast.success(`${task.filename} 处理完成`);
          refetchArticles();
          // Auto-select the new article
          setTimeout(() => {
            fetch("/api/articles").then(r => r.json()).then(list => {
              const match = list.find((a: any) => a.file_name === task.filename);
              if (match) setSelectedId(match.id);
            }).catch(() => {});
          }, 1500);
        } else if (task.status === "failed") {
          setIsParsing(false);
          toast.error(`处理失败: ${task.error_message || "未知错误"}`);
          setActiveTaskUuid(null);
        }
      } catch { /* polling silent */ }
    }, 2000);
    return () => clearInterval(timer);
  }, [activeTaskUuid]);

  const handleUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.name.endsWith(".pdf")) { toast.error("仅支持 PDF 文件"); continue; }
      const formData = new FormData();
      formData.append("file", file);
      setIsParsing(true); setParsingProgress(0); setParsePhase(0);
      setParseStatusText("MinerU 2.5-Pro 识别中...");
      try {
        const resp = await fetch("/api/upload", { method: "POST", body: formData });
        const result = await resp.json();
        if (result.task_uuid) {
          setActiveTaskUuid(result.task_uuid);
          toast.success(`${file.name} 已加入处理队列`);
        } else {
          toast.error("上传失败");
          setIsParsing(false);
        }
      } catch (err: any) {
        toast.error("上传失败: " + (err.message || "网络错误"));
        setIsParsing(false);
      }
    }
    e.target.value = ""; // Reset file input
  }, [toast]);

  const toggleSegment = (id: number) => {
    setExpandedSegments((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, height: "100%" }}>
      <input ref={fileInputRef} type="file" accept=".pdf" multiple style={{ display: "none" }} onChange={handleFileSelect} />
      <ConfirmDialog
        open={deleteTarget !== null}
        title="确认删除文献"
        message={`确定要删除《${articles?.find((a) => a.id === deleteTarget)?.title || ""}》吗？此操作不可撤销。`}
        onConfirm={() => { if (deleteTarget) deleteArticle.mutate({ id: deleteTarget }); }}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Main 3-column layout */}
      <div style={{ display: "flex", gap: 10, flex: 1, minHeight: 0 }}>
        {/* ═══ LEFT COLUMN ═══ */}
        <div style={{ width: 250, flexShrink: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {/* Upload Zone */}
          <div
            onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFileSelect(); }}
            onClick={handleUpload}
            style={{
              border: dragOver ? "2px dashed var(--m-primary)" : "2px dashed var(--bd-300)",
              borderRadius: 12, padding: "14px 10px", textAlign: "center",
              background: dragOver ? "rgba(37,99,235,0.04)" : "var(--bg-surface)",
              transition: "all 0.3s var(--ease-out-expo)", cursor: "pointer",
              boxShadow: dragOver ? "0 0 0 4px rgba(37,99,235,0.06)" : "var(--sh-xs)",
              flexShrink: 0,
            }}
          >
            <div style={{ width: 36, height: 36, borderRadius: 10, background: dragOver ? "rgba(37,99,235,0.08)" : "var(--bg-hover)", color: "var(--m-primary)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 6px", transition: "all 0.3s", transform: dragOver ? "scale(1.1)" : "scale(1)" }}>
              <FiPlus size={18} />
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--tx-700)", marginBottom: 2 }}>点击或拖拽上传 PDF</div>
            <div style={{ fontSize: 10, color: "var(--tx-100)" }}>支持批量，最大 50MB</div>
          </div>

          {/* Parsing Progress */}
          {isParsing && (
            <div className="m-card" style={{ padding: 10, borderLeft: "3px solid var(--m-cyan)", flexShrink: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--tx-500)", display: "flex", alignItems: "center", gap: 5 }}>
                  <FiCpu size={11} style={{ color: "var(--m-cyan)" }} className="anim-pulse" /> MinerU 解析中
                </span>
                <span style={{ color: "var(--m-primary)", fontWeight: 700, fontSize: 12 }}>{Math.min(Math.round(parsingProgress), 100)}%</span>
              </div>
              <div style={{ height: 3, background: "var(--bg-hover)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.min(parsingProgress, 100)}%`, background: "linear-gradient(90deg,#2563EB,#00C4B4)", borderRadius: 2, transition: "width 0.3s" }} />
              </div>
            </div>
          )}

          {/* File Queue */}
          <div className="m-card" style={{ flex: "0 1 45%", overflow: "auto", padding: 10, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--tx-100)", textTransform: "uppercase", letterSpacing: "0.06em" }}>文件队列</span>
              <span className="m-badge m-tag-gray" style={{ fontSize: 9, padding: "1px 5px" }}>{articles?.length ?? 0} 篇</span>
            </div>
            {isLoading && <div style={{ textAlign: "center", padding: 16, color: "var(--tx-100)", fontSize: 11 }}>加载中...</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {articles?.map((article) => {
                const st = statusConfig[article.status as ArticleStatus];
                const isSel = selectedId === article.id;
                return (
                  <div key={article.id} onClick={() => setSelectedId(article.id)} style={{
                    padding: "6px 8px", borderRadius: 7,
                    background: isSel ? "rgba(37,99,235,0.05)" : "transparent",
                    border: `1.5px solid ${isSel ? "rgba(37,99,235,0.15)" : "transparent"}`,
                    cursor: "pointer", transition: "all 0.15s",
                  }}
                    onMouseEnter={(e) => { if (!isSel) e.currentTarget.style.background = "var(--bg-hover)"; }}
                    onMouseLeave={(e) => { if (!isSel) e.currentTarget.style.background = "transparent"; }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <FiFileText size={12} style={{ color: "var(--m-primary)", opacity: 0.5, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{article.title}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 3 }}>
                          <span style={{ fontSize: 9, fontWeight: 600, padding: "1px 5px", borderRadius: 100, background: st?.bg, color: st?.color, display: "flex", alignItems: "center", gap: 3 }}>{st?.icon}{st?.label}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {(!articles || articles.length === 0) && !isLoading && (
                <div style={{ textAlign: "center", padding: 16, color: "var(--tx-100)" }}>
                  <FiUpload size={24} opacity={0.3} style={{ marginBottom: 6 }} />
                  <div style={{ fontSize: 11 }}>暂无文献</div>
                </div>
              )}
            </div>
          </div>

          {/* Upload History */}
          <div className="m-card" style={{ flex: "0 1 35%", overflow: "auto", padding: 10, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, cursor: "pointer" }} onClick={() => setShowUploadHistory(!showUploadHistory)}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--tx-100)", textTransform: "uppercase", letterSpacing: "0.06em" }}>上传历史</span>
              {showUploadHistory ? <FiChevronDown size={12} color="var(--tx-100)" /> : <FiChevronRight size={12} color="var(--tx-100)" />}
            </div>
            {showUploadHistory && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {(articles || []).map((h) => {
                  const st = statusConfig[h.status as ArticleStatus];
                  return (
                    <div key={h.id} style={{ padding: "6px 8px", borderRadius: 6, background: "var(--bg-elevated)", transition: "all 0.15s", cursor: "pointer" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-elevated)"; }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
                        <span style={{ fontSize: 10, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120 }}>{(h.file_name || h.title || "—")}</span>
                        <span style={{ fontSize: 9, fontWeight: 600, padding: "1px 4px", borderRadius: 100, background: st?.bg, color: st?.color }}>{st?.label}</span>
                      </div>
                      <div style={{ fontSize: 9, color: "var(--tx-100)", display: "flex", justifyContent: "space-between" }}>
                        <span>{h.size}</span>
                        <span>{h.uploadedAt}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ═══ CENTER: Preview ═══ */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          {/* Toolbar */}
          <div className="m-card" style={{ padding: "8px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--tx-900)" }}>{selected ? "解析预览" : "请选择文献"}</h3>
              {selected && (
                <div style={{ display: "flex", gap: 5 }}>
                  <span className="m-badge m-tag-primary" style={{ fontSize: 10 }}><FiLayers size={9} style={{ display: "inline", marginRight: 3 }} />{detail?.segments?.length ?? selected.textSegmentsCount} 块</span>
                  <span className="m-badge m-tag-cyan" style={{ fontSize: 10 }}><FiImage size={9} style={{ display: "inline", marginRight: 3 }} />{selected.figuresCount} 图表</span>
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {selected && (
                <>
                  <button onClick={() => setShowConfig(!showConfig)} className="m-btn m-btn-ghost m-btn-sm"><FiSettings size={12} /> 参数</button>
                  {selected.status === "parsed" && (
                    <button onClick={() => approveArticle.mutate({ id: selected.id })} className="m-btn m-btn-primary m-btn-sm"><FiDatabase size={12} /> 入库</button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Config */}
          {showConfig && selected && (
            <div className="m-card" style={{ padding: 12, flexShrink:0, animation: "slideInUp 0.3s var(--ease-out-expo)" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
                {[
                  { label: "切分维度", opts: ["医学章节逻辑","段落粒度","句子粒度"] },
                  { label: "图表精度", opts: ["高精度","标准","快速"] },
                  { label: "元数据提取", opts: ["完整模式","基础模式"] },
                ].map((f,i) => (
                  <div key={i}>
                    <label style={{ fontSize: 10, color: "var(--tx-100)", display: "block", marginBottom: 3 }}>{f.label}</label>
                    <select className="m-input" style={{ fontSize: 11, height: 28, padding: "0 6px" }}>{f.opts.map(o => <option key={o}>{o}</option>)}</select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Content */}
          <div className="m-card" style={{ flex: 1, overflow: "auto", padding: 14 }}>
            {!selected ? (
              <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--tx-100)", gap: 12 }}>
                <div style={{ width: 56, height: 56, borderRadius: 14, background: "var(--bg-hover)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <FiFileText size={28} opacity={0.35} />
                </div>
                <div style={{ textAlign: "center" }}>
                  <p style={{ fontSize: 14, fontWeight: 600, color: "var(--tx-300)", marginBottom: 4 }}>从左侧选择一个文献</p>
                  <p style={{ fontSize: 12 }}>查看语义切分结果、图表提取和解析详情</p>
                </div>
              </div>
            ) : !detail?.segments?.length ? (
              <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--tx-100)", gap: 12 }}>
                <div style={{ width: 56, height: 56, borderRadius: 14, background: "var(--bg-hover)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <FiCpu size={28} opacity={0.35} />
                </div>
                <div style={{ textAlign: "center" }}>
                  <p style={{ fontSize: 14, fontWeight: 600, color: "var(--tx-300)", marginBottom: 4 }}>该文献尚未完成解析</p>
                  <p style={{ fontSize: 12, marginBottom: 10 }}>点击开始 MinerU 智能解析</p>
                </div>
                <button onClick={() => { updateStatus.mutate({ id: selected.id, status: "parsing" }); handleFileSelect(); }} className="m-btn m-btn-primary" style={{ height: 34, fontSize: 12 }}>
                  <FiRotateCw size={13} /> 开始解析
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ paddingBottom: 10, borderBottom: "1px solid var(--bd-100)" }}>
                  <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 6, color: "var(--tx-900)" }}>{selected.title}</h2>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", fontSize: 11, color: "var(--tx-100)" }}>
                    <span><strong style={{ color: "var(--tx-500)" }}>作者:</strong> {((selected.authors as string[] | null) || []).join(", ") || "-"}</span>
                    <span><strong style={{ color: "var(--tx-500)" }}>期刊:</strong> {selected.journal || "-"}</span>
                    <span><strong style={{ color: "var(--tx-500)" }}>DOI:</strong> {selected.doi || "-"}</span>
                  </div>
                </div>
                <div>
                  <h4 style={{ fontSize: 10, fontWeight: 700, marginBottom: 8, display: "flex", alignItems: "center", gap: 5, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--tx-100)" }}>
                    <FiLayers size={12} /> 语义切分结果
                  </h4>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {detail.segments.map((seg) => {
                      const isExpanded = expandedSegments.has(seg.id);
                      const color = segColors[seg.segmentType] || "#6B7280";
                      return (
                        <div key={seg.id} style={{ borderRadius: 8, border: "1px solid var(--bd-100)", overflow: "hidden" }}>
                          <div onClick={() => toggleSegment(seg.id)} style={{ padding: "7px 10px", display: "flex", alignItems: "center", gap: 7, cursor: "pointer", background: "var(--bg-elevated)", borderLeft: `3px solid ${color}` }}>
                            {isExpanded ? <FiChevronDown size={11} color="var(--tx-100)" /> : <FiChevronRight size={11} color="var(--tx-100)" />}
                            <span style={{ fontSize: 9, fontWeight: 600, padding: "1px 7px", borderRadius: 100, background: `${color}12`, color, whiteSpace: "nowrap" }}>{segLabels[seg.segmentType] || seg.segmentType}</span>
                            <span style={{ flex: 1, fontSize: 11, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--tx-700)" }}>{seg.sectionTitle || `段落 ${seg.sequence}`}</span>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10, color: "var(--tx-100)", flexShrink: 0 }}>
                              <span>{seg.wordCount} 字</span>
                              {seg.confidence && <span style={{ color: seg.confidence > 0.8 ? "var(--m-green)" : seg.confidence > 0.6 ? "var(--m-orange)" : "var(--m-red)", fontWeight: 600 }}>{(seg.confidence * 100).toFixed(0)}%</span>}
                            </div>
                          </div>
                          {isExpanded && (
                            <div style={{ padding: 10, fontSize: 12, lineHeight: 1.7, color: "var(--tx-500)", background: "var(--bg-surface)" }}>
                              <p>{seg.content}</p>
                              {seg.evidenceLevel && <div style={{ marginTop: 6 }}><span className="m-badge m-tag-green" style={{ fontSize: 9 }}><FiTag size={8} style={{ display: "inline", marginRight: 3 }} />证据等级: {seg.evidenceLevel}</span></div>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ═══ RIGHT: Metadata ═══ */}
        {selected && (
          <div style={{ width: 210, flexShrink: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="m-card" style={{ padding: 10 }}>
              <h4 style={{ fontSize: 10, fontWeight: 700, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--tx-100)" }}>文献元数据</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 10 }}>
                {[{label:"文件名",value:selected.fileName},{label:"大小",value:selected.fileSize?`${(selected.fileSize/1024/1024).toFixed(1)}MB`:"-"},{label:"发表",value:selected.publishDate||"-"},{label:"类型",value:selected.articleType||"-"}].map(item => (
                  <div key={item.label}><div style={{ color: "var(--tx-100)", fontSize: 9, marginBottom: 1 }}>{item.label}</div><div style={{ fontWeight: 500, color: "var(--tx-700)", wordBreak: "break-all" }}>{item.value}</div></div>
                ))}
                <div><div style={{ color: "var(--tx-100)", fontSize: 9, marginBottom: 3 }}>关键词</div><div style={{ display: "flex", flexWrap: "wrap", gap: 2 }}>{((selected.keywords as string[] | null) || []).map((kw,i)=><span key={i} className="m-badge m-tag-primary" style={{fontSize:9,padding:"1px 4px"}}>{kw}</span>) || <span style={{color:"var(--tx-100)"}}>-</span>}</div></div>
              </div>
            </div>
            <div className="m-card" style={{ padding: 10 }}>
              <h4 style={{ fontSize: 10, fontWeight: 700, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--tx-100)" }}>审核操作</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {selected.status === "parsed" && (
                  <>
                    <button onClick={() => approveArticle.mutate({ id: selected.id })} className="m-btn m-btn-primary" style={{ width: "100%", height: 32, fontSize: 11 }}><FiCheckCircle size={12} /> 审核通过</button>
                    <button onClick={() => updateStatus.mutate({ id: selected.id, status: "rejected" })} className="m-btn" style={{ width: "100%", height: 32, fontSize: 11, background: "transparent", color: "var(--m-red)", border: "1.5px solid rgba(232,77,77,0.2)" }}><FiXCircle size={12} /> 驳回</button>
                  </>
                )}
                {selected.status === "approved" && (
                  <div style={{ padding: 8, borderRadius: 7, background: "rgba(16,185,129,0.06)", color: "var(--m-green)", fontSize: 11, textAlign: "center" }}>
                    <FiCheckCircle size={14} style={{ marginBottom: 3 }} /><div style={{ fontWeight: 700 }}>已入库</div>
                  </div>
                )}
                <button onClick={() => updateStatus.mutate({ id: selected.id, status: "parsing" })} className="m-btn m-btn-ghost" style={{ width: "100%", height: 32, fontSize: 11 }}><FiRotateCw size={12} /> 重新解析</button>
                <button onClick={() => setDeleteTarget(selected.id)} className="m-btn m-btn-ghost" style={{ width: "100%", height: 32, fontSize: 11, color: "var(--m-red)" }}><FiTrash2 size={12} /> 删除</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ═══ BOTTOM: Task Center ═══ */}
      <div className="m-card" style={{ flexShrink: 0, padding: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, cursor: "pointer" }} onClick={() => setShowTaskCenter(!showTaskCenter)}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <FiBox size={14} style={{ color: "var(--m-primary)" }} />
              <h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--tx-900)" }}>任务中心</h3>
            </div>
            <span className="m-badge m-tag-gray" style={{ fontSize: 9 }}>{taskList.length} 个任务</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 10, color: "var(--tx-100)" }}>全链路追踪</span>
            {showTaskCenter ? <FiChevronDown size={14} color="var(--tx-100)" /> : <FiChevronRight size={14} color="var(--tx-100)" />}
          </div>
        </div>

        {showTaskCenter && (
          <div style={{ overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: "1.5px solid var(--bd-200)" }}>
                  {["任务ID","文件名称","文献归宿","用户","解析状态","FAISS入库","知识图谱","时间"].map(h => (
                    <th key={h} style={{ textAlign: "left", padding: "6px 8px", fontWeight: 700, color: "var(--tx-100)", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {taskList.map((task, idx) => {
                  const st = statusConfig[task.status as ArticleStatus];
                  const faiss = getFaissLabel(task);
                  const lrag = getLightragLabel(task);
                  const destiny = getUploadDestiny(task, taskList);
                  const createdAt = task.createdAt || task.created_at || task.uploadTime;
                  const userName = task.userName || task.user_name || task.uploadedBy || task.uploaded_by || "—";
                  return (
                    <tr key={(task.task_uuid || task.taskUuid || "").substring(0,8)} style={{ borderBottom: idx < taskList.length - 1 ? "1px solid var(--bd-100)" : "none", transition: "background 0.15s" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      <td style={{ padding: "7px 8px", whiteSpace: "nowrap" }}>
                        <span style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 600, color: "var(--m-primary)" }}>{(task.task_uuid || task.taskUuid || "").substring(0,8)}</span>
                      </td>
                      <td style={{ padding: "7px 8px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                          <FiFileText size={11} style={{ color: "var(--tx-100)", flexShrink: 0 }} />
                          <span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }} title={task.filename}>{task.filename || "—"}</span>
                        </div>
                      </td>
                      <td style={{ padding: "7px 8px", whiteSpace: "nowrap" }}>
                        <span title={destiny.desc} style={{ fontSize: 10, fontWeight: 500, color: destiny.color, display: "inline-flex", alignItems: "center", gap: 3, cursor: "default" }}>{destiny.icon}{destiny.label}</span>
                      </td>
                      <td style={{ padding: "7px 8px", color: "var(--tx-300)", fontSize: 10, whiteSpace: "nowrap" }}>{userName}</td>
                      <td style={{ padding: "7px 8px", whiteSpace: "nowrap" }}>
                        <span style={{ fontSize: 9, fontWeight: 600, padding: "2px 7px", borderRadius: 100, background: st?.bg, color: st?.color, display: "inline-flex", alignItems: "center", gap: 3 }}>{st?.icon}{st?.label}</span>
                      </td>
                      <td style={{ padding: "7px 8px", whiteSpace: "nowrap" }}>
                        <span className={`m-badge ${faiss.cls}`} style={{ fontSize: 9, padding: "2px 6px" }}>{faiss.icon} {faiss.label}</span>
                      </td>
                      <td style={{ padding: "7px 8px", whiteSpace: "nowrap" }}>
                        <span className={`m-badge ${lrag.cls}`} style={{ fontSize: 9, padding: "2px 6px" }}>{lrag.icon} {lrag.label}</span>
                      </td>
                      <td style={{ padding: "7px 8px", color: "var(--tx-100)", whiteSpace: "nowrap", fontSize: 10 }}>{formatTime(createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
