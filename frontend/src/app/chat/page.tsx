"use client";

import { CopilotChat } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";
import Link from "next/link";

export default function ChatPage() {
  return (
    <div className="flex h-screen bg-[#0a0a0f]">
      {/* Sidebar */}
      <aside className="w-[300px] border-r border-[#1e293b] bg-[#0a0a0f] flex flex-col shrink-0">
        <div className="p-4 border-b border-[#1e293b]">
          <Link href="/" className="font-display text-xl font-bold text-white no-underline">
            MedASR
          </Link>
          <p className="text-xs text-[#475569] mt-1">Agentic RAG 医学知识平台</p>
        </div>
        <div className="p-4 border-b border-[#1e293b]">
          <Link href="/admin"
            className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[#1e293b]
                       bg-[#14141f] text-[#94a3b8] hover:border-[#3b82f6] hover:text-[#60a5fa]
                       transition-all duration-300 text-sm">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" />
              <rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" />
            </svg>
            管理后台
          </Link>
        </div>
        <div className="flex-1" />
        <div className="p-4 border-t border-[#1e293b]">
          <Link href="/login"
            className="flex items-center gap-2 text-sm text-[#475569] hover:text-[#94a3b8] transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            退出
          </Link>
        </div>
      </aside>

      {/* Chat Area */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="px-6 py-4 border-b border-[#1e293b] bg-[#0a0a0f] flex items-center justify-between shrink-0">
          <h1 className="text-base font-semibold text-[#f1f5f9]">智能问答</h1>
          <span className="text-xs text-[#475569] font-mono">Agentic RAG · 6 Tools · 5 Docs</span>
        </header>
        <div className="flex-1 min-h-0">
          <CopilotChat
            labels={{
              title: "MedASR 医学助手",
              initial: "向 MedASR 提问医学问题。基于 5 篇文献、863 个知识实体的 Agentic RAG 系统。",
              placeholder: "输入医学问题...",
            }}
            className="h-full"
          />
        </div>
      </main>
    </div>
  );
}
