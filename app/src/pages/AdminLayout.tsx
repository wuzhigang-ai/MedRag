import { Outlet, Link, useLocation, useNavigate } from "react-router";
import { useState, useEffect } from "react";
import { useTheme } from "@/hooks/useTheme";
import { ToastProvider } from "@/providers/toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  FiSun, FiMoon, FiHome, FiUpload, FiBook, FiShare2, FiMessageSquare,
  FiUser, FiLogOut, FiMenu, FiX, FiChevronLeft, FiChevronRight,
  FiActivity, FiGrid, FiAlertTriangle, FiXCircle, FiCheckCircle
} from "react-icons/fi";

/* ── Route Guard ── */
function RouteGuard({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const token = localStorage.getItem("medasr_token");
    if (!token) {
      navigate("/login", { replace: true });
      return;
    }
    fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        if (data.user) {
          setChecked(true);
        } else {
          localStorage.removeItem("medrag_user");
          localStorage.removeItem("medasr_token");
          navigate("/login", { replace: true });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setChecked(true); // Allow offline access if server unreachable
        }
      });
    return () => { cancelled = true; };
  }, [navigate]);

  if (!checked) {
    return (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg-base)" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 40, height: 40, border: "3px solid var(--bd-200)", borderTopColor: "var(--m-primary)", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 12px" }} />
          <p style={{ fontSize: 13, color: "var(--tx-300)" }}>验证身份...</p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

/* ── Delete Confirm Dialog ── */
export function ConfirmDialog({ open, title, message, onConfirm, onCancel }: {
  open: boolean; title: string; message: string; onConfirm: () => void; onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.25)", backdropFilter: "blur(4px)" }} onClick={onCancel} />
      <div style={{ position: "relative", background: "var(--bg-surface)", borderRadius: 14, padding: "24px", width: 360, boxShadow: "var(--sh-xl)", border: "1px solid var(--bd-100)", animation: "scaleIn 0.25s var(--ease-out-expo)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(232,77,77,0.08)", color: "var(--m-red)", display: "flex", alignItems: "center", justifyContent: "center" }}><FiAlertTriangle size={18} /></div>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--tx-900)" }}>{title}</h3>
        </div>
        <p style={{ fontSize: 13, color: "var(--tx-300)", lineHeight: 1.6, marginBottom: 20 }}>{message}</p>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onCancel} className="m-btn m-btn-secondary" style={{ flex: 1, height: 38 }}>取消</button>
          <button onClick={onConfirm} className="m-btn" style={{ flex: 1, height: 38, background: "var(--m-red)", color: "white" }}>确认删除</button>
        </div>
      </div>
    </div>
  );
}

/* ── Admin Layout ── */
export default function AdminLayout() {
  return (
    <RouteGuard>
      <ToastProvider>
        <AdminShell />
      </ToastProvider>
    </RouteGuard>
  );
}

function AdminShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = async () => {
    const token = localStorage.getItem("medasr_token");
    if (token) {
      try { await fetch("/api/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${token}` } }); } catch { /* best effort */ }
    }
    localStorage.removeItem("medrag_user");
    localStorage.removeItem("medasr_token");
    queryClient.clear();
    navigate("/login");
  };

  const [userRole, setUserRole] = useState<string>("expert");
  useEffect(() => {
    const user = localStorage.getItem("medrag_user");
    if (user) {
      try { setUserRole(JSON.parse(user).role || "expert"); } catch { setUserRole("expert"); }
    }
  }, []);

  // Expert-only menu (user role gets redirected to /chat independent interface)
  const menu = [
    { path: "/admin", icon: <FiGrid size={17} strokeWidth={1.5} />, label: "概览", exact: true },
    { path: "/admin/parsing", icon: <FiUpload size={17} strokeWidth={1.5} />, label: "文档解析" },
    { path: "/admin/library", icon: <FiBook size={17} strokeWidth={1.5} />, label: "文献库" },
    { path: "/admin/graph", icon: <FiShare2 size={17} strokeWidth={1.5} />, label: "知识图谱" },
    { path: "/admin/chat", icon: <FiMessageSquare size={17} strokeWidth={1.5} />, label: "问答验证" },
  ];

  const isActive = (p: string, exact?: boolean) => {
    if (exact) return location.pathname === p;
    return location.pathname === p || location.pathname.startsWith(p + "/");
  };

  const activeItem = menu.find((m) => isActive(m.path, m.exact));
  const title = activeItem?.label || "后台管理";

  // Breadcrumb
  const breadcrumbMap: Record<string, string> = {
    "/admin": "概览",
    "/admin/parsing": "文档解析",
    "/admin/library": "文献库",
    "/admin/graph": "知识图谱",
    "/admin/chat": "医疗问答",
  };

  return (
    <div style={{ display: "flex", height: "100vh", background: "var(--bg-base)", color: "var(--tx-700)", overflow: "hidden" }}>
      {mobileOpen && <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 90, backdropFilter: "blur(3px)" }} onClick={() => setMobileOpen(false)} />}

      {/* Sidebar */}
      <aside className="admin-sidebar" style={{
        width: mobileOpen ? 210 : collapsed ? 60 : 210,
        background: "var(--bg-sidebar)",
        borderRight: "1px solid var(--bd-100)",
        display: "flex", flexDirection: "column",
        transition: "width 0.3s var(--ease-out-expo)",
        position: mobileOpen ? "fixed" : "relative",
        left: mobileOpen ? 0 : undefined, top: mobileOpen ? 0 : undefined, bottom: mobileOpen ? 0 : undefined,
        zIndex: mobileOpen ? 100 : 10, flexShrink: 0,
      }}>
        {/* Logo */}
        <div className="sidebar-logo" style={{ height: 60, display: "flex", alignItems: "center", padding: "0 14px", borderBottom: "1px solid var(--bd-100)", gap: 8 }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, background: "linear-gradient(135deg,#2563EB,#00C4B4)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 14, fontWeight: 800, flexShrink: 0, boxShadow: "0 2px 8px rgba(37,99,235,0.25)" }}>M</div>
          {(mobileOpen || !collapsed) && <span style={{ fontSize: 14, fontWeight: 700, whiteSpace: "nowrap", letterSpacing: "-0.01em", color: "var(--tx-900)" }}>MedRAG</span>}
          {mobileOpen && <button onClick={() => setMobileOpen(false)} style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--tx-300)", cursor: "pointer" }}><FiX size={16} /></button>}
          {!mobileOpen && <button onClick={() => setCollapsed(!collapsed)} className="hidden md:block" style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--tx-100)", cursor: "pointer", padding: 3 }}>{collapsed ? <FiChevronRight size={13} /> : <FiChevronLeft size={13} />}</button>}
        </div>

        {/* Menu */}
        <nav style={{ flex: 1, padding: "8px", display: "flex", flexDirection: "column", gap: 2, overflowY: "auto" }}>
          <Link to="/" className="sidebar-home" onClick={() => setMobileOpen(false)} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", borderRadius: 8, color: "var(--tx-300)", textDecoration: "none", fontSize: 12, fontWeight: 500, transition: "all 0.2s" }} onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--tx-700)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--tx-300)"; }}><FiHome size={17} strokeWidth={1.5} />{(mobileOpen || !collapsed) && "返回首页"}</Link>
          <div className="sidebar-divider" style={{ height: 1, background: "var(--bd-100)", margin: "4px 6px" }} />
          {menu.map((item) => (
            <Link key={item.path} to={item.path} onClick={() => setMobileOpen(false)} style={{
              display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", borderRadius: 8,
              color: isActive(item.path, item.exact) ? "var(--m-primary)" : "var(--tx-300)",
              background: isActive(item.path, item.exact) ? "rgba(37,99,235,0.06)" : "transparent",
              border: isActive(item.path, item.exact) ? "1px solid rgba(37,99,235,0.08)" : "1px solid transparent",
              textDecoration: "none", fontSize: 12, fontWeight: isActive(item.path, item.exact) ? 600 : 500,
              transition: "all 0.2s", whiteSpace: "nowrap",
            }} onMouseEnter={(e) => { if (!isActive(item.path, item.exact)) { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--tx-700)"; } }} onMouseLeave={(e) => { if (!isActive(item.path, item.exact)) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--tx-300)"; } }}>
              {item.icon}{(mobileOpen || !collapsed) && item.label}
            </Link>
          ))}
        </nav>

        {/* User */}
        <div className="sidebar-user" style={{ padding: "8px", borderTop: "1px solid var(--bd-100)", display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 30, height: 30, borderRadius: "50%", background: "rgba(37,99,235,0.08)", color: "var(--m-primary)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 12 }}><FiUser size={14} /></div>
          {(mobileOpen || !collapsed) && <><div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 11, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>医疗专家</div><div style={{ fontSize: 10, color: "var(--tx-100)" }}>在线</div></div><button onClick={handleLogout} style={{ background: "none", border: "none", color: "var(--tx-100)", cursor: "pointer", padding: 3 }}><FiLogOut size={13} /></button></>}
        </div>
      </aside>

      {/* Main */}
      <main className="admin-main" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <header className="admin-header" style={{ height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px", borderBottom: "1px solid var(--bd-100)", background: "var(--bg-base)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={() => setMobileOpen(true)} className="md:hidden" style={{ background: "none", border: "none", color: "var(--tx-500)", cursor: "pointer", padding: 5 }}><FiMenu size={18} /></button>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <h1 style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.01em", color: "var(--tx-900)" }}>{title}</h1>
              {/* Breadcrumb */}
              {location.pathname !== "/admin" && (
                <div className="admin-breadcrumb" style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8 }}>
                  <span style={{ color: "var(--tx-100)", fontSize: 11 }}>/</span>
                  <Link to="/admin" style={{ fontSize: 11, color: "var(--tx-100)", textDecoration: "none", transition: "color 0.15s" }} onMouseEnter={(e) => { e.currentTarget.style.color = "var(--m-primary)"; }} onMouseLeave={(e) => { e.currentTarget.style.color = "var(--tx-100)"; }}>后台管理</Link>
                  <span style={{ color: "var(--tx-100)", fontSize: 11 }}>/</span>
                  <span style={{ fontSize: 11, color: "var(--tx-300)" }}>{breadcrumbMap[location.pathname] || ""}</span>
                </div>
              )}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 6, background: "rgba(16,185,129,0.06)", color: "var(--m-green)", fontSize: 10, fontWeight: 600 }}>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--m-green)", boxShadow: "0 0 4px var(--m-green)" }} />系统正常
            </div>
            <button onClick={toggleTheme} style={{ width: 30, height: 30, borderRadius: 7, border: "1px solid var(--bd-200)", background: "var(--bg-surface)", color: "var(--tx-300)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>{theme === "light" ? <FiMoon size={13} /> : <FiSun size={13} />}</button>
          </div>
        </header>
        <div style={{ flex: 1, overflow: "auto", padding: 16 }}><Outlet /></div>
      </main>
    </div>
  );
}
