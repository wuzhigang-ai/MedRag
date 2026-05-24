"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { backend, GraphData, KBStatus } from "@/lib/backend";

export default function AdminPage() {
  const [status, setStatus] = useState<KBStatus | null>(null);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [files, setFiles] = useState<Array<{ name: string; status: string }>>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    backend.getStatus().then(setStatus).catch(console.error);
    backend.getGraph().then(setGraph).catch(console.error);
    backend.getFiles().then((d) => setFiles(d.files || [])).catch(console.error);
    const interval = setInterval(() => backend.getStatus().then(setStatus), 10000);
    return () => clearInterval(interval);
  }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await backend.uploadPDF(file);
    } catch (err) {
      console.error(err);
    }
    setUploading(false);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex">
      {/* Sidebar */}
      <aside className="w-64 border-r border-[#1e293b] bg-[#0a0a0f] flex flex-col shrink-0 p-4 gap-2">
        <Link href="/" className="font-display text-xl font-bold text-white no-underline mb-4">MedASR</Link>
        <NavItem href="/admin" active>仪表盘</NavItem>
        <NavItem href="/chat">智能问答</NavItem>
        <div className="mt-auto">
          <Link href="/login" className="flex items-center gap-2 text-sm text-[#475569] hover:text-[#94a3b8] transition-colors py-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            退出
          </Link>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 p-8 overflow-y-auto">
        <h1 className="text-2xl font-bold mb-8">管理后台</h1>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-5 mb-8">
          <StatCard label="文本块" value={status?.total_chunks || 0} />
          <StatCard label="文献" value={status?.total_documents || 0} />
          <StatCard label="知识实体" value={graph?.stats.total_nodes || 0} />
          <StatCard label="实体关系" value={graph?.stats.total_edges || 0} />
        </div>

        {/* Knowledge Graph */}
        <div className="glass p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">知识图谱</h2>
            <Link href="/admin/graph" className="btn btn-secondary text-sm px-4 py-2">
              查看3D图谱
            </Link>
          </div>
          <p className="text-sm text-[#94a3b8]">
            {graph?.stats.total_nodes || 0} 个实体节点 · {graph?.stats.total_edges || 0} 条关系边 · {graph?.stats.total_docs || 0} 篇文献
          </p>
        </div>

        {/* Upload */}
        <div className="glass p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4">上传文献</h2>
          <label className="block border-2 border-dashed border-[#1e293b] rounded-2xl p-12 text-center cursor-pointer
                           hover:border-[#3b82f6] hover:bg-[rgba(59,130,246,.04)] transition-all duration-300">
            <div className="text-3xl mb-3">📄</div>
            <p className="text-[#94a3b8]">{uploading ? "上传中..." : "拖拽 PDF 文件到此处或点击选择"}</p>
            <p className="text-xs text-[#475569] mt-2">仅支持 .pdf 格式</p>
            <input type="file" accept=".pdf" className="hidden" onChange={handleUpload} />
          </label>
        </div>

        {/* File List */}
        <div className="glass p-6">
          <h2 className="text-lg font-semibold mb-4">已索引文献</h2>
          {files.length === 0 ? (
            <p className="text-sm text-[#475569]">暂无文献</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[#475569] border-b border-[#1e293b]">
                  <th className="pb-3 font-medium">文件名</th>
                  <th className="pb-3 font-medium">状态</th>
                </tr>
              </thead>
              <tbody>
                {files.map((f, i) => (
                  <tr key={i} className="border-b border-[#1e293b]/50">
                    <td className="py-3 text-[#f1f5f9]">{f.name}</td>
                    <td className="py-3">
                      <span className={f.status === "indexed" ? "text-[#10b981]" : "text-[#475569]"}>
                        {f.status === "indexed" ? "✓ 已索引" : f.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="glass p-6 relative overflow-hidden group">
      <div className="absolute left-0 top-4 bottom-4 w-[3px] bg-[#3b82f6] rounded-r opacity-0 group-hover:opacity-100 transition-opacity" />
      <p className="text-xs text-[#475569] uppercase tracking-wider mb-2">{label}</p>
      <p className="font-mono text-3xl font-bold text-[#f1f5f9]">{value}</p>
    </div>
  );
}

function NavItem({ href, active, children }: { href: string; active?: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`px-4 py-2.5 rounded-xl text-sm transition-all duration-200 ${
        active
          ? "bg-[rgba(59,130,246,.1)] text-[#60a5fa] border border-[rgba(59,130,246,.2)]"
          : "text-[#94a3b8] hover:text-[#f1f5f9] hover:bg-[#14141f]"
      }`}
    >
      {children}
    </Link>
  );
}
