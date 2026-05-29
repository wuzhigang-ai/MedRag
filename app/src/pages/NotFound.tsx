import { Link } from "react-router";
import { FiHome, FiArrowLeft } from "react-icons/fi";

export default function NotFound() {
  return (
    <div style={{
      height: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      background: "var(--bg-primary)",
      color: "var(--text-primary)",
      gap: 24,
      padding: "0 24px",
    }}>
      <div style={{
        fontSize: 120,
        fontWeight: 700,
        background: "linear-gradient(135deg, var(--medical-primary), var(--medical-cyan))",
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        lineHeight: 1,
      }}>
        404
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 600 }}>页面未找到</h1>
      <p style={{ fontSize: 14, color: "var(--text-tertiary)", textAlign: "center" }}>
        您访问的页面不存在或已被移除
      </p>
      <div style={{ display: "flex", gap: 12 }}>
        <Link to="/" className="btn-primary">
          <FiHome size={16} />
          返回首页
        </Link>
        <button onClick={() => window.history.back()} className="btn-secondary">
          <FiArrowLeft size={16} />
          返回上页
        </button>
      </div>
    </div>
  );
}
