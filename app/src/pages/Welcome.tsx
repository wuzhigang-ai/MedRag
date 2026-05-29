import { useState, useEffect, useRef } from "react";
import { Link } from "react-router";
import { useTheme } from "@/hooks/useTheme";
import { trpc } from "@/providers/trpc";
import StarrySky from "@/components/StarrySky";
import {
  FiSun, FiMoon, FiUpload, FiBook, FiMessageSquare, FiDatabase,
  FiLayers, FiFileText, FiPieChart, FiCpu, FiCheckCircle,
  FiArrowRight, FiChevronDown, FiTrendingUp, FiGlobe, FiShield,
  FiSearch, FiZap, FiStar,
} from "react-icons/fi";

/* ── Animated Counter ── */
function Counter({ value, suffix = "", decimals = 0 }: { value: number; suffix?: string; decimals?: number }) {
  const [d, setD] = useState(0);
  const r = useRef<HTMLSpanElement>(null);
  const s = useRef(false);
  useEffect(() => {
    const o = new IntersectionObserver(([e]) => { if (e.isIntersecting && !s.current) { s.current = true; const t = performance.now(); const c = (n: number) => { const p = Math.min((n - t) / 1800, 1); const e = 1 - Math.pow(1 - p, 4); setD(e * value); if (p < 1) requestAnimationFrame(c); }; requestAnimationFrame(c); } }, { threshold: 0.3 });
    if (r.current) o.observe(r.current); return () => o.disconnect();
  }, [value]);
  return <span ref={r}>{decimals > 0 ? d.toFixed(decimals) : Math.round(d).toLocaleString()}{suffix}</span>;
}

/* ── Nav Link ── */
function NavLink({ to, children, variant = "default" }: { to: string; children: React.ReactNode; variant?: "default" | "primary" }) {
  if (variant === "primary") {
    return (
      <Link to={to} className="m-btn m-btn-primary m-btn-sm" style={{ textDecoration: "none" }}>{children}</Link>
    );
  }
  return (
    <Link to={to} style={{ padding: "8px 16px", borderRadius: 8, fontSize: 14, fontWeight: 500, color: "var(--tx-500)", textDecoration: "none", transition: "all 0.2s", }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--tx-700)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--tx-500)"; }}>{children}</Link>
  );
}

