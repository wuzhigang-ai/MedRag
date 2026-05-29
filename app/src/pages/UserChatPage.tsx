import { useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "@/lib/api";
import { useToast } from "@/providers/toast";
import { useTheme } from "@/hooks/useTheme";
import {
  FiSend, FiPlus, FiMessageSquare, FiFileText,
  FiCopy, FiBookmark, FiActivity, FiDatabase, FiCheck,
  FiSearch, FiImage, FiMic, FiArrowLeft, FiUser,
  FiSun, FiMoon,
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
  latency: string; tokens: number; confidence: string;
}

// ── Real tool → display step mapping ──
const TOOL_DISPLAY: Record<string, { label: string; desc: string; output: string }> = {
  search_rag: { label: "双路检索", desc: "FAISS关键词向量检索 + LightRAG自然语言图谱检索", output: "召回文献片段" },
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

function toolToRagStep(toolName: string, idx: number, elapsed: number): RagStep {
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
function MdRender({ content, isUser }: { content: string; isUser: boolean }) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let tableRows: string[] = [];
  let inTable = false;

  const flushTable = () => {
    if (tableRows.length < 2) return;
    const headers = tableRows[0].split("|").map((h) => h.trim()).filter(Boolean);
    const dataRows = tableRows.slice(2).map((r) => r.split("|").map((c) => c.trim()).filter(Boolean));
    elements.push(
      <div key={`table-${elements.length}`} style={{ overflow: "auto", margin: "8px 0", borderRadius: 8, border: "1px solid var(--bd-100)" }}>
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
    else if (inTable) flushTable();
    if (line.startsWith("## ")) elements.push(<h3 key={i} style={{ fontSize: 14, fontWeight: 700, margin: "10px 0 4px", color: isUser ? "white" : "var(--tx-900)" }}>{line.replace("## ", "")}</h3>);
    else if (line.startsWith("### ")) elements.push(<h4 key={i} style={{ fontSize: 13, fontWeight: 600, margin: "8px 0 3px", color: isUser ? "rgba(255,255,255,0.9)" : "var(--tx-700)" }}>{line.replace("### ", "")}</h4>);
    else if (line.startsWith("> ")) elements.push(<blockquote key={i} style={{ borderLeft: "2px solid var(--m-cyan)", paddingLeft: 8, color: isUser ? "rgba(255,255,255,0.8)" : "var(--tx-300)", fontSize: 11, margin: "6px 0", lineHeight: 1.6 }}>{line.replace("> ", "")}</blockquote>);
    else if (line.trim() === "---") elements.push(<hr key={i} style={{ border: "none", borderTop: "1px solid var(--bd-100)", margin: "8px 0" }} />);
    else if (line.trim() === "") elements.push(<div key={i} style={{ height: 3 }} />);
    else if (line.startsWith("- ")) elements.push(<li key={i} style={{ marginLeft: 14, fontSize: 12, color: isUser ? "rgba(255,255,255,0.9)" : "var(--tx-500)", lineHeight: 1.7 }}>{line.replace("- ", "")}</li>);
    else if (/^\d+\.\s/.test(line)) elements.push(<li key={i} style={{ marginLeft: 14, fontSize: 12, color: isUser ? "rgba(255,255,255,0.9)" : "var(--tx-500)", lineHeight: 1.7 }}>{line.replace(/^\d+\.\s/, "")}</li>);
    else elements.push(<p key={i} style={{ fontSize: 12, color: isUser ? "rgba(255,255,255,0.9)" : "var(--tx-500)", lineHeight: 1.7 }}>{line}</p>);
  });
  if (inTable) flushTable();
  return <>{elements}</>;
}

/* ── Typing Indicator ── */
function TypingIndicator() {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,var(--m-primary),var(--m-cyan))", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 10, fontWeight: 700, flexShrink: 0 }}>AI</div>
      <div style={{ padding: "10px 14px", borderRadius: "14px 14px 14px 4px", background: "var(--bg-surface)", border: "1px solid var(--bd-100)", boxShadow: "var(--sh-xs)" }}>
        <div className="typing-dots" style={{ display: "flex", alignItems: "center", gap: 3, padding: "4px 8px" }}><span /><span /><span /></div>
      </div>
    </div>
  );
}

