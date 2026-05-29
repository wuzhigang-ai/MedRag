/**
 * AdminChatPage — 管理端医疗问答
 * Real SSE streaming with Agent tool visualization.
 */
import { useState, useRef, useEffect } from "react";
import { useToast } from "@/providers/toast";
import { useAgentChat } from "@/hooks/useAgentChat";
import {
  FiSend, FiMessageSquare, FiFileText,
  FiCopy, FiActivity, FiCheck, FiSearch, FiClock,
} from "react-icons/fi";

function MdRender({ content }: { content: string }) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let tableRows: string[] = [];
  let inTable = false;

  const flushTable = () => {
    if (tableRows.length < 2) return;
    const headers = tableRows[0].split("|").map((h) => h.trim()).filter(Boolean);
    const dataRows = tableRows.slice(2).map((r) => r.split("|").map((c) => c.trim()).filter(Boolean));
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
    else if (inTable) flushTable();
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

function TypingIndicator() {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <div style={{ width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg,var(--m-primary),var(--m-cyan))", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 9, fontWeight: 700, flexShrink: 0 }}>AI</div>
      <div style={{ padding: "8px 12px", borderRadius: "12px 12px 12px 4px", background: "var(--bg-surface)", border: "1px solid var(--bd-100)" }}>
        <div className="typing-dots" style={{ display: "flex", alignItems: "center", gap: 3, padding: "2px 4px" }}><span /><span /><span /></div>
      </div>
    </div>
  );
}

const quickQs = [
  "LVAD vs IABP 的 30 天死亡率对比？",
  "TBAD的诊断标准是什么？",
  "Stanford A型和B型的治疗策略有何不同？",
  "丙酸血症的遗传模式和临床表现？",
];

export default function AdminChatPage() {
  const toast = useToast();
  const { messages, generating, activeSteps, sendMessage } = useAgentChat();
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    if (!input.trim() || generating) return;
    sendMessage(input);
    setInput("");
  };

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, generating]);
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 100) + "px"; }
  }, [input]);

  const lastAssistantMsg = [...messages].reverse().find((m) => m.role === "assistant");

  return (
    <div style={{ display: "flex", height: "100%", gap: 0 }}>
      {/* Center Chat */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ flex: 1, overflow: "auto", padding: "16px 20px" }}>
          {messages.length === 0 && (
            <div style={{ textAlign: "center", paddingTop: "10vh" }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: "linear-gradient(135deg,#2563EB,#00C4B4)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 18, fontWeight: 800, margin: "0 auto 14px" }}>M</div>
              <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>医疗智能问答验证</h2>
              <p style={{ fontSize: 11, color: "var(--tx-300)", marginBottom: 14 }}>基于 Agentic RAG 的多步推理引擎</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, justifyContent: "center", maxWidth: 500, margin: "0 auto" }}>
                {quickQs.map((q, i) => (
                  <button key={i} onClick={() => { setInput(q); sendMessage(q); }} style={{ fontSize: 11, padding: "5px 10px", borderRadius: 14, border: "1px solid var(--bd-200)", background: "var(--bg-surface)", color: "var(--tx-500)", cursor: "pointer" }}>{q}</button>
                ))}
              </div>
            </div>
          )}
          {messages.map((msg) => (
            <div key={msg.id} style={{ display: "flex", gap: 8, marginBottom: 14, flexDirection: msg.role === "user" ? "row-reverse" : "row", alignItems: "flex-start" }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: msg.role === "user" ? "var(--bg-elevated)" : "linear-gradient(135deg,var(--m-primary),var(--m-cyan))", display: "flex", alignItems: "center", justifyContent: "center", color: msg.role === "user" ? "var(--tx-300)" : "white", fontSize: 9, fontWeight: 700, flexShrink: 0 }}>
                {msg.role === "user" ? "U" : "AI"}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  padding: "8px 12px", borderRadius: msg.role === "user" ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
                  background: msg.role === "user" ? "linear-gradient(135deg,var(--m-primary),var(--m-cyan))" : "var(--bg-surface)",
                  color: msg.role === "user" ? "white" : "var(--tx-700)",
                  border: msg.role === "user" ? "none" : "1px solid var(--bd-100)",
                  boxShadow: "var(--sh-xs)",
                }}>
                  {msg.role === "user" ? <p style={{ margin: 0, fontSize: 12 }}>{msg.content}</p>
                    : msg.content ? <MdRender content={msg.content} />
                    : <TypingIndicator />}
                </div>
                {msg.role === "assistant" && msg.toolSteps.length > 0 && (
                  <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 3 }}>
                    {msg.toolSteps.map((s) => (
                      <span key={s.id} style={{ fontSize: 9, padding: "1px 6px", borderRadius: 8, background: "var(--bg-elevated)", color: "var(--tx-300)", border: "1px solid var(--bd-100)" }}>{s.icon} {s.label}</span>
                    ))}
                    <span style={{ fontSize: 9, padding: "1px 6px", color: "var(--tx-100)" }}><FiClock size={9} style={{ display: "inline" }} /> {msg.elapsed.toFixed(1)}s</span>
                  </div>
                )}
                {msg.role === "assistant" && msg.citations.length > 0 && (
                  <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
                    {msg.citations.map((c, ci) => (
                      <div key={ci} style={{ fontSize: 10, padding: "4px 8px", borderRadius: 5, background: "var(--bg-elevated)", border: "1px solid var(--bd-100)", color: "var(--tx-300)" }}>
                        {c.image_url ? <img src={c.image_url} alt="图表" style={{ maxWidth: "100%", borderRadius: 3, marginBottom: 3 }} /> : null}
                        <span style={{ fontWeight: 600 }}>📄 {c.source || c.title || `来源 ${ci + 1}`}</span>
                        {c.text_preview && <span style={{ fontSize: 9, color: "var(--tx-100)", marginLeft: 6 }}>{c.text_preview.substring(0, 100)}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {generating && (!lastAssistantMsg || !lastAssistantMsg.content) && (
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}><div style={{ width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg,var(--m-primary),var(--m-cyan))", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 9, fontWeight: 700 }}>AI</div><TypingIndicator /></div>
          )}
          <div ref={bottomRef} />
        </div>
        <div style={{ padding: "10px 16px", borderTop: "1px solid var(--bd-100)", background: "var(--bg-surface)" }}>
          <div style={{ display: "flex", gap: 6, alignItems: "flex-end", padding: "3px 8px", borderRadius: 10, border: "1.5px solid var(--bd-200)", background: "var(--bg-base)" }}>
            <textarea ref={textareaRef} value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder="输入医学问题，Enter 发送..." rows={1}
              style={{ flex: 1, border: "none", background: "transparent", color: "var(--tx-700)", fontSize: 12, resize: "none", outline: "none", padding: "5px 0", fontFamily: "inherit" }} />
            <button onClick={handleSend} disabled={!input.trim() || generating}
              style={{ width: 28, height: 28, borderRadius: 7, border: "none", background: input.trim() && !generating ? "var(--m-primary)" : "var(--bg-hover)", color: input.trim() && !generating ? "white" : "var(--tx-100)", cursor: input.trim() && !generating ? "pointer" : "not-allowed", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <FiSend size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* Right Agent Panel */}
      <div style={{ width: 230, minWidth: 230, borderLeft: "1px solid var(--bd-100)", background: "var(--bg-sidebar)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "12px 12px 8px", borderBottom: "1px solid var(--bd-100)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <FiActivity size={12} style={{ color: "var(--m-cyan)" }} />
            <span style={{ fontSize: 11, fontWeight: 700 }}>Agent 推理过程</span>
          </div>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "6px 8px" }}>
          {activeSteps.length === 0 && !generating && messages.length === 0 && (
            <div style={{ padding: 16, textAlign: "center", color: "var(--tx-100)", fontSize: 10 }}>
              <FiSearch size={20} style={{ marginBottom: 6, opacity: 0.4 }} />
              <p>发送问题后显示<br />Agent 推理过程</p>
            </div>
          )}
          {activeSteps.length === 0 && generating && (
            <div style={{ padding: 16, textAlign: "center", color: "var(--tx-100)", fontSize: 10 }}>
              <div style={{ width: 20, height: 20, borderRadius: "50%", border: "2px solid var(--m-primary)", borderTopColor: "transparent", margin: "0 auto 6px" }} className="anim-spin" />
              <p>Agent 分析中...</p>
            </div>
          )}
          {activeSteps.map((s, i) => (
            <div key={s.id} style={{
              padding: "8px 10px", marginBottom: 4, borderRadius: 6,
              background: i === activeSteps.length - 1 ? "var(--bg-surface)" : "transparent",
              border: i === activeSteps.length - 1 ? "1px solid var(--bd-100)" : "1px solid transparent",
              transition: "all 0.3s", animation: "slideInRight 0.3s ease-out",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
                <span style={{ fontSize: 13 }}>{s.icon}</span>
                <span style={{ fontSize: 10, fontWeight: 700 }}>{s.label}</span>
                <span style={{ marginLeft: "auto", fontSize: 8, color: "var(--tx-100)", fontFamily: "monospace" }}>{s.elapsed.toFixed(1)}s</span>
              </div>
              <p style={{ fontSize: 9, color: "var(--tx-300)", margin: "0 0 2px", lineHeight: 1.3 }}>{s.description}</p>
              {s.detail && (
                <div style={{ fontSize: 8, color: "var(--m-cyan)", background: "rgba(0,196,180,0.06)", padding: "2px 4px", borderRadius: 3, lineHeight: 1.3, wordBreak: "break-all" }}>{s.detail}</div>
              )}
            </div>
          ))}
          {!generating && lastAssistantMsg && lastAssistantMsg.toolSteps.length > 0 && (
            <div style={{ padding: "8px 10px", marginTop: 3, borderRadius: 6, background: "rgba(0,196,180,0.05)", border: "1px solid rgba(0,196,180,0.12)" }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: "var(--m-cyan)" }}><FiCheck size={10} style={{ display: "inline" }} /> 完成</div>
              <div style={{ fontSize: 8, color: "var(--tx-300)" }}>{lastAssistantMsg.toolSteps.length} 步 · {lastAssistantMsg.elapsed.toFixed(1)}s · {lastAssistantMsg.citations.length} 引用</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