export default function Welcome() {
  const { theme, toggleTheme } = useTheme();
  const [scrolled, setScrolled] = useState(false);
  const [heroOn, setHeroOn] = useState(false);
  const { data: stats } = trpc.stats.system.useQuery();

  useEffect(() => { const t = setTimeout(() => setHeroOn(true), 120); return () => clearTimeout(t); }, []);
  useEffect(() => { const h = () => setScrolled(window.scrollY > 50); window.addEventListener("scroll", h, { passive: true }); return () => window.removeEventListener("scroll", h); }, []);

  const features = [
    { icon: <FiFileText size={22} strokeWidth={1.5} />, title: "复杂 PDF 智能解析", desc: "精准还原双栏/多栏版式，智能提取临床表格与统计图表", color: "#2563EB", bg: "rgba(37,99,235,0.08)" },
    { icon: <FiLayers size={22} strokeWidth={1.5} />, title: "医学语义智能切分", desc: "以医学章节逻辑为单元语义级切分，保障上下文连贯", color: "#00C4B4", bg: "rgba(0,196,180,0.08)" },
    { icon: <FiPieChart size={22} strokeWidth={1.5} />, title: "LightRAG 知识图谱", desc: "文档入库自动构建实体节点与语义关联网络", color: "#10B981", bg: "rgba(16,185,129,0.08)" },
    { icon: <FiCpu size={22} strokeWidth={1.5} />, title: "多模态医疗问答", desc: "支持文字/影像/PDF多模态提问，Agent推理可视化", color: "#D4A853", bg: "rgba(212,168,83,0.08)" },
  ];

  const statsData = [
    { icon: <FiBook size={18} />, value: stats?.totalArticles ?? 8, label: "累计文献", suffix: "篇" },
    { icon: <FiCheckCircle size={18} />, value: stats?.knowledgeBaseArticles ?? 5, label: "入库文献", suffix: "篇" },
    { icon: <FiDatabase size={18} />, value: stats?.totalNodes ?? 20, label: "知识实体", suffix: "个" },
    { icon: <FiMessageSquare size={18} />, value: stats?.totalChatSessions ?? 3, label: "问答会话", suffix: "次" },
    { icon: <FiTrendingUp size={18} />, value: 12.5, label: "平均解析耗时", suffix: "秒", decimals: 1 },
  ];

  const steps = [
    { icon: <FiUpload size={16} />, label: "PDF上传" },
    { icon: <FiSearch size={16} />, label: "智能解析" },
    { icon: <FiShield size={16} />, label: "AI专家审核" },
    { icon: <FiDatabase size={16} />, label: "知识入库" },
    { icon: <FiPieChart size={16} />, label: "图谱更新" },
    { icon: <FiMessageSquare size={16} />, label: "智能问答" },
  ];

  return (
    <div style={{ background: "var(--bg-base)", color: "var(--tx-700)", minHeight: "100vh" }}>

      {/* ═══ NAV — glass over starry sky ═══ */}
      <nav style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 100, height: 64,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 32px",
        background: scrolled ? "rgba(248,250,252,0.92)" : "transparent",
        backdropFilter: scrolled ? "blur(20px) saturate(1.5)" : "none",
        borderBottom: scrolled ? "1px solid var(--bd-100)" : "1px solid transparent",
        transition: "all 0.5s var(--ease-out-expo)",
      }}>
        <Link to="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: "inherit" }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: "linear-gradient(135deg,#2563EB,#00C4B4)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 16, fontWeight: 800, boxShadow: scrolled ? "0 2px 10px rgba(37,99,235,0.3)" : "0 2px 10px rgba(37,99,235,0.5)" }}>M</div>
          <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.02em", color: scrolled ? "var(--tx-900)" : "white" }}>MedRAG</span>
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={toggleTheme} style={{ width: 34, height: 34, borderRadius: 8, border: scrolled ? "1px solid var(--bd-200)" : "1px solid rgba(255,255,255,0.15)", background: scrolled ? "var(--bg-surface)" : "rgba(255,255,255,0.06)", color: scrolled ? "var(--tx-500)" : "rgba(255,255,255,0.7)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>{theme === "light" ? <FiMoon size={15} /> : <FiSun size={15} />}</button>
          <Link to="/login" className="m-btn m-btn-sm" style={{ marginLeft: 6, textDecoration: "none", background: scrolled ? undefined : "rgba(255,255,255,0.12)", color: scrolled ? undefined : "white", border: scrolled ? undefined : "1px solid rgba(255,255,255,0.2)" }}>登录</Link>
        </div>
      </nav>

      {/* ═══ HERO — Starry Sky ═══ */}
      <section style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "120px 24px 100px", position: "relative", overflow: "hidden", background: "#01040d" }}>
        <StarrySky />
        <div style={{ position: "relative", zIndex: 1, maxWidth: 760, opacity: heroOn ? 1 : 0, transform: heroOn ? "translateY(0) scale(1)" : "translateY(30px) scale(0.97)", transition: "all 1.2s var(--ease-out-expo)" }}>
          {/* Badge */}
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 18px", borderRadius: 100, background: "rgba(37,99,235,0.10)", border: "1px solid rgba(37,99,235,0.20)", color: "#7eb8ff", fontSize: 13, fontWeight: 600, marginBottom: 32, backdropFilter: "blur(10px)" }}>
            <FiZap size={13} /> 医疗文献 RAG 知识库赛事项目
          </div>
          {/* Title */}
          <h1 style={{ fontSize: "clamp(36px,5vw,54px)", fontWeight: 800, lineHeight: 1.12, marginBottom: 20, letterSpacing: "-0.03em", color: "white", textShadow: "0 2px 30px rgba(37,99,235,0.2)" }}>
            基于 MinerU 医疗文献<br />
            <span style={{ background: "linear-gradient(135deg,#4a9eff,#00e5d4)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>高质量 RAG 知识库系统</span>
          </h1>
          {/* Subtitle */}
          <p style={{ fontSize: 18, color: "rgba(255,255,255,0.55)", marginBottom: 32, lineHeight: 1.7, maxWidth: 560, margin: "0 auto 32px" }}>语义解析赋能医疗科研，智能图谱支撑临床决策</p>
          {/* Tags */}
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "10px 24px", marginBottom: 40 }}>
            {["MinerU精准解析","语义级智能切分","LightRAG知识图谱","Agent推理可视化","文献溯源举证","MedBench兼容"].map((c,i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "rgba(255,255,255,0.45)" }}><FiCheckCircle size={12} style={{ color: "#00C4B4" }} />{c}</div>
            ))}
          </div>
          {/* CTA Button — single glowing entry */}
          <div style={{ display: "flex", justifyContent: "center" }}>
            <Link to="/chat" style={{
              height: 50,
              padding: "0 36px",
              fontSize: 15,
              fontWeight: 700,
              borderRadius: 14,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              background: "linear-gradient(135deg,#2563EB,#00C4B4)",
              color: "white",
              boxShadow: "0 4px 24px rgba(37,99,235,0.40), 0 0 60px rgba(37,99,235,0.15), 0 0 0 1px rgba(255,255,255,0.12) inset",
              transition: "all 0.4s var(--ease-out-expo)",
              letterSpacing: "0.02em",
            }} onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-3px) scale(1.03)";
              e.currentTarget.style.boxShadow = "0 8px 36px rgba(37,99,235,0.55), 0 0 80px rgba(37,99,235,0.22), 0 0 0 1px rgba(255,255,255,0.18) inset";
            }} onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0) scale(1)";
              e.currentTarget.style.boxShadow = "0 4px 24px rgba(37,99,235,0.40), 0 0 60px rgba(37,99,235,0.15), 0 0 0 1px rgba(255,255,255,0.12) inset";
            }}>
              <FiMessageSquare size={18} />进入医疗问答
            </Link>
          </div>
        </div>
        {/* Scroll indicator */}
        <div style={{ position: "absolute", bottom: 36, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, color: "rgba(255,255,255,0.3)", fontSize: 12, cursor: "pointer", zIndex: 1 }} onClick={() => window.scrollTo({ top: window.innerHeight * 0.9, behavior: "smooth" })}>
          <span>探索更多</span><FiChevronDown size={14} className="anim-float" />
        </div>
      </section>

      {/* ═══ Fog transition from dark to light ═══ */}
      <div style={{ height: 120, background: "linear-gradient(180deg,#01040d 0%,var(--bg-base) 100%)", marginTop: -1 }} />

      {/* ═══ FEATURES ═══ */}
      <section style={{ padding: "60px 24px 80px", maxWidth: 1120, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <div className="m-badge m-tag-gray" style={{ marginBottom: 12 }}><FiGlobe size={11} />核心能力</div>
          <h2 style={{ fontSize: "clamp(26px,3vw,32px)", fontWeight: 700, marginBottom: 8, letterSpacing: "-0.02em", color: "var(--tx-900)" }}>端到端医疗文献处理方案</h2>
          <p style={{ fontSize: 15, color: "var(--tx-300)", maxWidth: 480, margin: "0 auto" }}>从复杂版面解析到语义级切分，从知识图谱构建到多模态问答</p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 16 }}>
          {features.map((f, i) => (
            <div key={i} className="m-card" style={{ padding: 28, display: "flex", flexDirection: "column", gap: 16, cursor: "pointer", opacity: 0, animation: `scaleIn 0.5s var(--ease-out-expo) ${i * 0.08}s forwards` }}>
              <div className="m-icon-box" style={{ width: 48, height: 48, background: f.bg, color: f.color, borderRadius: 12 }}>{f.icon}</div>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 6, color: "var(--tx-900)" }}>{f.title}</h3>
                <p style={{ fontSize: 13, color: "var(--tx-300)", lineHeight: 1.65 }}>{f.desc}</p>
              </div>
              <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color: f.color }}>了解更多 <FiArrowRight size={11} /></div>
            </div>
          ))}
        </div>
      </section>

      {/* ═══ STATS ═══ */}
      <section style={{ padding: "64px 24px", background: "var(--bg-elevated)", borderTop: "1px solid var(--bd-100)", borderBottom: "1px solid var(--bd-100)" }}>
        <div style={{ maxWidth: 1120, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 36 }}>
            <div className="m-badge m-tag-gray" style={{ marginBottom: 10 }}><FiTrendingUp size={11} />实时数据</div>
            <h2 style={{ fontSize: "clamp(26px,3vw,32px)", fontWeight: 700, color: "var(--tx-900)" }}>知识库建设成果</h2>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 14 }}>
            {statsData.map((s, i) => (
              <div key={i} className="m-card" style={{ padding: 24, textAlign: "center" }}>
                <div className="m-icon-box" style={{ width: 40, height: 40, background: "rgba(37,99,235,0.06)", color: "var(--m-primary)", borderRadius: 10, margin: "0 auto 10px" }}>{s.icon}</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: "var(--tx-900)", fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}><Counter value={s.value} suffix={s.suffix} decimals={s.decimals} /></div>
                <div style={{ fontSize: 12, color: "var(--tx-300)", marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ WORKFLOW ═══ */}
      <section style={{ padding: "80px 24px", maxWidth: 1000, margin: "0 auto", position: "relative" }}>
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <div className="m-badge m-tag-gray" style={{ marginBottom: 12 }}><FiLayers size={11} />业务流程</div>
          <h2 style={{ fontSize: "clamp(26px,3vw,32px)", fontWeight: 700, color: "var(--tx-900)" }}>端到端全链路闭环</h2>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: 0 }}>
          {steps.map((s, i, a) => (
            <div key={i} style={{ display: "flex", alignItems: "center" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "10px 16px", transition: "all 0.3s" }}
                onMouseEnter={(e) => { const c = e.currentTarget.querySelector("[data-c]") as HTMLElement; if (c) { c.style.background = "var(--m-primary)"; c.style.color = "white"; c.style.boxShadow = "0 4px 20px rgba(37,99,235,0.35)"; c.style.transform = "scale(1.12)"; } }}
                onMouseLeave={(e) => { const c = e.currentTarget.querySelector("[data-c]") as HTMLElement; if (c) { c.style.background = i === 0 ? "var(--m-primary)" : "var(--bg-hover)"; c.style.color = i === 0 ? "white" : "var(--tx-500)"; c.style.boxShadow = i === 0 ? "0 4px 16px rgba(37,99,235,0.25)" : "none"; c.style.transform = "scale(1)"; } }}
              >
                <div data-c style={{ width: 52, height: 52, borderRadius: "50%", background: i === 0 ? "var(--m-primary)" : "var(--bg-hover)", color: i === 0 ? "white" : "var(--tx-500)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, transition: "all 0.35s var(--ease-out-expo)", boxShadow: i === 0 ? "0 4px 16px rgba(37,99,235,0.25)" : "none" }}>
                  {s.icon}
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--tx-500)", whiteSpace: "nowrap" }}>{s.label}</span>
              </div>
              {i < a.length - 1 && (
                <div style={{ display: "flex", alignItems: "center", marginBottom: 20 }}>
                  <div style={{ width: 32, height: 2, background: "linear-gradient(90deg,var(--bd-200),var(--m-primary))", opacity: 0.35 }} />
                  <FiArrowRight size={10} style={{ color: "var(--m-primary)", marginLeft: -3, opacity: 0.3 }} />
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer style={{ padding: "40px 24px 28px", borderTop: "1px solid var(--bd-100)", background: "var(--bg-elevated)" }}>
        <div style={{ maxWidth: 1120, margin: "0 auto", textAlign: "center" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 12 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg,#2563EB,#00C4B4)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 13, fontWeight: 800 }}>M</div>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--tx-900)" }}>MedRAG System</span>
          </div>
          <p style={{ fontSize: 12, color: "var(--tx-100)", lineHeight: 1.8 }}>基于 MinerU 医疗文献高质量 RAG 知识库系统 | 赛事项目 v1.0<br />技术支持: MinerU + LightRAG + MedBench</p>
        </div>
      </footer>
    </div>
  );
}
