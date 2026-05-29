import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useTheme } from "@/hooks/useTheme";
import { FiEye, FiEyeOff, FiMail, FiLock, FiSun, FiMoon, FiArrowRight, FiBook, FiLayers, FiPieChart, FiMessageSquare } from "react-icons/fi";

export default function Login() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState<"expert" | "user" | "admin">("expert");
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email.trim()) { setError("请输入邮箱地址"); return; }
    if (!password.trim()) { setError("请输入密码"); return; }
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      localStorage.setItem("medrag_user", JSON.stringify({ id: 1, name: email.split("@")[0], email, role, avatar: null }));
      // Smart redirect based on role
      if (role === "expert") {
        navigate("/admin");
      } else {
        navigate("/chat"); // Independent user chat interface
      }
    }, 800);
  };

  const feats = [
    { icon: <FiBook size={14} />, text: "复杂版面精准识别" },
    { icon: <FiLayers size={14} />, text: "语义级智能切分" },
    { icon: <FiPieChart size={14} />, text: "LightRAG 知识图谱" },
    { icon: <FiMessageSquare size={14} />, text: "多模态医疗问答" },
  ];

  const roleTabs = [
    { value: "expert" as const, label: "医疗专家" },
    { value: "user" as const, label: "普通用户" },
  ];

  return (
    <div style={{ minHeight: "100vh", display: "flex", background: "var(--bg-base)", color: "var(--tx-700)" }}>
      {/* Left Panel */}
      <div className="hidden md:flex" style={{
        flex: 1, flexDirection: "column", justifyContent: "center", alignItems: "center",
        background: "linear-gradient(160deg,#070F1E 0%,#0F2B5B 45%,#0A3D62 100%)",
        color: "white", padding: "48px", position: "relative", overflow: "hidden",
      }}>
        <div style={{ position: "absolute", inset: 0, opacity: 0.06, backgroundImage: "radial-gradient(circle at 1px 1px,white 1px,transparent 0)", backgroundSize: "36px 36px" }} />
        <div style={{ position: "absolute", top: "5%", left: "8%", width: 300, height: 300, borderRadius: "50%", background: "rgba(37,99,235,0.12)", filter: "blur(70px)" }} />
        <div style={{ position: "absolute", bottom: "10%", right: "5%", width: 240, height: 240, borderRadius: "50%", background: "rgba(0,196,180,0.08)", filter: "blur(60px)" }} />

        <div style={{ position: "relative", zIndex: 1, maxWidth: 400 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 36 }}>
            <div style={{ width: 40, height: 40, borderRadius: 11, background: "rgba(255,255,255,0.10)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.14)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, fontWeight: 800 }}>M</div>
            <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em" }}>MedRAG</span>
          </div>
          <h1 style={{ fontSize: "clamp(24px,2.6vw,32px)", fontWeight: 700, lineHeight: 1.25, marginBottom: 14, letterSpacing: "-0.02em" }}>基于 MinerU 医疗文献高质量 RAG 知识库系统</h1>
          <p style={{ fontSize: 15, lineHeight: 1.6, opacity: 0.65, marginBottom: 32 }}>语义解析赋能医疗科研，智能图谱支撑临床决策</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {feats.map((f, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 26, height: 26, borderRadius: 7, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.10)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "rgba(255,255,255,0.8)" }}>{f.icon}</div>
                <span style={{ fontSize: 14, opacity: 0.8 }}>{f.text}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ position: "absolute", bottom: 24, left: 48, right: 48, fontSize: 11, opacity: 0.3, letterSpacing: "0.03em" }}>MedRAG System v1.0 | 医疗文献 RAG 知识库赛事项目</div>
      </div>

      {/* Right Form */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: "48px 24px", position: "relative" }}>
        <button onClick={toggleTheme} style={{ position: "absolute", top: 20, right: 20, width: 36, height: 36, borderRadius: 8, border: "1px solid var(--bd-200)", background: "var(--bg-surface)", color: "var(--tx-300)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          {theme === "light" ? <FiMoon size={15} /> : <FiSun size={15} />}
        </button>

        <div style={{ width: "100%", maxWidth: 380 }}>
          <div className="md:hidden" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: "linear-gradient(135deg,#2563EB,#00C4B4)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 16, fontWeight: 800 }}>M</div>
            <span style={{ fontSize: 17, fontWeight: 700 }}>MedRAG</span>
          </div>

          <h2 style={{ fontSize: 26, fontWeight: 700, marginBottom: 6, letterSpacing: "-0.02em", color: "var(--tx-900)" }}>系统安全登录</h2>
          <p style={{ fontSize: 14, color: "var(--tx-300)", marginBottom: 24 }}>请输入您的账号密码以访问系统</p>

          {/* Role selector */}
          <div style={{ display: "flex", gap: 3, marginBottom: 20, padding: 3, background: "var(--bg-elevated)", borderRadius: 10, border: "1px solid var(--bd-100)" }}>
            {roleTabs.map((r) => (
              <button key={r.value} onClick={() => setRole(r.value)} style={{ flex: 1, padding: "7px 0", borderRadius: 8, border: "none", fontSize: 13, fontWeight: 500, cursor: "pointer", transition: "all 0.25s cubic-bezier(0.16,1,0.3,1)", background: role === r.value ? "var(--bg-surface)" : "transparent", color: role === r.value ? "var(--m-primary)" : "var(--tx-300)", boxShadow: role === r.value ? "var(--sh-xs)" : "none" }}>{r.label}</button>
            ))}
          </div>

          {error && (
            <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(232,77,77,0.06)", color: "var(--m-red)", fontSize: 13, marginBottom: 14, border: "1px solid rgba(232,77,77,0.10)" }}>{error}</div>
          )}

          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--tx-500)", marginBottom: 5 }}>邮箱地址</label>
              <div style={{ position: "relative" }}>
                <FiMail size={15} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--tx-100)" }} />
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="请输入邮箱" className="m-input" style={{ paddingLeft: 40 }} />
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--tx-500)", marginBottom: 5 }}>登录密码</label>
              <div style={{ position: "relative" }}>
                <FiLock size={15} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--tx-100)" }} />
                <input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="请输入密码" className="m-input" style={{ paddingLeft: 40, paddingRight: 44 }} />
                <button type="button" onClick={() => setShowPassword(!showPassword)} style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "var(--tx-100)", cursor: "pointer" }}>
                  {showPassword ? <FiEyeOff size={15} /> : <FiEye size={15} />}
                </button>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, color: "var(--tx-300)" }}>
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} style={{ accentColor: "var(--m-cyan)" }} />记住登录状态
              </label>
              <button type="button" style={{ background: "none", border: "none", fontSize: 12, color: "var(--m-primary)", cursor: "pointer", fontWeight: 600 }}>忘记密码？</button>
            </div>
            <button type="submit" disabled={loading} className="m-btn m-btn-primary" style={{ width: "100%", height: 44, fontSize: 15 }}>
              {loading ? <div style={{ width: 20, height: 20, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "white", borderRadius: "50%" }} className="anim-spin" /> : "安全登录"}
            </button>
          </form>

          <div style={{ display: "flex", alignItems: "center", gap: 16, margin: "22px 0" }}>
            <div style={{ flex: 1, height: 1, background: "var(--bd-200)" }} />
            <span style={{ fontSize: 11, color: "var(--tx-100)" }}>或</span>
            <div style={{ flex: 1, height: 1, background: "var(--bd-200)" }} />
          </div>

          {/* OAuth Login */}
          <button
            onClick={() => {
              const appId = import.meta.env.VITE_APP_ID || "19da5128-d392-8ac8-8000-00004aa4c8cc";
              const redirectUri = `${window.location.origin}/api/oauth/callback`;
              const state = btoa(window.location.pathname);
              const authUrl = `https://auth.kimi.com/oauth/authorize?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=profile&state=${encodeURIComponent(state)}`;
              window.location.href = authUrl;
            }}
            className="m-btn"
            style={{
              width: "100%", height: 40, fontSize: 14, marginBottom: 16,
              background: "var(--bg-elevated)", border: "1.5px solid var(--bd-200)",
              color: "var(--tx-500)", display: "flex", alignItems: "center",
              justifyContent: "center", gap: 8,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" fill="currentColor"/></svg>
            通过 Kimi OAuth 登录
          </button>

          <div style={{ textAlign: "center" }}>
            <span style={{ fontSize: 13, color: "var(--tx-300)" }}>暂无账号？</span>
            <Link to="/register" style={{ fontSize: 13, color: "var(--m-primary)", textDecoration: "none", fontWeight: 600, marginLeft: 4 }}>立即注册 <FiArrowRight size={12} style={{ display: "inline", verticalAlign: "middle" }} /></Link>
          </div>

          <div style={{ marginTop: 40, textAlign: "center", fontSize: 11, color: "var(--tx-100)", lineHeight: 1.8 }}>
            <p>MedRAG System v1.0 | 医疗文献 RAG 知识库赛事项目</p>
            <p>技术支持: MinerU + LightRAG + MedBench</p>
          </div>
        </div>
      </div>
    </div>
  );
}
