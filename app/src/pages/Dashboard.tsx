import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { useToast } from "@/providers/toast";
import {
  FiBook, FiCheckCircle, FiDatabase, FiMessageSquare, FiActivity,
  FiUpload, FiShare2, FiClock, FiTrendingUp, FiAlertCircle,
  FiArrowRight, FiLayers, FiPieChart, FiCpu, FiFileText,
  FiChevronRight, FiShield, FiZap
} from "react-icons/fi";

export default function Dashboard() {
  const navigate = useNavigate();
  const toast = useToast();
  const { data: stats } = trpc.stats.system.useQuery();
  const { data: articles } = trpc.articles.list.useQuery({ status: "pending" });
  const { data: kbStats } = trpc.knowledge.stats.useQuery();

  const cards = [
    { label: "文献总量", value: stats?.totalArticles ?? 0, icon: <FiBook size={18} />, color: "var(--m-primary)", bg: "rgba(37,99,235,0.08)", path: "/admin/library" },
    { label: "已入库", value: stats?.knowledgeBaseArticles ?? 0, icon: <FiCheckCircle size={18} />, color: "var(--m-green)", bg: "rgba(16,185,129,0.08)", path: "/admin/library" },
    { label: "知识节点", value: stats?.totalNodes ?? 0, icon: <FiDatabase size={18} />, color: "var(--m-cyan)", bg: "rgba(0,196,180,0.08)", path: "/admin/graph" },
    { label: "问答会话", value: stats?.totalChatSessions ?? 0, icon: <FiMessageSquare size={18} />, color: "var(--m-gold)", bg: "rgba(212,168,83,0.08)", path: "/admin/chat" },
  ];

  const quickActions = [
    { icon: <FiUpload size={16} />, label: "上传PDF", desc: "批量上传医疗文献", path: "/admin/parsing", color: "var(--m-primary)", bg: "rgba(37,99,235,0.08)" },
    { icon: <FiBook size={16} />, label: "文献管理", desc: "查看和管理已解析文献", path: "/admin/library", color: "var(--m-green)", bg: "rgba(16,185,129,0.08)" },
    { icon: <FiShare2 size={16} />, label: "知识图谱", desc: "浏览医疗知识网络", path: "/admin/graph", color: "var(--m-cyan)", bg: "rgba(0,196,180,0.08)" },
    { icon: <FiMessageSquare size={16} />, label: "医疗问答", desc: "基于知识库的问答", path: "/admin/chat", color: "var(--m-gold)", bg: "rgba(212,168,83,0.08)" },
  ];

  const recentActivity = [
    { icon: <FiUpload size={12} />, text: "新文献上传《糖尿病治疗新进展》", time: "2分钟前", color: "var(--m-primary)" },
    { icon: <FiCheckCircle size={12} />, text: "文献《NSCLC免疫治疗》已入库", time: "15分钟前", color: "var(--m-green)" },
    { icon: <FiDatabase size={12} />, text: "知识图谱新增 3 个节点、5 条关系", time: "1小时前", color: "var(--m-cyan)" },
    { icon: <FiMessageSquare size={12} />, text: "新问答会话：房颤抗凝方案", time: "2小时前", color: "var(--m-gold)" },
    { icon: <FiAlertCircle size={12} />, text: "《高血压指南2024》解析完成待审核", time: "3小时前", color: "var(--m-orange)" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Welcome Banner */}
      <div className="m-card" style={{
        padding: "20px 24px",
        background: "linear-gradient(135deg, rgba(37,99,235,0.04) 0%, rgba(0,196,180,0.04) 100%)",
        border: "1px solid rgba(37,99,235,0.08)",
        display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12,
      }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--tx-900)", marginBottom: 4 }}>欢迎回来，医疗专家</h2>
          <p style={{ fontSize: 13, color: "var(--tx-300)" }}>您有 {articles?.length ?? 0} 篇文献待处理，{kbStats?.totalNodes ?? 0} 个知识节点</p>
        </div>
        <button onClick={() => navigate("/admin/parsing")} className="m-btn m-btn-primary" style={{ height: 38, padding: "0 20px", fontSize: 13 }}>
          <FiUpload size={15} /> 上传新文献
        </button>
      </div>

      {/* Stats Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        {cards.map((c, i) => (
          <div key={i} onClick={() => navigate(c.path)} className="m-card" style={{
            padding: "16px 18px", cursor: "pointer", transition: "all 0.25s var(--ease-out-expo)",
            borderLeft: `3px solid ${c.color}`,
          }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "var(--sh-md)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "var(--sh-xs)"; }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div className="m-icon-box" style={{ width: 36, height: 36, background: c.bg, color: c.color, borderRadius: 9 }}>{c.icon}</div>
              <FiArrowRight size={14} style={{ color: "var(--tx-100)" }} />
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "var(--tx-900)", letterSpacing: "-0.02em" }}>{c.value}</div>
            <div style={{ fontSize: 12, color: "var(--tx-300)", marginTop: 2 }}>{c.label}</div>
          </div>
        ))}
      </div>

      {/* Main Content Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 14 }}>
        {/* Left: Quick Actions + Workflow */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Quick Actions */}
          <div className="m-card" style={{ padding: 16 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--tx-900)", marginBottom: 12 }}>快捷操作</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
              {quickActions.map((a, i) => (
                <div key={i} onClick={() => navigate(a.path)} style={{
                  padding: "12px 14px", borderRadius: 10, border: "1.5px solid var(--bd-100)", background: "var(--bg-surface)",
                  cursor: "pointer", transition: "all 0.2s", display: "flex", alignItems: "center", gap: 10,
                }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = a.color; e.currentTarget.style.background = a.bg; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--bd-100)"; e.currentTarget.style.background = "var(--bg-surface)"; }}
                >
                  <div className="m-icon-box" style={{ width: 34, height: 34, background: a.bg, color: a.color, borderRadius: 8 }}>{a.icon}</div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--tx-700)" }}>{a.label}</div>
                    <div style={{ fontSize: 11, color: "var(--tx-100)", marginTop: 1 }}>{a.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Workflow */}
          <div className="m-card" style={{ padding: 16 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--tx-900)", marginBottom: 14 }}>处理流程</h3>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 0 }}>
              {[
                { icon: <FiUpload size={14} />, label: "PDF上传", color: "var(--m-primary)" },
                { icon: <FiLayers size={14} />, label: "智能解析", color: "var(--m-cyan)" },
                { icon: <FiShield size={14} />, label: "专家审核", color: "var(--m-gold)" },
                { icon: <FiDatabase size={14} />, label: "知识入库", color: "var(--m-green)" },
              ].map((s, i, arr) => (
                <div key={i} style={{ display: "flex", alignItems: "center" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "8px 12px" }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: "50%", background: `${s.color}15`, color: s.color,
                      display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14,
                    }}>{s.icon}</div>
                    <span style={{ fontSize: 11, fontWeight: 500, color: "var(--tx-500)" }}>{s.label}</span>
                  </div>
                  {i < arr.length - 1 && <FiChevronRight size={14} style={{ color: "var(--tx-100)", marginBottom: 16 }} />}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Activity + System Status */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* System Status */}
          <div className="m-card" style={{ padding: 14 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--tx-900)", marginBottom: 10 }}>系统状态</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: "var(--tx-300)" }}>MinerU 解析服务</span>
                <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: "var(--m-green)" }}><div style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--m-green)", boxShadow: "0 0 4px var(--m-green)" }} />正常</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: "var(--tx-300)" }}>LightRAG 图谱引擎</span>
                <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: "var(--m-green)" }}><div style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--m-green)", boxShadow: "0 0 4px var(--m-green)" }} />正常</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: "var(--tx-300)" }}>向量检索服务</span>
                <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: "var(--m-green)" }}><div style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--m-green)", boxShadow: "0 0 4px var(--m-green)" }} />正常</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: "var(--tx-300)" }}>平均解析耗时</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--tx-700)" }}>{stats?.avgParseTime ?? 12.5}s</span>
              </div>
            </div>
          </div>

          {/* Recent Activity */}
          <div className="m-card" style={{ padding: 14, flex: 1 }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--tx-900)", marginBottom: 10 }}>最近动态</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {recentActivity.map((a, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 0", borderBottom: i < recentActivity.length - 1 ? "1px solid var(--bd-100)" : "none" }}>
                  <div style={{ width: 22, height: 22, borderRadius: 6, background: `${a.color}15`, color: a.color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>{a.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: "var(--tx-500)", lineHeight: 1.5 }}>{a.text}</div>
                    <div style={{ fontSize: 10, color: "var(--tx-100)", marginTop: 2 }}>{a.time}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
