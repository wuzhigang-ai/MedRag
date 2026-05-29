import { useState, useRef, useEffect } from "react";
import { api } from "@/lib/api";
import { useToast } from "@/providers/toast";
import {
  FiSend, FiPlus, FiMessageSquare, FiFileText,
  FiCopy, FiBookmark, FiActivity, FiDatabase, FiCheck,
  FiSearch, FiImage, FiMic,
} from "react-icons/fi";

interface Msg {
  id: number; role: "user" | "assistant";
  content: string;
  citations?: Array<{ articleId: number; articleTitle: string; content: string }>;
}

interface RagStep {
  step: string; tool: string; input: string; output: string; desc: string;
}

interface StepMetrics {
  latency: string; detail: string;
}

const TOOL_DISPLAY: Record<string, { label: string; desc: string; output: string }> = {
  search_rag: { label: "多模态 双路检索", desc: "向量关键词检索 + LightRAG自然语言图谱检索", output: "召回文献片段" },
  deep_retrieve: { label: "多维检索", desc: "从多个临床维度系统检索同一主题", output: "多维度结果" },
  cross_check: { label: "交叉验证", desc: "检测多篇文献结论一致性，发现证据矛盾", output: "一致性报告" },
  get_evidence: { label: "文献覆盖", desc: "查询单篇文献在知识库中的覆盖范围", output: "覆盖信息" },
  list_docs: { label: "文献清单", desc: "列出知识库全部文献及文本块数量", output: "文献列表" },
  extract_chart: { label: "图表提取", desc: "搜索文献中与指定图表相关的文本片段", output: "图表文本" },
  analyze_image: { label: "VLM 图表分析", desc: "多模态模型实时分析图表，提取效应量/CI/p值", output: "结构化数据" },
  estimate_grade: { label: "GRADE 评级", desc: "对医学证据进行GRADE证据质量评级", output: "证据等级" },
  build_consistency_matrix: { label: "一致性矩阵", desc: "构建多文献结论一致性分析矩阵", output: "一致性判定" },
  self_reflect: { label: "回溯重搜", desc: "低置信度时自动简化检索词重新搜索", output: "补充检索" },
};
function toolToStep(toolName: string, idx: number): RagStep {
  const info = TOOL_DISPLAY[toolName] || { label: toolName, desc: "执行工具调用", output: "完成" };
  return { step: `Step ${idx + 1}`, tool: info.label, input: "Agent 调用", output: info.output, desc: info.desc };
}

const quickQs = [
  "房颤高卒中风险患者的一线抗凝方案？",
  "PD-1抑制剂联合化疗治疗NSCLC的疗效数据？",
  "COVID-19 mRNA疫苗与灭活疫苗的免疫原性对比？",
  "阿尔茨海默病早期诊断的生物标志物？",
];

