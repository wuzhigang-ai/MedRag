/**
 * UserChatPage — 用户端医疗智能问答
 * Real SSE streaming with Agent tool visualization.
 */
import { useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "react-router";
import { useToast } from "@/providers/toast";
import { useTheme } from "@/hooks/useTheme";
import { useAgentChat, type Citation, type ToolStep } from "@/hooks/useAgentChat";
import {
  FiSend, FiPlus, FiMessageSquare, FiFileText,
  FiCopy, FiBookmark, FiActivity, FiDatabase, FiCheck,
  FiSearch, FiImage, FiMic, FiArrowLeft, FiUser,
  FiSun, FiMoon, FiClock,
} from "react-icons/fi";

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

function UserAvatar({ name, size = 32 }: { name: string; size?: number }) {
  const initial = name ? name.charAt(0).toUpperCase() : "U";
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: "linear-gradient(135deg, #2563EB 0%, #00C4B4 50%, #D4A853 100%)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: size * 0.4, fontWeight: 700, flexShrink: 0, boxShadow: "0 0 0 2px var(--bg-base), 0 0 0 4px rgba(212,168,83,0.3)", position: "relative" }}>
      {initial}
      <div style={{ position: "absolute", bottom: 1, right: 1, width: 8, height: 8, borderRadius: "50%", background: "var(--m-green)", border: "2px solid var(--bg-base)", boxShadow: "0 0 4px var(--m-green)" }} />
    </div>
  );
}

const quickQs = [
  "房颤高卒中风险患者的一线抗凝方案？",
  "PD-1抑制剂联合化疗治疗NSCLC的疗效数据？",
  "COVID-19 mRNA疫苗与灭活疫苗的免疫原性对比？",
  "阿尔茨海默病早期诊断的生物标志物？",
];

