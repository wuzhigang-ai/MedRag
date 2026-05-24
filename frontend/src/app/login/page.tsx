"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { backend } from "@/lib/backend";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await backend.login(username, password);
      localStorage.setItem("medasr_token", res.token);
      localStorage.setItem("medasr_user", JSON.stringify({ username: res.username, role: res.role }));
      router.push(res.role === "admin" ? "/admin" : "/chat");
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0f] px-4">
      <div className="w-full max-w-[420px]">
        <div className="bg-[#14141f] border border-[rgba(255,255,255,.06)] rounded-3xl p-12
                        shadow-[0_16px_48px_rgba(0,0,0,.3),inset_0_0_0_1px_rgba(255,255,255,.03)]
                        backdrop-blur-xl">
          {/* Avatar */}
          <div className="w-16 h-16 mx-auto mb-6 rounded-full
                          bg-gradient-to-br from-[rgba(59,130,246,.15)] to-[rgba(124,58,237,.1)]
                          flex items-center justify-center shadow-[0_0_24px_rgba(59,130,246,.12)]">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="1.5">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
          </div>

          <h1 className="font-display text-2xl font-bold text-center mb-2">欢迎回来</h1>
          <p className="text-sm text-[#475569] text-center mb-9">登录 MedASR 医学知识平台</p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-medium text-[#94a3b8] mb-1.5">用户名</label>
              <input
                type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-3 bg-[#1a1a2e] border border-[#1e293b] rounded-xl
                           text-[#f1f5f9] text-sm focus:border-[#3b82f6] focus:ring-2 focus:ring-[rgba(59,130,246,.1)]
                           outline-none transition-all"
                placeholder="admin 或 user"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#94a3b8] mb-1.5">密码</label>
              <input
                type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-[#1a1a2e] border border-[#1e293b] rounded-xl
                           text-[#f1f5f9] text-sm focus:border-[#3b82f6] focus:ring-2 focus:ring-[rgba(59,130,246,.1)]
                           outline-none transition-all"
                placeholder="admin123 或 user123"
              />
            </div>

            {error && (
              <p className="text-sm text-red-400 bg-[rgba(239,68,68,.1)] border border-[rgba(239,68,68,.2)]
                            rounded-lg px-4 py-2.5">{error}</p>
            )}

            <button
              type="submit" disabled={loading}
              className="btn btn-primary w-full py-3 mt-2 rounded-xl text-sm font-medium"
            >
              {loading ? "登录中..." : "登录"}
            </button>
          </form>

          <p className="text-center text-sm text-[#475569] mt-6">
            演示账号: admin/admin123 或 user/user123
          </p>
        </div>

        <p className="text-center text-sm text-[#475569] mt-6">
          <Link href="/" className="text-[#60a5fa] hover:text-[#3b82f6] transition-colors">← 返回首页</Link>
        </p>
      </div>
    </div>
  );
}