/* ── Markdown Renderer ── */
function MdRender({ content }: { content: string }) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let tableRows: string[] = [];
  let inTable = false;

  const isSepRow = (r: string) => /^\|[\s\-:]+\|$/.test(r.trim());
  const flushTable = () => {
    while (tableRows.length > 0 && isSepRow(tableRows[0])) tableRows.shift();
    while (tableRows.length > 0 && isSepRow(tableRows[tableRows.length - 1])) tableRows.pop();
    if (tableRows.length < 2) { tableRows = []; inTable = false; return; }
    let sepIdx = tableRows.findIndex((r, i) => i > 0 && isSepRow(r));
    if (sepIdx === -1) sepIdx = 1;
    const headers = tableRows[0].split("|").map(h => h.trim()).filter(Boolean);
    const dataRows = tableRows.slice(sepIdx + 1).filter(r => !isSepRow(r)).map(r => r.split("|").map(c => c.trim()).filter(Boolean));
    elements.push(
      <div key={`t-${elements.length}`} style={{ overflow: "auto", margin: "8px 0", borderRadius: 8, border: "1px solid var(--bd-100)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead><tr style={{ background: "var(--bg-hover)" }}>{headers.map((h, i) => <th key={i} style={{ padding: "6px 10px", textAlign: "left", fontWeight: 700, color: "var(--tx-700)", fontSize: 10, borderBottom: "1px solid var(--bd-200)", whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
          <tbody>{dataRows.map((row, ri) => <tr key={ri} style={{ borderBottom: ri < dataRows.length - 1 ? "1px solid var(--bd-100)" : "none" }}>{row.map((cell, ci) => <td key={ci} style={{ padding: "5px 10px", color: "var(--tx-500)", whiteSpace: "nowrap" }}>{cell}</td>)}</tr>)}</tbody>
        </table>
      </div>
    );
    tableRows = []; inTable = false;
  };

  lines.forEach((line, i) => {
    if (line.startsWith("| ")) { tableRows.push(line); inTable = true; return; }
    if (inTable) flushTable();
    if (line.startsWith("## ")) elements.push(<h3 key={i} style={{ fontSize: 14, fontWeight: 700, margin: "10px 0 4px", color: "var(--tx-900)" }}>{line.replace("## ", "")}</h3>);
    else if (line.startsWith("### ")) elements.push(<h4 key={i} style={{ fontSize: 13, fontWeight: 600, margin: "8px 0 3px", color: "var(--tx-700)" }}>{line.replace("### ", "")}</h4>);
    else if (line.startsWith("> ")) elements.push(<blockquote key={i} style={{ borderLeft: "2px solid var(--m-cyan)", paddingLeft: 8, color: "var(--tx-300)", fontSize: 11, margin: "6px 0", lineHeight: 1.6 }}>{line.replace("> ", "")}</blockquote>);
    else if (line.trim() === "---") elements.push(<hr key={i} style={{ border: "none", borderTop: "1px solid var(--bd-100)", margin: "8px 0" }} />);
    else if (line.trim() === "") elements.push(<div key={i} style={{ height: 3 }} />);
    else if (line.startsWith("- ")) elements.push(<li key={i} style={{ marginLeft: 14, fontSize: 12, color: "var(--tx-500)", lineHeight: 1.7 }}>{line.replace("- ", "")}</li>);
    else if (/^\d+\.\s/.test(line)) elements.push(<li key={i} style={{ marginLeft: 14, fontSize: 12, color: "var(--tx-500)", lineHeight: 1.7 }}>{line.replace(/^\d+\.\s/, "")}</li>);
    else elements.push(<p key={i} style={{ fontSize: 12, color: "var(--tx-500)", lineHeight: 1.7 }}>{line}</p>);
  });
  if (inTable) flushTable();
  return <>{elements}</>;
}

/* ── Typing Indicator ── */
function TypingIndicator() {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <div style={{ width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg,var(--m-primary),var(--m-cyan))", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 10, fontWeight: 700, flexShrink: 0 }}>AI</div>
      <div style={{ padding: "10px 14px", borderRadius: "14px 14px 14px 4px", background: "var(--bg-surface)", border: "1px solid var(--bd-100)", boxShadow: "var(--sh-xs)" }}>
        <div className="typing-dots" style={{ display: "flex", alignItems: "center", gap: 3, padding: "4px 8px" }}><span /><span /><span /></div>
      </div>
    </div>
  );
}

/* ── Premium Avatar ── */
function UserAvatar({ name, size = 28 }: { name: string; size?: number }) {
  const initial = name ? name.charAt(0).toUpperCase() : "U";
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: "linear-gradient(135deg, #2563EB, #00C4B4, #D4A853)",
      display: "flex", alignItems: "center", justifyContent: "center",
      color: "white", fontSize: size * 0.4, fontWeight: 700, flexShrink: 0,
      boxShadow: "0 0 0 2px var(--bg-base), 0 0 0 3px rgba(212,168,83,0.25)",
      position: "relative",
    }}>
      {initial}
      <div style={{ position: "absolute", bottom: 0, right: 0, width: 7, height: 7, borderRadius: "50%", background: "var(--m-green)", border: "2px solid var(--bg-base)" }} />
    </div>
  );
}