export default function UserChatPage() {
  const toast = useToast();
  const { theme, toggleTheme } = useTheme();
  const { messages, generating, activeSteps, sendMessage } = useAgentChat();
  const [input, setInput] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const [userName] = useState("用户");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const navigate = useNavigate();

  const handleSend = () => {
    if (!input.trim() || generating) return;
    sendMessage(input);
    setInput("");
  };

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, generating]);
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 120) + "px"; }
  }, [input]);

  const lastAssistantMsg = [...messages].reverse().find((m) => m.role === "assistant");
  const showTyping = generating && (!lastAssistantMsg || !lastAssistantMsg.content);

  return (
    <div style={{ display: "flex", height: "100vh", background: "var(--bg-base)", color: "var(--tx-700)", overflow: "hidden" }}>
      {/* ═── Left Sidebar ─── */}
      <div className="chat-sidebar-user" style={{
        width: sidebarOpen ? 240 : 0, minWidth: sidebarOpen ? 240 : 0,
        transition: "width 0.3s cubic-bezier(0.16,1,0.3,1)", overflow: "hidden",
        borderRight: "1px solid var(--bd-100)", background: "var(--bg-sidebar)",
        display: "flex", flexDirection: "column",
      }}>
        <div style={{ padding: "16px 14px 10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: "linear-gradient(135deg,#2563EB,#00C4B4)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 14, fontWeight: 800 }}>M</div>
            <span style={{ fontSize: 13, fontWeight: 700 }}>MedRAG</span>
          </div>
          <button onClick={() => setSidebarOpen(false)} style={{ background: "none", border: "none", color: "var(--tx-300)", cursor: "pointer", fontSize: 16 }}>×</button>
        </div>
        <button onClick={() => { window.location.reload(); }} className="m-btn m-btn-primary" style={{ margin: "0 14px 12px", height: 34, fontSize: 12 }}>
          <FiPlus size={14} style={{ marginRight: 4 }} /> 新建对话
        </button>
        <div style={{ padding: "0 14px 8px", fontSize: 10, fontWeight: 700, color: "var(--tx-100)", textTransform: "uppercase", letterSpacing: "0.05em" }}>历史对话</div>
        <div style={{ flex: 1, overflow: "auto", padding: "0 8px", fontSize: 12 }}>
          {messages.filter((m) => m.role === "user").slice(0, 10).map((m) => (
            <div key={m.id} style={{ padding: "8px 12px", borderRadius: 6, cursor: "pointer", color: "var(--tx-300)", fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.content.substring(0, 40)}{m.content.length > 40 ? "..." : ""}</div>
          ))}
          {messages.filter((m) => m.role === "user").length === 0 && <div style={{ padding: "8px 12px", color: "var(--tx-100)", fontSize: 11 }}>暂无对话记录</div>}
        </div>
        <div style={{ padding: "12px 14px", borderTop: "1px solid var(--bd-100)", display: "flex", alignItems: "center", gap: 8 }}>
          <UserAvatar name={userName} size={28} />
          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 11, fontWeight: 600 }}>{userName}</div><div style={{ fontSize: 9, color: "var(--m-green)" }}>在线</div></div>
          <button onClick={toggleTheme} style={{ background: "none", border: "none", color: "var(--tx-300)", cursor: "pointer" }}>{theme === "light" ? <FiMoon size={14} /> : <FiSun size={14} />}</button>
          <Link to="/" style={{ color: "var(--tx-300)", fontSize: 12 }}><FiArrowLeft size={14} /></Link>
        </div>
      </div>

      {/* ═── Center Chat ─── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {!sidebarOpen && (
          <button onClick={() => setSidebarOpen(true)} style={{ position: "absolute", top: 12, left: 12, zIndex: 10, width: 32, height: 32, borderRadius: 8, border: "1px solid var(--bd-200)", background: "var(--bg-surface)", color: "var(--tx-300)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>☰</button>
        )}
        <div style={{ flex: 1, overflow: "auto", padding: "16px 20px" }}>
          {messages.length === 0 && (
            <div style={{ textAlign: "center", paddingTop: "15vh" }}>
              <div style={{ width: 52, height: 52, borderRadius: 14, background: "linear-gradient(135deg,#2563EB,#00C4B4)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 22, fontWeight: 800, margin: "0 auto 16px" }}>M</div>
              <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>MedRAG 医疗智能问答</h2>
              <p style={{ fontSize: 12, color: "var(--tx-300)", marginBottom: 18 }}>基于 LightRAG 向量知识图谱，提供可追溯的专业医疗问答</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center", maxWidth: 420, margin: "0 auto" }}>
                {quickQs.map((q, i) => (
                  <button key={i} onClick={() => { setInput(q); sendMessage(q); }} className="m-chip" style={{ fontSize: 11, padding: "6px 12px", borderRadius: 18, border: "1px solid var(--bd-200)", background: "var(--bg-surface)", color: "var(--tx-500)", cursor: "pointer" }}>{q}</button>
                ))}
              </div>
            </div>
          )}
          {messages.map((msg) => (
            <div key={msg.id} style={{ display: "flex", gap: 10, marginBottom: 16, flexDirection: msg.role === "user" ? "row-reverse" : "row", alignItems: "flex-start" }}>
              {msg.role === "assistant" ? (
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,var(--m-primary),var(--m-cyan))", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 10, fontWeight: 700, flexShrink: 0 }}>AI</div>
              ) : (
                <UserAvatar name={userName} size={32} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  padding: "10px 14px", borderRadius: msg.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                  background: msg.role === "user" ? "linear-gradient(135deg,var(--m-primary),var(--m-cyan))" : "var(--bg-surface)",
                  color: msg.role === "user" ? "white" : "var(--tx-700)",
                  border: msg.role === "user" ? "none" : "1px solid var(--bd-100)",
                  boxShadow: "var(--sh-xs)",
                }}>
                  {msg.role === "user" ? (
                    <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>{msg.content}</p>
                  ) : msg.content ? (
                    <MdRender content={msg.content} isUser={false} />
                  ) : (
                    <TypingIndicator />
                  )}
                </div>
                {/* Tool steps summary for assistant */}
                {msg.role === "assistant" && msg.toolSteps.length > 0 && (
                  <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {msg.toolSteps.map((s) => (
                      <span key={s.id} style={{ fontSize: 10, padding: "2px 7px", borderRadius: 10, background: "var(--bg-elevated)", color: "var(--tx-300)", border: "1px solid var(--bd-100)", display: "inline-flex", alignItems: "center", gap: 3 }}>
                        {s.icon} {s.label}
                      </span>
                    ))}
                    <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 10, color: "var(--tx-100)" }}>
                      <FiClock size={10} style={{ display: "inline", marginRight: 2 }} />{msg.elapsed.toFixed(1)}s
                    </span>
                  </div>
                )}
                {/* Citations */}
                {msg.role === "assistant" && msg.citations.length > 0 && (
                  <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                    {msg.citations.map((c, ci) => (
                      <div key={ci} style={{ fontSize: 11, padding: "6px 10px", borderRadius: 6, background: "var(--bg-elevated)", border: "1px solid var(--bd-100)", color: "var(--tx-300)" }}>
                        {c.image_url ? (
                          <img src={c.image_url} alt={c.text_preview || "图表"} style={{ maxWidth: "100%", borderRadius: 4, marginBottom: 4 }} />
                        ) : null}
                        <div style={{ fontWeight: 600, color: "var(--tx-500)", marginBottom: 2 }}>📄 {c.source || c.title || `来源 ${ci + 1}`}</div>
                        {c.text_preview && <div style={{ fontSize: 10, color: "var(--tx-100)", lineHeight: 1.4 }}>{c.text_preview.substring(0, 200)}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {showTyping && (
            <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,var(--m-primary),var(--m-cyan))", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 10, fontWeight: 700, flexShrink: 0 }}>AI</div>
              <TypingIndicator />
            </div>
          )}
          <div ref={bottomRef} />
        </div>
        <div style={{ padding: "12px 20px", borderTop: "1px solid var(--bd-100)", background: "var(--bg-surface)" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", padding: "4px 10px", borderRadius: 12, border: inputFocused ? "1.5px solid var(--m-primary)" : "1.5px solid var(--bd-200)", background: "var(--bg-base)", transition: "border 0.2s" }}>
            <textarea ref={textareaRef} value={input} onChange={(e) => setInput(e.target.value)} onFocus={() => setInputFocused(true)} onBlur={() => setInputFocused(false)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder="输入医学问题，Enter 发送，Shift+Enter 换行..." rows={1}
              style={{ flex: 1, border: "none", background: "transparent", color: "var(--tx-700)", fontSize: 13, resize: "none", outline: "none", padding: "6px 0", fontFamily: "inherit", lineHeight: 1.6 }} />
            <button onClick={handleSend} disabled={!input.trim() || generating}
              style={{ width: 32, height: 32, borderRadius: 9, border: "none", background: input.trim() && !generating ? "var(--m-primary)" : "var(--bg-hover)", color: input.trim() && !generating ? "white" : "var(--tx-100)", display: "flex", alignItems: "center", justifyContent: "center", cursor: input.trim() && !generating ? "pointer" : "not-allowed", transition: "all 0.2s", flexShrink: 0 }}>
              <FiSend size={15} />
            </button>
          </div>
          <p style={{ fontSize: 10, color: "var(--tx-100)", textAlign: "center", marginTop: 6 }}>MedRAG 使用 AI 生成答案，请务必验证关键信息</p>
        </div>
      </div>

      {/* ═── Right Agent Panel ─── */}
      <div style={{
        width: 260, minWidth: 260, borderLeft: "1px solid var(--bd-100)",
        background: "var(--bg-sidebar)", display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}>
        <div style={{ padding: "14px 14px 10px", borderBottom: "1px solid var(--bd-100)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <FiActivity size={14} style={{ color: "var(--m-cyan)" }} />
            <span style={{ fontSize: 12, fontWeight: 700 }}>Agent 推理过程</span>
          </div>
          <p style={{ fontSize: 10, color: "var(--tx-100)", marginTop: 2 }}>实时展示多步推理工具调用</p>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "8px 10px" }}>
          {activeSteps.length === 0 && !generating && messages.length === 0 && (
            <div style={{ padding: 20, textAlign: "center", color: "var(--tx-100)", fontSize: 11 }}>
              <FiSearch size={24} style={{ marginBottom: 8, opacity: 0.4 }} />
              <p>发送问题后将显示<br />Agent 推理过程</p>
            </div>
          )}
          {activeSteps.length === 0 && generating && (
            <div style={{ padding: 20, textAlign: "center", color: "var(--tx-100)", fontSize: 11 }}>
              <div style={{ width: 24, height: 24, borderRadius: "50%", border: "2px solid var(--m-primary)", borderTopColor: "transparent", margin: "0 auto 8px" }} className="anim-spin" />
              <p>Agent 分析中...</p>
            </div>
          )}
          {activeSteps.map((s, i) => (
            <div key={s.id} style={{
              padding: "10px 12px", marginBottom: 6, borderRadius: 8,
              background: i === activeSteps.length - 1 ? "var(--bg-surface)" : "transparent",
              border: i === activeSteps.length - 1 ? "1px solid var(--bd-100)" : "1px solid transparent",
              boxShadow: i === activeSteps.length - 1 ? "var(--sh-xs)" : "none",
              transition: "all 0.3s",
              animation: "slideInRight 0.3s ease-out",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 16 }}>{s.icon}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--tx-700)" }}>{s.label}</span>
                <span style={{ marginLeft: "auto", fontSize: 9, color: "var(--tx-100)", fontFamily: "monospace" }}>{s.elapsed.toFixed(1)}s</span>
              </div>
              <p style={{ fontSize: 10, color: "var(--tx-300)", margin: "0 0 4px", lineHeight: 1.4 }}>{s.description}</p>
              {s.detail && (
                <div style={{ fontSize: 9, color: "var(--m-cyan)", background: "rgba(0,196,180,0.06)", padding: "3px 6px", borderRadius: 4, lineHeight: 1.4, wordBreak: "break-all" }}>
                  {s.detail}
                </div>
              )}
            </div>
          ))}
          {!generating && lastAssistantMsg && lastAssistantMsg.toolSteps.length > 0 && (
            <div style={{ padding: "10px 12px", marginTop: 4, borderRadius: 8, background: "rgba(0,196,180,0.05)", border: "1px solid rgba(0,196,180,0.12)" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--m-cyan)", marginBottom: 3, display: "flex", alignItems: "center", gap: 4 }}>
                <FiCheck size={12} /> 推理完成
              </div>
              <div style={{ fontSize: 9, color: "var(--tx-300)" }}>
                {lastAssistantMsg.toolSteps.length} 步推理 · {lastAssistantMsg.elapsed.toFixed(1)}s · {lastAssistantMsg.citations.length} 引用
              </div>
            </div>
          )}
        </div>
        <div style={{ padding: "10px 14px", borderTop: "1px solid var(--bd-100)", fontSize: 10, color: "var(--tx-100)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>系统正常</span>
            <span style={{ color: "var(--m-green)" }}>●</span>
          </div>
        </div>
      </div>
    </div>
  );
}
