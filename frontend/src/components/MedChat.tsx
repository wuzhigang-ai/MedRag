"use client";

import { useChat } from "ai/react";
import { useEffect, useRef, useState } from "react";

export default function MedChat() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: "/api/chat",
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [isFirst, setIsFirst] = useState(true);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 160) + "px";
    }
  }, [input]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    setIsFirst(false);
    handleSubmit(e);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit(e);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4">
        {isFirst && (
          <div className="flex flex-col items-center justify-center h-full text-center px-8">
            <div className="w-16 h-16 rounded-2xl bg-[rgba(59,130,246,.08)] flex items-center justify-center mb-5">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="1.2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-[#f1f5f9] mb-2">向 MedASR 提问医学问题</h2>
            <p className="text-sm text-[#475569] max-w-md leading-relaxed">
              基于 Agentic RAG 的多步推理引擎，自动检索、验证、综合医学证据
            </p>
            <div className="flex flex-wrap gap-2 justify-center mt-5 max-w-lg">
              {["TBAD的诊断标准是什么？", "Stanford A型和B型的治疗策略有何不同？", "急性TBAD降压药物选择"].map((q) => (
                <button
                  key={q}
                  onClick={() => {
                    handleInputChange({ target: { value: q } } as React.ChangeEvent<HTMLInputElement>);
                    setIsFirst(false);
                    setTimeout(() => inputRef.current?.focus(), 50);
                  }}
                  className="px-4 py-2 rounded-full border border-[rgba(255,255,255,.06)] bg-[#14141f] text-xs text-[#94a3b8]
                             hover:border-[#3b82f6] hover:text-white hover:bg-[rgba(59,130,246,.08)] transition-all cursor-pointer"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`mb-5 flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[78%] px-5 py-3.5 rounded-2xl text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-gradient-to-br from-[#3b82f6] to-[#6366f1] text-white rounded-br-md shadow-[0_4px_16px_rgba(59,130,246,.15)]"
                  : "bg-[#14141f] border border-[rgba(255,255,255,.05)] text-[#f1f5f9] rounded-bl-md shadow-[0_2px_8px_rgba(0,0,0,.1)]"
              }`}
            >
              {msg.role === "assistant" ? (
                <div
                  className="prose prose-invert prose-sm max-w-none [&_h1]:text-lg [&_h2]:text-base [&_h2]:border-b [&_h2]:border-[#1e293b] [&_h2]:pb-1 [&_table]:w-full [&_th]:text-left [&_th]:p-2 [&_th]:border-b [&_th]:border-[#1e293b] [&_td]:p-2 [&_td]:border-b [&_td]:border-[#1e293b]/50 [&_code]:bg-[#1a1a2e] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_pre]:bg-[#1a1a2e] [&_pre]:p-3 [&_pre]:rounded-lg"
                  dangerouslySetInnerHTML={{ __html: formatMarkdown(msg.content) }}
                />
              ) : (
                <p>{msg.content}</p>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start mb-5">
            <div className="bg-[#14141f] border border-[rgba(255,255,255,.05)] rounded-2xl rounded-bl-md px-5 py-3.5">
              <div className="flex items-center gap-2 text-sm text-[#60a5fa]">
                <span className="w-2 h-2 bg-[#3b82f6] rounded-full animate-pulse" />
                Agent 分析中...
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-[#1e293b] bg-[#0a0a0f] px-6 py-4 shrink-0">
        <form onSubmit={onSubmit} className="flex items-end gap-3">
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="输入医学问题，按 Enter 发送..."
            rows={1}
            className="flex-1 resize-none px-4 py-3 bg-[#1a1a2e] border border-[#1e293b] rounded-xl
                       text-[#f1f5f9] text-sm leading-relaxed outline-none
                       focus:border-[#3b82f6] focus:ring-2 focus:ring-[rgba(59,130,246,.08)]
                       focus:shadow-[0_0_32px_rgba(59,130,246,.04)]
                       transition-all placeholder:text-[#475569]"
            style={{ minHeight: "48px", maxHeight: "160px" }}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br from-[#3b82f6] to-[#6366f1]
                       flex items-center justify-center text-white
                       hover:shadow-[0_8px_28px_rgba(59,130,246,.44)] hover:-translate-y-0.5
                       disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </form>
        <p className="text-[10px] text-[#334155] mt-3 text-center">MedASR 使用 AI 生成答案，请验证关键信息</p>
      </div>
    </div>
  );
}

/** Quick markdown formatter for inline display */
function formatMarkdown(text: string): string {
  if (!text) return "";
  let html = text
    // Bold
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // Italic
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Inline code
    .replace(/`(.+?)`/g, "<code>$1</code>")
    // Headings
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    // Bold lists
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, "<ul>$&</ul>")
    // Step indicators (🔍)
    .replace(/🔍 (.+)/g, '<span class="text-[#60a5fa] text-xs">🔍 $1</span>')
    // Tables
    .replace(/\|(.+)\|/g, (match) => {
      const cells = match.split("|").filter((c) => c.trim());
      if (cells.every((c) => /^[\s-:]+$/.test(c))) return "";
      return `<tr>${cells.map((c) => `<td>${c.trim()}</td>`).join("")}</tr>`;
    })
    // Line breaks
    .replace(/\n\n/g, "<br/><br/>")
    .replace(/\n/g, "<br/>");

  return html;
}
