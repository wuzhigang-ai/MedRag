import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { FiCheckCircle, FiAlertCircle, FiInfo, FiX, FiAlertTriangle } from "react-icons/fi";

export type ToastType = "success" | "error" | "warning" | "info";

interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastContextValue {
  show: (type: ToastType, title: string, message?: string, duration?: number) => void;
  success: (title: string, message?: string, duration?: number) => void;
  error: (title: string, message?: string, duration?: number) => void;
  warning: (title: string, message?: string, duration?: number) => void;
  info: (title: string, message?: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

const iconMap = {
  success: <FiCheckCircle size={16} />,
  error: <FiAlertCircle size={16} />,
  warning: <FiAlertTriangle size={16} />,
  info: <FiInfo size={16} />,
};

const colorMap = {
  success: { bg: "rgba(16,185,129,0.08)", border: "rgba(16,185,129,0.15)", color: "#10B981", iconBg: "rgba(16,185,129,0.12)" },
  error: { bg: "rgba(232,77,77,0.06)", border: "rgba(232,77,77,0.12)", color: "#E84D4D", iconBg: "rgba(232,77,77,0.10)" },
  warning: { bg: "rgba(245,158,11,0.06)", border: "rgba(245,158,11,0.12)", color: "#F59E0B", iconBg: "rgba(245,158,11,0.10)" },
  info: { bg: "rgba(37,99,235,0.06)", border: "rgba(37,99,235,0.12)", color: "#2563EB", iconBg: "rgba(37,99,235,0.10)" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((type: ToastType, title: string, message?: string, duration = 4000) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const item: ToastItem = { id, type, title, message, duration };
    setToasts((prev) => [...prev, item]);
    setTimeout(() => remove(id), duration);
  }, [remove]);

  const success = useCallback((title: string, message?: string, duration?: number) => show("success", title, message, duration), [show]);
  const error = useCallback((title: string, message?: string, duration?: number) => show("error", title, message, duration), [show]);
  const warning = useCallback((title: string, message?: string, duration?: number) => show("warning", title, message, duration), [show]);
  const info = useCallback((title: string, message?: string, duration?: number) => show("info", title, message, duration), [show]);

  return (
    <ToastContext.Provider value={{ show, success, error, warning, info }}>
      {children}
      {/* Toast Container */}
      <div style={{ position: "fixed", top: 20, right: 20, zIndex: 9999, display: "flex", flexDirection: "column", gap: 8 }}>
        {toasts.map((t) => {
          const c = colorMap[t.type];
          return (
            <div key={t.id} style={{
              background: c.bg,
              border: `1px solid ${c.border}`,
              borderRadius: 10,
              padding: "12px 14px",
              minWidth: 280,
              maxWidth: 380,
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              backdropFilter: "blur(20px) saturate(1.6)",
              animation: "slideInRight 0.35s var(--ease-out-expo) forwards",
              boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
            }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: c.iconBg, color: c.color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {iconMap[t.type]}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--tx-900)", marginBottom: t.message ? 2 : 0 }}>{t.title}</div>
                {t.message && <div style={{ fontSize: 12, color: "var(--tx-300)", lineHeight: 1.5 }}>{t.message}</div>}
              </div>
              <button onClick={() => remove(t.id)} style={{ background: "none", border: "none", color: "var(--tx-100)", cursor: "pointer", padding: 2, flexShrink: 0 }}>
                <FiX size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
