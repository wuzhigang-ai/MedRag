import Link from "next/link";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      {/* Nav */}
      <nav className="fixed top-0 inset-x-0 z-50 bg-[rgba(10,10,15,.72)] backdrop-blur-xl border-b border-[rgba(30,41,59,.5)]">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <span className="font-display text-xl font-bold text-white">MedASR</span>
          <div className="flex items-center gap-3">
            <Link href="/login" className="btn btn-secondary text-sm px-4 py-2">登录</Link>
            <Link href="/chat" className="btn btn-primary text-sm px-5 py-2">开始使用</Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="min-h-screen flex items-center justify-center px-6 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none"
          style={{
            background: "radial-gradient(circle at 30% 40%, rgba(59,130,246,.06) 0%, transparent 50%), radial-gradient(circle at 70% 60%, rgba(16,185,129,.04) 0%, transparent 50%)",
          }}
        />
        <div className="max-w-3xl text-center relative z-10">
          <h1 className="font-display text-5xl md:text-6xl font-bold leading-tight mb-6 tracking-tight">
            <span className="bg-gradient-to-r from-[#f1f5f9] to-[#60a5fa] bg-clip-text text-transparent">
              Agentic RAG 医学知识引擎
            </span>
          </h1>
          <p className="text-lg text-[#94a3b8] mb-10 leading-relaxed max-w-xl mx-auto">
            基于 MinerU + BGE-M3 + FAISS + LightRAG 双引擎架构，6工具智能Agent自动检索、交叉验证、综合医学证据。863实体知识图谱实时可视化。
          </p>
          <div className="flex gap-4 justify-center">
            <Link href="/chat" className="btn btn-primary text-base px-8 py-3 rounded-xl">
              开始问答
            </Link>
            <Link href="/admin" className="btn btn-secondary text-base px-8 py-3 rounded-xl">
              管理后台
            </Link>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-4 gap-8 mt-16 max-w-lg mx-auto">
            {[
              ["5", "篇文献"],
              ["863", "知识实体"],
              ["771", "实体关系"],
              ["6", "AI工具"],
            ].map(([n, l]) => (
              <div key={l} className="text-center">
                <div className="font-mono text-2xl font-bold text-[#60a5fa]">{n}</div>
                <div className="text-xs text-[#475569] mt-1">{l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
