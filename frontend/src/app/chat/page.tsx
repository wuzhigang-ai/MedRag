import MedChat from "@/components/MedChat";
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

        {/* Quick links */}
        <div className="p-4 border-b border-[#1e293b] flex flex-col gap-2">
          <Link
            href="/admin"
            className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[#1e293b]
                       bg-[#14141f] text-[#94a3b8] hover:border-[#3b82f6] hover:text-[#60a5fa]
                       transition-all duration-300 text-sm"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" />
              <rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" />
            </svg>
            管理后台
          </Link>
        </div>

        {/* Agent info */}
        <div className="px-4 py-3">
          <div className="text-xs text-[#475569] space-y-1 font-mono">
            <div className="flex justify-between"><span>引擎</span> <span className="text-[#60a5fa]">FAISS + LightRAG</span></div>
            <div className="flex justify-between"><span>工具</span> <span className="text-[#60a5fa]">6 Tools</span></div>
            <div className="flex justify-between"><span>文献</span> <span className="text-[#60a5fa]">5 篇</span></div>
            <div className="flex justify-between"><span>实体</span> <span className="text-[#60a5fa]">863</span></div>
          </div>
        </div>

        <div className="flex-1" />

        <div className="p-4 border-t border-[#1e293b]">
          <Link
            href="/login"
            className="flex items-center gap-2 text-sm text-[#475569] hover:text-[#94a3b8] transition-colors"
          >
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
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-[#10b981] rounded-full animate-pulse" />
            <span className="text-xs text-[#475569] font-mono">Agent Online</span>
          </div>
        </header>
        <div className="flex-1 min-h-0">
          <MedChat />
        </div>
      </main>
    </div>
  );
}