export default function AdminChatPage() {
  const toast = useToast();
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [generating, setGenerating] = useState(false);
  const [trace, setTrace] = useState<RagStep[]>([]);
  const [stepMetrics, setStepMetrics] = useState<Record<number, StepMetrics>>({});
  const [activeStep, setActiveStep] = useState(-1);
  const [inputFocused, setInputFocused] = useState(false);
  const [userName, setUserName] = useState("用户");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [articles] = useState<any[]>([]);
  const [liveLatency, setLiveLatency] = useState("0.0");
  const [preTrace, setPreTrace] = useState<Array<{icon: string; label: string; desc: string}>>([]);
  const stepStartRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const phaseTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const PRE_PHASES = [
    { icon: "🧠", label: "意图识别", desc: "解析用户查询，识别医学实体与临床场景", duration: 1500 },
    { icon: "💭", label: "思考决策", desc: "判断问题类型，选择最优检索策略与证据链", duration: 2500 },
    { icon: "🔗", label: "规划工具链", desc: "编排多步推理工具调用序列", duration: 2500 },
  ];

  useEffect(() => {
    const user = localStorage.getItem("medrag_user");
    if (user) {
      try { const u = JSON.parse(user); setUserName(u.name || u.email?.split("@")[0] || "用户"); } catch { /* ignore */ }
    }
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, generating]);
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 120) + "px"; }
  }, [input]);

  const handleSend = async () => {
    if (!input.trim() || generating) return;
    const question = input.trim();
    const userMsg: Msg = { id: Date.now(), role: "user", content: question };
    setMsgs(p => [...p, userMsg]);
    setInput("");
    setGenerating(true);
    setTrace([]);
    setPreTrace([]);
    setStepMetrics({});
    setActiveStep(-1);

    // Pre-tool reasoning phases (chained setTimeout)
    if (timerRef.current) clearInterval(timerRef.current);
    if (phaseTimerRef.current) clearTimeout(phaseTimerRef.current as any);
    stepStartRef.current = Date.now();
    setLiveLatency("0.0");
    timerRef.current = setInterval(() => setLiveLatency(((Date.now() - stepStartRef.current) / 1000).toFixed(1)), 100);
    let delay = 0;
    PRE_PHASES.forEach((p, i) => {
      delay += i === 0 ? 800 : (PRE_PHASES[i-1].duration);
      phaseTimerRef.current = setTimeout(() => { setPreTrace(prev => [...prev, p]); }, delay) as any;
    });

    const aiMsgId = Date.now() + 1;
    const collected: RagStep[] = [];
    const _cumTimes: number[] = [];
    let aiContent = "";
    let aiCitations: Msg["citations"] = [];

    try {
      await api.streamAgent(
        question,
        (data: any) => {
          if (phaseTimerRef.current) { clearTimeout(phaseTimerRef.current as any); phaseTimerRef.current = null; }
          setPreTrace([]);
          const step = toolToStep(data.tool || "unknown", collected.length);
          // Freeze previous step's timer
          const prevIdx = collected.length - 1;
          if (prevIdx >= 0 && timerRef.current) {
            const frozen = ((Date.now() - stepStartRef.current) / 1000).toFixed(1);
            setStepMetrics(p => ({ ...p, [prevIdx]: { ...p[prevIdx], latency: frozen } }));
          }
          collected.push(step);
          setTrace([...collected]);
          setActiveStep(collected.length - 1);
          if (timerRef.current) clearInterval(timerRef.current);
          stepStartRef.current = Date.now();
          setLiveLatency("0.0");
          timerRef.current = setInterval(() => setLiveLatency(((Date.now() - stepStartRef.current) / 1000).toFixed(1)), 100);
          setStepMetrics(p => ({ ...p, [collected.length - 1]: { latency: "0.0", detail: data.tool === "search_rag" ? `检索: ${(data.args?.faiss_query || "").substring(0, 40)}` : (TOOL_DISPLAY[data.tool]?.output || "完成") } }));
        },
        (data: any) => {
          if (phaseTimerRef.current) { clearTimeout(phaseTimerRef.current as any); phaseTimerRef.current = null; }
          setPreTrace([]);
          if (timerRef.current) {
            clearInterval(timerRef.current); timerRef.current = null;
            const lastIdx = collected.length - 1;
            if (lastIdx >= 0) {
              const frozen = ((Date.now() - stepStartRef.current) / 1000).toFixed(1);
              setStepMetrics(p => ({ ...p, [lastIdx]: { ...p[lastIdx], latency: frozen } }));
            }
          }
          aiContent = data.answer || "";
          aiCitations = (data.sources || []).map((s: any) => ({ articleId: 0, articleTitle: s.source || s.title || String(s), content: s.text_preview || "" }));
        },
        (err: string) => { if (phaseTimerRef.current) { clearTimeout(phaseTimerRef.current as any); phaseTimerRef.current = null; } setPreTrace([]); if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } aiContent = `错误: ${err}`; },
        () => { if (phaseTimerRef.current) { clearTimeout(phaseTimerRef.current as any); phaseTimerRef.current = null; } if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } }
      );
    } catch (err: any) {
      if (phaseTimerRef.current) { clearTimeout(phaseTimerRef.current as any); phaseTimerRef.current = null; }
      setPreTrace([]);
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      aiContent = `连接失败: ${err.message || "未知错误"}`;
    }

    if (!aiContent) aiContent = "Agent 推理完成，但未能生成回答。";
    setMsgs(p => [...p, { id: aiMsgId, role: "assistant", content: aiContent, citations: aiCitations }]);
    setGenerating(false);
  };
    }
    setMsgs(p => [...p, { id: Date.now() + 1, role: "assistant", content: resp, citations }]);
    setGenerating(false);
  };

  const copyContent = (content: string) => {
    navigator.clipboard.writeText(content);
    toast.success("已复制到剪贴板");
  };

  return (
    <div style={{ display: "flex", gap: 10, height: "100%" }}>
      {/* ═── Center: Chat ─── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, background: "var(--bg-surface)", borderRadius: 12, border: "1px solid var(--bd-100)", overflow: "hidden", boxShadow: "var(--sh-xs)" }}>
        {/* Messages */}
        <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
          {msgs.length === 0 ? (
            <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 20px" }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: "linear-gradient(135deg,var(--m-primary),var(--m-cyan))", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 24, fontWeight: 800, marginBottom: 14, boxShadow: "var(--sh-md)" }}>M</div>
              <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6, color: "var(--tx-900)" }}>MedRAG 医疗智能问答</h2>
              <p style={{ fontSize: 12, color: "var(--tx-100)", marginBottom: 20, textAlign: "center" }}>基于 LightRAG 向量知识图谱，提供可溯源的专业医疗问答</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, maxWidth: 440, width: "100%" }}>
                {quickQs.map((q, i) => (
                  <button key={i} onClick={() => setInput(q)} style={{ padding: "10px 12px", borderRadius: 10, border: "1.5px solid var(--bd-200)", background: "var(--bg-elevated)", color: "var(--tx-300)", fontSize: 12, textAlign: "left", cursor: "pointer", transition: "all 0.2s", lineHeight: 1.5 }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--m-cyan)"; e.currentTarget.style.boxShadow = "var(--sh-sm)"; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--bd-200)"; e.currentTarget.style.boxShadow = "none"; }}>{q}</button>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", gap: 18 }}>
              {msgs.map(msg => (
                <div key={msg.id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  {msg.role === "user" ? (
                    <UserAvatar name={userName} size={28} />
                  ) : (
                    <div style={{ width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg,var(--m-primary),var(--m-cyan))", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 10, fontWeight: 700, flexShrink: 0 }}>AI</div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ padding: "10px 14px", borderRadius: msg.role === "user" ? "4px 14px 14px 14px" : "14px 4px 14px 14px", background: msg.role === "user" ? "var(--m-primary)" : "var(--bg-elevated)", color: msg.role === "user" ? "white" : "var(--tx-700)", border: msg.role === "user" ? "none" : "1px solid var(--bd-100)", boxShadow: msg.role === "user" ? "none" : "var(--sh-xs)" }}>
                      <MdRender content={msg.content} />
                    </div>
                    {msg.role === "assistant" && msg.citations && msg.citations.length > 0 && (
                      <div style={{ marginTop: 6, padding: 10, borderRadius: 8, background: "rgba(37,99,235,0.03)", border: "1px solid rgba(37,99,235,0.06)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6, fontSize: 11, fontWeight: 700, color: "var(--m-primary)" }}><FiDatabase size={10} /> 文献溯源</div>
                        {msg.citations.map((c, i) => (
                          <div key={i} style={{ padding: "4px 0", borderBottom: i < msg.citations!.length - 1 ? "1px solid rgba(37,99,235,0.05)" : "none" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                              <span className="m-badge m-tag-primary" style={{ fontSize: 9, padding: "1px 5px" }}>[{i + 1}]</span>
                              <span style={{ fontWeight: 600, color: "var(--tx-700)", fontSize: 11 }}>{c.articleTitle}</span>
                            </div>
                            <p style={{ color: "var(--tx-300)", marginLeft: 24, fontSize: 10, lineHeight: 1.5, marginTop: 2 }}>{c.content}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    {msg.role === "assistant" && (
                      <div style={{ display: "flex", gap: 4, marginTop: 5 }}>
                        <button onClick={() => copyContent(msg.content)} className="m-btn m-btn-ghost m-btn-sm" style={{ padding: "2px 6px" }} title="复制"><FiCopy size={10} /></button>
                        <button className="m-btn m-btn-ghost m-btn-sm" style={{ padding: "2px 6px" }} title="收藏"><FiBookmark size={10} /></button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {generating && <TypingIndicator />}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Input */}
        <div style={{ padding: "10px 14px", borderTop: "1px solid var(--bd-100)", flexShrink: 0, background: "var(--bg-base)" }}>
          <div style={{ maxWidth: 720, margin: "0 auto" }}>
            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              {[
                { icon: <FiFileText size={13} />, label: "PDF", bg: "rgba(37,99,235,0.08)", color: "var(--m-primary)", border: "rgba(37,99,235,0.15)" },
                { icon: <FiImage size={13} />, label: "图片", bg: "rgba(0,196,180,0.08)", color: "var(--m-cyan)", border: "rgba(0,196,180,0.15)" },
                { icon: <FiMic size={13} />, label: "语音", bg: "rgba(212,168,83,0.08)", color: "var(--m-gold)", border: "rgba(212,168,83,0.15)" },
              ].map((b, i) => (
                <button key={i} style={{ padding: "5px 12px", fontSize: 11, color: b.color, background: b.bg, border: `1.5px solid ${b.border}`, borderRadius: 8, display: "flex", alignItems: "center", gap: 5, cursor: "pointer", transition: "all 0.2s" }}
                  onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "var(--sh-sm)"; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}>{b.icon} {b.label}</button>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 6, padding: "6px 8px 6px 12px", background: "var(--bg-surface)", borderRadius: 12, border: `1.5px solid ${inputFocused ? "var(--m-cyan)" : "var(--bd-200)"}`, boxShadow: inputFocused ? "0 0 0 3px rgba(0,196,180,0.08)" : "none", transition: "all 0.25s" }}>
              <textarea ref={textareaRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }} onFocus={() => setInputFocused(true)} onBlur={() => setInputFocused(false)} placeholder="输入医疗问题..." style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--tx-700)", fontSize: 13, resize: "none", maxHeight: 120, minHeight: 22, lineHeight: 1.5, fontFamily: "inherit" }} rows={1} />
              <button onClick={handleSend} disabled={!input.trim() || generating} style={{ width: 32, height: 32, borderRadius: 9, border: "none", background: input.trim() && !generating ? "var(--m-primary)" : "var(--bg-hover)", color: input.trim() && !generating ? "white" : "var(--tx-100)", display: "flex", alignItems: "center", justifyContent: "center", cursor: input.trim() && !generating ? "pointer" : "not-allowed", transition: "all 0.2s", flexShrink: 0 }}>
                <FiSend size={15} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ═── Right: Agent Panel ─── */}
      <div style={{ width: 230, flexShrink: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="m-card" style={{ padding: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <FiActivity size={13} style={{ color: "var(--m-cyan)" }} />
            <span style={{ fontSize: 12, fontWeight: 700 }}>Agent 推理过程</span>
          </div>
        </div>
        <div className="m-card" style={{ flex: 1, overflow: "auto", padding: 10 }}>
          {trace.length === 0 && !generating && (
            <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--tx-100)", fontSize: 11, textAlign: "center", gap: 6 }}>
              <FiSearch size={20} /><p>发送问题后将显示<br />Agent 推理过程</p>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {preTrace.map((p, i) => {
              const isLastPre = i === preTrace.length - 1 && trace.length === 0;
              return (
                <div key={`pre-${i}`} style={{
                  padding: "8px 10px", borderRadius: 8,
                  background: isLastPre ? "linear-gradient(135deg, rgba(239,68,68,0.02) 0%, var(--bg-surface) 50%)" : "var(--bg-surface)",
                  border: `1px solid ${isLastPre ? "rgba(239,68,68,0.18)" : "var(--bd-100)"}`,
                  animation: "fadeIn 0.3s ease", position: "relative", overflow: "hidden",
                }}>
                  {isLastPre && <div style={{ position: "absolute", inset: 0, background: "linear-gradient(105deg, transparent 40%, rgba(239,68,68,0.03) 50%, transparent 60%)", backgroundSize: "200% 100%", animation: "shimmer 1.8s ease-in-out infinite", pointerEvents: "none" }} />}
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 20, height: 20, borderRadius: "50%", background: "linear-gradient(135deg, rgba(239,68,68,0.12), rgba(239,68,68,0.06))", color: "#ef4444", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, border: "1.5px solid rgba(239,68,68,0.18)" }}>{p.icon}</div>
                    <span style={{ fontSize: 10, fontWeight: 600 }}>{p.label}</span>
                    {isLastPre && <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 700, fontFamily: "monospace", color: "#ef4444" }}>{liveLatency}s</span>}
                  </div>
                  <div style={{ marginTop: 2, fontSize: 9, color: "var(--tx-200)", marginLeft: 26 }}>{p.desc}</div>
                </div>
              );
            })}
            {trace.map((s, i) => {
              const active = i < trace.length;
              const cur = i === activeStep && generating;
              const metrics = stepMetrics[i];
              if (!active && !cur && generating && i > activeStep) return null;
              if (!active && !generating) return null;
              return (
                <div key={i} style={{ padding: 8, borderRadius: 8, background: active ? "var(--bg-surface)" : "var(--bg-hover)", border: `1.5px solid ${cur ? "rgba(0,196,180,0.30)" : active ? "var(--bd-100)" : "transparent"}`, transition: "all 0.4s", position: "relative", overflow: "hidden", animation: active ? "fadeIn 0.4s ease" : "none" }}>
                  {cur && <div style={{ position: "absolute", inset: 0, background: "linear-gradient(105deg, transparent 40%, rgba(0,196,180,0.06) 45%, rgba(37,99,235,0.08) 50%, rgba(0,196,180,0.06) 55%, transparent 60%)", backgroundSize: "200% 100%", animation: "shimmer 1.8s ease-in-out infinite", pointerEvents: "none" }} />}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: metrics ? 6 : 4 }}>
                    <div style={{ width: 20, height: 20, borderRadius: "50%", background: active ? "rgba(0,196,180,0.12)" : "var(--bg-hover)", color: active ? "var(--m-cyan)" : "var(--tx-100)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, border: active ? "1.5px solid rgba(0,196,180,0.2)" : "1.5px solid transparent" }}>{active ? <FiCheck size={9} /> : i + 1}</div>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--tx-700)" }}>{s.step}</span>
                    {cur && <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 700, fontFamily: "monospace", color: "#ef4444", background: "rgba(239,68,68,0.08)", padding: "2px 6px", borderRadius: 4, animation: "fadeIn 0.3s ease" }}>{liveLatency}s</span>}
                  </div>
                  <div style={{ marginLeft: 26 }}>
                    <div style={{ fontSize: 10, color: "var(--tx-100)", marginBottom: 1 }}>工具: {s.tool}</div>
                    {active && <><div style={{ fontSize: 10, color: "var(--tx-100)" }}>输入: {s.input}</div><div style={{ fontSize: 10, color: "var(--m-cyan)", fontWeight: 500 }}>输出: {s.output}</div>
                      {metrics && metrics.latency !== "0.0" && <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 5, padding: "4px 7px", background: "linear-gradient(135deg, rgba(239,68,68,0.02) 0%, rgba(239,68,68,0.04) 100%)", borderRadius: 4, border: "1px solid rgba(239,68,68,0.10)", animation: "fadeIn 0.4s cubic-bezier(0.16,1,0.3,1)" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 8, fontWeight: 700, fontFamily: "monospace", color: "#ef4444", background: "rgba(239,68,68,0.10)", padding: "2px 5px", borderRadius: 3, letterSpacing: "0.03em" }}>{metrics.latency}s</span>
                        <span style={{ fontSize: 9, color: "var(--tx-300)", fontWeight: 500 }}>{metrics.detail}</span>
                      </div>}
                    </>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {/* Sources */}
        <div className="m-card" style={{ padding: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--tx-100)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>知识库来源</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {articles?.slice(0, 4).map(a => (
              <div key={a.id} style={{ padding: "4px 6px", borderRadius: 5, background: "var(--bg-hover)", fontSize: 10, display: "flex", alignItems: "center", gap: 5 }}>
                <FiFileText size={9} style={{ color: "var(--m-primary)", flexShrink: 0 }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title.length > 22 ? a.title.substring(0, 22) + "..." : a.title}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
