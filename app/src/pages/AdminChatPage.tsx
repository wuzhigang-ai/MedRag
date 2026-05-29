import { useState, useRef, useEffect } from "react";
import { trpc } from "@/providers/trpc";
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
  latency: string; tokens: number; confidence: string;
}

const generateMetrics = () => ({
  latency: (Math.random() * 0.8 + 0.05).toFixed(2),
  tokens: Math.floor(Math.random() * 2048 + 256),
  confidence: (Math.random() * 0.3 + 0.7).toFixed(2),
});

const ragSteps: RagStep[] = [
  { step: "查询理解", tool: "QueryAnalyzer", input: "解析意图", output: "医疗查询", desc: "分析用户查询意图" },
  { step: "向量检索", tool: "VectorSearch", input: "嵌入向量", output: "召回Top-5", desc: "从向量库检索相关文档" },
  { step: "语义重排", tool: "Reranker", input: "候选片段", output: "相关性排序", desc: "对检索结果重新排序" },
  { step: "证据筛选", tool: "EvidenceFilter", input: "排序结果", output: "高置信度", desc: "筛选高置信度证据" },
  { step: "答案生成", tool: "LLM", input: "证据+查询", output: "专业回答", desc: "生成专业医学回答" },
];

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

  const flushTable = () => {
    if (tableRows.length < 2) return;
    const headers = tableRows[0].split("|").map(h => h.trim()).filter(Boolean);
    const dataRows = tableRows.slice(2).map(r => r.split("|").map(c => c.trim()).filter(Boolean));
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

  const { data: articles } = trpc.articles.list.useQuery({ status: "approved" });

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
    const userMsg: Msg = { id: Date.now(), role: "user", content: input };
    setMsgs(p => [...p, userMsg]);
    setInput("");
    setGenerating(true);
    setTrace([]);
    setStepMetrics({});
    setActiveStep(-1);

    for (let i = 0; i < ragSteps.length; i++) {
      setActiveStep(i);
      const metrics = generateMetrics();
      setStepMetrics(p => ({ ...p, [i]: metrics }));
      await new Promise(r => setTimeout(r, 500 + Math.random() * 300));
      setTrace(p => [...p, ragSteps[i]]);
    }

    const q = userMsg.content.toLowerCase();
    let resp = "", citations: Msg["citations"] = [];
    if (q.includes("房颤")) {
      resp = `## 房颤合并高卒中风险患者的一线抗凝方案\n\n### 推荐方案\n\n**首选：新型口服抗凝药（NOAC）**\n- 达比加群酯 150mg bid\n- 利伐沙班 20mg qd\n- 艾多沙班 60mg qd\n- 阿哌沙班 5mg bid\n\n### 循证依据\n\n| 终点 | NOAC | 华法林 | HR (95% CI) |\n|------|------|--------|-------------|\n| 卒中/栓塞 | 1.5%/年 | 3.0%/年 | 0.51 (0.40-0.65) |\n| 大出血 | 2.1%/年 | 3.0%/年 | 0.70 (0.58-0.85) |\n| 颅内出血 | 0.3%/年 | 0.9%/年 | 0.33 (0.22-0.50) |`;
      citations = [{ articleId: 1, articleTitle: "Efficacy and Safety of Novel Anticoagulant in AF: RCT", content: "NOAC-X demonstrated superiority over warfarin." }];
    } else if (q.includes("肺癌") || q.includes("nsclc")) {
      resp = `## PD-1/PD-L1抑制剂联合化疗用于晚期NSCLC\n\n### 疗效数据\n\n| 指标 | 免疫+化疗 | 单纯化疗 | HR/OR |\n|------|----------|---------|-------|\n| 中位OS | 24.8月 | 16.2月 | HR 0.72 |\n| 中位PFS | 9.2月 | 5.8月 | HR 0.58 |\n| ORR | 52.4% | 32.1% | OR 1.63 |`;
      citations = [{ articleId: 2, articleTitle: "Immunotherapy for Advanced NSCLC: Meta-Analysis", content: "Pembrolizumab plus chemotherapy improved OS." }];
    } else {
      resp = `## 综合建议\n\n根据知识库中已入库的 **${articles?.length ?? 0} 篇** 医疗文献分析：\n\n1. **完善评估** — 进行必要的实验室检查\n2. **风险评估** — 使用 validated 评分工具\n3. **制定方案** — 基于指南推荐制定治疗计划\n4. **随访监测** — 建立规范随访体系\n\n> 本回答仅供医疗专业人员参考。\n\n---\n*免责声明：不构成具体诊疗建议。*`;
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
            {ragSteps.map((s, i) => {
              const active = i < trace.length;
              const cur = i === activeStep && generating;
              const metrics = stepMetrics[i];
              if (!active && !cur && generating && i > activeStep) return null;
              if (!active && !generating) return null;
              return (
                <div key={i} style={{ padding: 8, borderRadius: 8, background: active ? "var(--bg-surface)" : "var(--bg-hover)", border: `1.5px solid ${cur ? "rgba(0,196,180,0.30)" : active ? "var(--bd-100)" : "transparent"}`, transition: "all 0.4s", position: "relative", overflow: "hidden", animation: active ? "fadeIn 0.4s ease" : "none" }}>
                  {cur && metrics && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: "linear-gradient(90deg, var(--m-cyan), var(--m-primary))", animation: "pulseGlow 1.5s ease-in-out infinite" }} />}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: metrics ? 6 : 4 }}>
                    <div style={{ width: 20, height: 20, borderRadius: "50%", background: active ? "rgba(0,196,180,0.12)" : "var(--bg-hover)", color: active ? "var(--m-cyan)" : "var(--tx-100)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, border: active ? "1.5px solid rgba(0,196,180,0.2)" : "1.5px solid transparent" }}>{active ? <FiCheck size={9} /> : i + 1}</div>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--tx-700)" }}>{s.step}</span>
                    {cur && metrics && <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 600, fontFamily: "monospace", color: "var(--m-cyan)", background: "rgba(0,196,180,0.08)", padding: "1px 5px", borderRadius: 4, animation: "fadeIn 0.3s ease" }}>{metrics.latency}s</span>}
                  </div>
                  <div style={{ marginLeft: 26 }}>
                    <div style={{ fontSize: 10, color: "var(--tx-100)", marginBottom: 1 }}>工具: {s.tool}</div>
                    {active && <><div style={{ fontSize: 10, color: "var(--tx-100)" }}>输入: {s.input}</div><div style={{ fontSize: 10, color: "var(--m-cyan)", fontWeight: 500 }}>输出: {s.output}</div>
                      {metrics && <div style={{ display: "flex", gap: 6, marginTop: 4, padding: "3px 6px", background: "rgba(0,196,180,0.04)", borderRadius: 4, border: "1px solid rgba(0,196,180,0.08)" }}>
                        <span style={{ fontSize: 9, fontFamily: "monospace", color: "var(--tx-100)" }}><span style={{ opacity: 0.6 }}>耗时</span> <span style={{ color: "var(--m-cyan)", fontWeight: 600 }}>{metrics.latency}s</span></span>
                        <span style={{ fontSize: 9, fontFamily: "monospace", color: "var(--tx-100)" }}><span style={{ opacity: 0.6 }}>tokens</span> <span style={{ color: "var(--m-primary)", fontWeight: 600 }}>{metrics.tokens}</span></span>
                        <span style={{ fontSize: 9, fontFamily: "monospace", color: "var(--tx-100)" }}><span style={{ opacity: 0.6 }}>置信</span> <span style={{ color: "var(--m-green)", fontWeight: 600 }}>{metrics.confidence}</span></span>
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
