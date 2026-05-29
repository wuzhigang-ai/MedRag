import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[MedRAG Error]", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0c1222",
          color: "#c8d5e8",
          fontFamily: "system-ui, sans-serif",
          padding: 24,
        }}>
          <div style={{ textAlign: "center", maxWidth: 480 }}>
            <div style={{
              width: 48, height: 48, borderRadius: 12,
              background: "linear-gradient(135deg,#2563EB,#00C4B4)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "white", fontSize: 24, fontWeight: 800,
              margin: "0 auto 20px",
            }}>M</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: "#e2eafc", marginBottom: 12 }}>页面遇到了问题</h2>
            <p style={{ fontSize: 13, color: "#7a8db0", lineHeight: 1.6, marginBottom: 20 }}>
              请刷新页面重试。如果问题持续，请联系管理员。
            </p>
            <div style={{
              background: "rgba(37,99,235,0.08)", border: "1px solid rgba(37,99,235,0.2)",
              borderRadius: 10, padding: "14px 18px", textAlign: "left", fontSize: 12,
              color: "#9bb0d0", lineHeight: 2, fontFamily: "monospace",
            }}>
              <div style={{ color: "#4a9eff", fontWeight: 600, marginBottom: 8 }}>$ 方式1：npx serve（推荐）</div>
              <div>npx serve .</div>
              <div style={{ color: "#4a9eff", fontWeight: 600, margin: "12px 0 8px" }}>$ 方式2：Python</div>
              <div>python3 -m http.server 8080</div>
              <div style={{ color: "#4a9eff", fontWeight: 600, margin: "12px 0 8px" }}>$ 方式3：Node.js</div>
              <div>node -e "require('http').createServer((q,r)=&gt;require('fs').readFile('.'+(q.url=='/'?'/index.html':q.url),(e,d)=&gt;e?r.writeHead(404)&amp;&amp;r.end():r.writeHead(200)&amp;&amp;r.end(d))).listen(3000)"</div>
            </div>
            <button
              onClick={() => window.location.reload()}
              style={{
                marginTop: 20, padding: "8px 20px", borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.06)",
                color: "#c8d5e8", cursor: "pointer", fontSize: 13,
              }}
            >刷新页面</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