/* ── Premium User Avatar ── */
function UserAvatar({ name, size = 32 }: { name: string; size?: number }) {
  const initial = name ? name.charAt(0).toUpperCase() : "U";
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: "linear-gradient(135deg, #2563EB 0%, #00C4B4 50%, #D4A853 100%)",
      display: "flex", alignItems: "center", justifyContent: "center",
      color: "white", fontSize: size * 0.4, fontWeight: 700,
      flexShrink: 0,
      boxShadow: "0 0 0 2px var(--bg-base), 0 0 0 4px rgba(212,168,83,0.3), 0 2px 8px rgba(37,99,235,0.2)",
      position: "relative",
    }}>
      {initial}
      {/* Online dot */}
      <div style={{
        position: "absolute", bottom: 1, right: 1,
        width: 8, height: 8, borderRadius: "50%",
        background: "var(--m-green)",
        border: "2px solid var(--bg-base)",
        boxShadow: "0 0 4px var(--m-green)",
      }} />
    </div>
  );
}

export default function UserChatPage() {
  const toast = useToast();
  const { theme, toggleTheme } = useTheme();
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [generating, setGenerating] = useState(false);
  const [trace, setTrace] = useState<RagStep[]>([]);
  const [stepMetrics, setStepMetrics] = useState<Record<number, StepMetrics>>({});
  const [activeStep, setActiveStep] = useState<number>(-1);
  const [inputFocused, setInputFocused] = useState(false);
  const [userName, setUserName] = useState("用户");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const navigate = useNavigate();

  const [articles] = useState<any[]>([]);

  // Route guard: redirect to login if not authenticated
  useEffect(() => {
    const user = localStorage.getItem("medrag_user");
    if (!user) {
      navigate("/login", { replace: true });
      return;
    }
    try {
      const u = JSON.parse(user);
      setUserName(u.name || u.email?.split("@")[0] || "用户");
    } catch { /* ignore */ }
  }, [navigate]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, generating]);
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 120) + "px"; }
  }, [input]);

  const handleSend = async () => {
    if (!input.trim() || generating) return;
    const question = input.trim();
    const userMsg: Msg = { id: Date.now(), role: "user", content: question };
    setMsgs((p) => [...p, userMsg]);
    setInput("");
    setGenerating(true);
    setTrace([]);
    setStepMetrics({});
    setActiveStep(-1);

    const t0 = Date.now();
    const aiMsgId = Date.now() + 1;
    const collected: RagStep[] = [];
    let aiContent = "";
    let aiCitations: Msg["citations"] = [];

    try {
      await api.streamAgent(
        question,
        // onStep — fires as each tool completes
        (data: any) => {
          const toolName = data.tool || "unknown";
          const step: RagStep = toolToRagStep(toolName, collected.length, data.elapsed || 0);
          collected.push(step);
          setTrace([...collected]);
          setActiveStep(collected.length - 1);
          setStepMetrics((p) => ({
            ...p,
            [collected.length - 1]: {
              latency: ((data.elapsed || 0) - (collected.length > 1 ? (p[collected.length - 2]?.latency ? parseFloat(p[collected.length - 2].latency) : 0) : 0)).toFixed(2) || "0.05",
              tokens: 0,
              confidence: "0.95",
            },
          }));
        },
        // onAnswer — fires when stream completes with answer
        (data: any) => {
          aiContent = data.answer || "";
          aiCitations = (data.sources || []).map((s: any) => ({
            articleId: 0,
            articleTitle: s.source || s.title || String(s),
            content: s.text_preview || "",
          }));
        },
        // onError
        (err: string) => { aiContent = `抱歉，处理请求时出错: ${err}`; },
        // onDone
        () => {}
      );
    } catch (err: any) {
      aiContent = `连接失败: ${err.message || "未知错误"}`;
    }

    if (!aiContent) aiContent = "Agent 推理完成，但未能生成回答。请重试。";
    setMsgs((p) => [...p, { id: aiMsgId, role: "assistant", content: aiContent, citations: aiCitations }]);
    setGenerating(false);
  };

  const copyContent = (content: string) => {
    navigator.clipboard.writeText(content);
    toast.success("已复制到剪贴板");
  };

  return (
    <div style={{ display: "flex", height: "100vh", background: "var(--bg-base)", color: "var(--tx-700)", overflow: "hidden" }}>
      {/* ═── Left Sidebar ─── */}
      <div style={{ width: 240, flexShrink: 0, display: "flex", flexDirection: "column", gap: 8, padding: 10, borderRight: "1px solid var(--bd-100)", background: "var(--bg-sidebar)" }}>
        {/* Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px" }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, background: "linear-gradient(135deg,#2563EB,#00C4B4)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 14, fontWeight: 800, flexShrink: 0 }}>M</div>
          <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.01em", color: "var(--tx-900)" }}>MedRAG</span>
        </div>

        {/* New Chat */}
        <button onClick={() => setMsgs([])} className="m-btn m-btn-primary m-btn-sm" style={{ width: "100%", marginTop: 4 }}>
          <FiPlus size={13} /> 新建对话
        </button>

        {/* KB Articles — inline without header */}
        <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 4 }}>
          {articles?.slice(0, 6).map((a) => (
            <div key={a.id} style={{ padding: "5px 7px", borderRadius: 6, fontSize: 11, display: "flex", alignItems: "center", gap: 6, color: "var(--tx-300)", cursor: "pointer", transition: "all 0.15s" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <FiFileText size={11} style={{ color: "var(--m-primary)", flexShrink: 0 }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title.length > 24 ? a.title.substring(0, 24) + "..." : a.title}</span>
            </div>
          ))}
        </div>

        {/* History */}
        <div style={{ marginTop: 4, flex: 1, overflow: "auto" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--tx-100)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6, padding: "0 6px" }}>历史对话</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {sessions?.map((s) => (
              <div key={s.id} style={{ padding: "5px 7px", borderRadius: 6, fontSize: 11, display: "flex", alignItems: "center", gap: 6, color: "var(--tx-300)", cursor: "pointer", transition: "all 0.15s" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <FiMessageSquare size={11} style={{ flexShrink: 0 }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{s.title}</span>
              </div>
            ))}
          </div>
        </div>

        {/* User Profile */}
        <div style={{ padding: "10px 8px", borderTop: "1px solid var(--bd-100)", display: "flex", alignItems: "center", gap: 10 }}>
          <UserAvatar name={userName} size={36} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--tx-700)" }}>{userName}</div>
            <div style={{ fontSize: 10, color: "var(--tx-100)", display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--m-green)", boxShadow: "0 0 4px var(--m-green)" }} />在线
            </div>
          </div>
          <button
            onClick={toggleTheme}
            title={theme === "light" ? "切换深色模式" : "切换浅色模式"}
            style={{
              width: 30, height: 30, borderRadius: 8,
              border: "1px solid var(--bd-200)",
              background: "var(--bg-surface)",
              color: "var(--tx-300)",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", transition: "all 0.2s", flexShrink: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--tx-700)"; e.currentTarget.style.borderColor = "var(--m-primary)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--tx-300)"; e.currentTarget.style.borderColor = "var(--bd-200)"; }}
          >
            {theme === "light" ? <FiMoon size={14} /> : <FiSun size={14} />}
          </button>
          <Link to="/" style={{ color: "var(--tx-100)", textDecoration: "none", padding: 4 }} title="返回首页">
            <FiArrowLeft size={14} />
          </Link>
        </div>
      </div>

      {/* ═── Center Chat ─── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, background: "var(--bg-surface)", borderRadius: 0, overflow: "hidden" }}>
        {/* Header */}
        <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--bd-100)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, background: "var(--bg-base)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--tx-900)" }}>医疗智能问答</h2>
            <span className="m-badge m-tag-cyan" style={{ fontSize: 9 }}>LightRAG 驱动</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--tx-100)" }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--m-green)", boxShadow: "0 0 4px var(--m-green)" }} />
            系统正常
          </div>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflow: "auto", padding: "16px" }}>
          {msgs.length === 0 ? (
            <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 20px" }}>
              <div style={{ width: 56, height: 56, borderRadius: 16, background: "linear-gradient(135deg,var(--m-primary),var(--m-cyan))", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 28, fontWeight: 800, marginBottom: 16, boxShadow: "var(--sh-lg)" }}>M</div>
              <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6, color: "var(--tx-900)" }}>MedRAG 医疗智能问答</h2>
              <p style={{ fontSize: 13, color: "var(--tx-100)", marginBottom: 24, textAlign: "center" }}>基于 LightRAG 向量知识图谱，提供可溯源的专业医疗问答</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, maxWidth: 480, width: "100%" }}>
                {quickQs.map((q, i) => (
                  <button key={i} onClick={() => setInput(q)} style={{ padding: "12px 14px", borderRadius: 12, border: "1.5px solid var(--bd-200)", background: "var(--bg-elevated)", color: "var(--tx-300)", fontSize: 12, textAlign: "left", cursor: "pointer", transition: "all 0.2s", lineHeight: 1.5 }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--m-cyan)"; e.currentTarget.style.boxShadow = "var(--sh-sm)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--bd-200)"; e.currentTarget.style.boxShadow = "none"; }}
                  >{q}</button>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", gap: 18 }}>
              {msgs.map((msg) => (
                <div key={msg.id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  {msg.role === "user" ? (
                    <UserAvatar name={userName} size={32} />
                  ) : (
                    <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,var(--m-primary),var(--m-cyan))", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 10, fontWeight: 700, flexShrink: 0 }}>AI</div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      padding: "10px 14px", borderRadius: msg.role === "user" ? "4px 14px 14px 14px" : "14px 4px 14px 14px",
                      background: msg.role === "user" ? "var(--m-primary)" : "var(--bg-elevated)",
                      color: msg.role === "user" ? "white" : "var(--tx-700)",
                      border: msg.role === "user" ? "none" : "1px solid var(--bd-100)",
                      boxShadow: msg.role === "user" ? "none" : "var(--sh-xs)",
                    }}>
                      <MdRender content={msg.content} isUser={msg.role === "user"} />
                    </div>
                    {msg.role === "assistant" && msg.citations && msg.citations.length > 0 && (
                      <div style={{ marginTop: 6, padding: 10, borderRadius: 8, background: "rgba(37,99,235,0.03)", border: "1px solid rgba(37,99,235,0.06)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6, fontSize: 11, fontWeight: 700, color: "var(--m-primary)" }}>
                          <FiDatabase size={10} /> 文献溯源
                        </div>
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
        <div style={{ padding: "10px 16px", borderTop: "1px solid var(--bd-100)", flexShrink: 0, background: "var(--bg-base)" }}>
          <div style={{ maxWidth: 720, margin: "0 auto" }}>
            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              {[
                { icon: <FiFileText size={13} />, label: "PDF", bg: "rgba(37,99,235,0.08)", color: "var(--m-primary)", border: "rgba(37,99,235,0.15)" },
                { icon: <FiImage size={13} />, label: "图片", bg: "rgba(0,196,180,0.08)", color: "var(--m-cyan)", border: "rgba(0,196,180,0.15)" },
                { icon: <FiMic size={13} />, label: "语音", bg: "rgba(212,168,83,0.08)", color: "var(--m-gold)", border: "rgba(212,168,83,0.15)" },
              ].map((b, i) => (
                <button key={i} style={{ padding: "5px 12px", fontSize: 11, color: b.color, background: b.bg, border: `1.5px solid ${b.border}`, borderRadius: 8, display: "flex", alignItems: "center", gap: 5, cursor: "pointer", transition: "all 0.2s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "var(--sh-sm)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "none"; }}
                >{b.icon} {b.label}</button>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 6, padding: "6px 8px 6px 12px", background: "var(--bg-surface)", borderRadius: 12, border: `1.5px solid ${inputFocused ? "var(--m-cyan)" : "var(--bd-200)"}`, boxShadow: inputFocused ? "0 0 0 3px rgba(0,196,180,0.08)" : "none", transition: "all 0.25s" }}>
              <textarea ref={textareaRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }} onFocus={() => setInputFocused(true)} onBlur={() => setInputFocused(false)} placeholder="输入医疗问题，支持多模态..." style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--tx-700)", fontSize: 13, resize: "none", maxHeight: 120, minHeight: 22, lineHeight: 1.5, fontFamily: "inherit" }} rows={1} />
              <button onClick={handleSend} disabled={!input.trim() || generating} style={{ width: 32, height: 32, borderRadius: 9, border: "none", background: input.trim() && !generating ? "var(--m-primary)" : "var(--bg-hover)", color: input.trim() && !generating ? "white" : "var(--tx-100)", display: "flex", alignItems: "center", justifyContent: "center", cursor: input.trim() && !generating ? "pointer" : "not-allowed", transition: "all 0.2s", flexShrink: 0 }}>
                <FiSend size={15} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ═── Right Agent Panel ─── */}
      <div style={{ width: 260, flexShrink: 0, display: "flex", flexDirection: "column", gap: 8, padding: 10, borderLeft: "1px solid var(--bd-100)", background: "var(--bg-sidebar)" }}>
        <div className="m-card" style={{ padding: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <FiActivity size={13} style={{ color: "var(--m-cyan)" }} />
            <span style={{ fontSize: 12, fontWeight: 700 }}>Agent 推理过程</span>
          </div>
        </div>

        <div className="m-card" style={{ flex: 1, overflow: "auto", padding: 10 }}>
          {trace.length === 0 && !generating && (
            <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "var(--tx-100)", fontSize: 11, textAlign: "center", gap: 6 }}>
              <FiSearch size={20} />
              <p>发送问题后将显示<br />Agent 推理过程</p>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {trace.map((s, i) => {
              const active = i < trace.length;
              const cur = i === activeStep && generating;
              const metrics = stepMetrics[i];
              // Only render if this step has been reached
              if (!active && !cur && generating && i > activeStep) return null;
              if (!active && !generating) return null;
              return (
                <div key={i} style={{
                  padding: 8, borderRadius: 8,
                  background: active ? "var(--bg-surface)" : "var(--bg-hover)",
                  border: `1.5px solid ${cur ? "rgba(0,196,180,0.30)" : active ? "var(--bd-100)" : "transparent"}`,
                  opacity: active || cur ? 1 : 0.4,
                  transition: "all 0.4s var(--ease-out-expo)",
                  position: "relative",
                  overflow: "hidden",
                  animation: active ? "fadeIn 0.4s ease" : "none",
                }}>
                  {cur && metrics && (
                    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, var(--m-cyan), var(--m-primary))", animation: "pulseGlow 1.5s ease-in-out infinite" }} />
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: metrics ? 6 : 4 }}>
                    <div style={{ width: 20, height: 20, borderRadius: "50%", background: active ? "rgba(0,196,180,0.12)" : "var(--bg-hover)", color: active ? "var(--m-cyan)" : "var(--tx-100)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, border: active ? "1.5px solid rgba(0,196,180,0.2)" : "1.5px solid transparent" }}>
                      {active ? <FiCheck size={9} /> : i + 1}
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--tx-700)" }}>{s.step}</span>
                    {cur && metrics && (
                      <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 600, fontFamily: "monospace", color: "var(--m-cyan)", background: "rgba(0,196,180,0.08)", padding: "1px 5px", borderRadius: 4, animation: "fadeIn 0.3s ease" }}>
                        {metrics.latency}s
                      </span>
                    )}
                  </div>
                  <div style={{ marginLeft: 26 }}>
                    <div style={{ fontSize: 10, color: "var(--tx-100)", marginBottom: 1 }}>工具: {s.tool}</div>
                    {active && (
                      <>
                        <div style={{ fontSize: 10, color: "var(--tx-100)" }}>输入: {s.input}</div>
                        <div style={{ fontSize: 10, color: "var(--m-cyan)", fontWeight: 500 }}>输出: {s.output}</div>
                        {metrics && (
                          <div style={{ display: "flex", gap: 8, marginTop: 4, padding: "3px 6px", background: "rgba(0,196,180,0.04)", borderRadius: 4, border: "1px solid rgba(0,196,180,0.08)" }}>
                            <span style={{ fontSize: 9, fontFamily: "monospace", color: "var(--tx-100)" }}><span style={{ opacity: 0.6 }}>耗时</span> <span style={{ color: "var(--m-cyan)", fontWeight: 600 }}>{metrics.latency}s</span></span>
                            <span style={{ fontSize: 9, fontFamily: "monospace", color: "var(--tx-100)" }}><span style={{ opacity: 0.6 }}>tokens</span> <span style={{ color: "var(--m-primary)", fontWeight: 600 }}>{metrics.tokens}</span></span>
                            <span style={{ fontSize: 9, fontFamily: "monospace", color: "var(--tx-100)" }}><span style={{ opacity: 0.6 }}>置信</span> <span style={{ color: "var(--m-green)", fontWeight: 600 }}>{metrics.confidence}</span></span>
                          </div>
                        )}
                      </>
                    )}
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
            {articles?.slice(0, 4).map((a) => (
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
