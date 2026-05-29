/**
 * useAgentChat — SSE streaming Agent chat hook.
 * Replaces all mock ragSteps/handleSend with real backend integration.
 */
import { useState, useCallback, useRef } from "react";
import { api } from "@/lib/api";

export interface Citation {
  title?: string; source?: string; type?: string;
  image_url?: string; chart_type?: string; text_preview?: string;
}

export interface ToolStep {
  id: number;
  tool: string;
  args: Record<string, any>;
  preview: string;
  elapsed: number;
  // Enriched display fields
  label: string;
  icon: string;
  description: string;
  detail?: string;
}

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  toolSteps: ToolStep[];
  elapsed: number;
}

// ── Tool Registry: 9 Agent tools + backtrack ──────
const TOOL_REGISTRY: Record<string, { label: string; icon: string; description: string }> = {
  search_rag: {
    label: "双路检索",
    icon: "🔍",
    description: "FAISS 关键词向量检索 + LightRAG 自然语言图谱检索",
  },
  deep_retrieve: {
    label: "多维检索",
    icon: "🔬",
    description: "从多个临床维度系统检索同一主题",
  },
  cross_check: {
    label: "交叉验证",
    icon: "✅",
    description: "检测多篇文献结论一致性，发现证据矛盾",
  },
  get_evidence: {
    label: "文献覆盖",
    icon: "📋",
    description: "查询单篇文献在知识库中的覆盖范围",
  },
  list_docs: {
    label: "文献清单",
    icon: "📚",
    description: "列出知识库全部文献及文本块数量",
  },
  extract_chart: {
    label: "图表提取",
    icon: "📊",
    description: "搜索文献中与指定图表相关的文本片段",
  },
  analyze_image: {
    label: "VLM 分析",
    icon: "🔬",
    description: "多模态模型实时分析图表，提取效应量/CI/p值",
  },
  estimate_grade: {
    label: "GRADE 评级",
    icon: "⭐",
    description: "对医学证据进行 GRADE 证据质量评级",
  },
  build_consistency_matrix: {
    label: "一致性矩阵",
    icon: "🧩",
    description: "构建多文献结论一致性分析矩阵",
  },
  self_reflect: {
    label: "回溯重搜",
    icon: "🔄",
    description: "低置信度时自动简化检索词重新搜索",
  },
};

export function useAgentChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [generating, setGenerating] = useState(false);
  const [activeSteps, setActiveSteps] = useState<ToolStep[]>([]);
  const msgIdRef = useRef(0);

  const sendMessage = useCallback(async (question: string) => {
    if (!question.trim() || generating) return;
    const trimmed = question.trim();
    setGenerating(true);

    // Add user message
    const userMsg: ChatMessage = {
      id: ++msgIdRef.current, role: "user",
      content: trimmed, citations: [], toolSteps: [], elapsed: 0,
    };
    setMessages((p) => [...p, userMsg]);

    // Prepare assistant message placeholder
    const aiMsgId = ++msgIdRef.current;
    const aiMsg: ChatMessage = {
      id: aiMsgId, role: "assistant",
      content: "", citations: [], toolSteps: [], elapsed: 0,
    };
    setMessages((p) => [...p, aiMsg]);
    setActiveSteps([]);

    const collectedSteps: ToolStep[] = [];
    const startTime = Date.now();

    try {
      await api.streamAgent(
        trimmed,
        // onStep
        (data: any) => {
          const toolName = data.tool || "unknown";
          const registry = TOOL_REGISTRY[toolName] || {
            label: toolName, icon: "⚙️", description: "",
          };

          let detail = "";
          try {
            if (data.preview) {
              const pv = typeof data.preview === "string" ? data.preview : JSON.stringify(data.preview);
              // Extract hit count for search_rag
              if (toolName === "search_rag") {
                const match = pv.match(/("ref"\s*[:=]\s*\d+)/g);
                if (match) detail = `命中 ${match.length} 条文献`;
                else detail = pv.substring(0, 120);
              } else if (toolName === "deep_retrieve") {
                detail = `维度: ${(data.args?.aspects || []).join(", ")}`;
              } else if (toolName === "cross_check") {
                detail = `对比 ${data.args?.topic || ""}`;
              } else if (toolName === "analyze_image") {
                detail = `VLM 分析: ${data.args?.analysis_hint || data.args?.image_path || ""}`;
              } else if (toolName === "estimate_grade") {
                detail = `评级: ${data.args?.topic || ""}`;
              } else if (toolName === "self_reflect") {
                detail = data.args?.reason?.[0] || "重新检索";
              } else {
                detail = pv.substring(0, 120);
              }
            }
          } catch {}

          const step: ToolStep = {
            id: collectedSteps.length + 1,
            tool: toolName,
            args: data.args || {},
            preview: data.preview || "",
            elapsed: data.elapsed || ((Date.now() - startTime) / 1000),
            label: registry.label,
            icon: registry.icon,
            description: registry.description,
            detail,
          };
          collectedSteps.push(step);
          setActiveSteps([...collectedSteps]);
        },
        // onAnswer
        (data: any) => {
          const citations: Citation[] = (data.sources || []).map((s: any) => ({
            title: s.title || s.source || String(s),
            source: s.source || s.title || "",
            type: s.type || "文献",
            image_url: s.image_url,
            chart_type: s.chart_type,
            text_preview: s.text_preview,
          }));
          setMessages((p) => p.map((m) =>
            m.id === aiMsgId
              ? { ...m, content: data.answer || "", citations, toolSteps: [...collectedSteps], elapsed: data.elapsed || ((Date.now() - startTime) / 1000) }
              : m
          ));
        },
        // onError
        (err: string) => {
          setMessages((p) => p.map((m) =>
            m.id === aiMsgId
              ? { ...m, content: `抱歉，处理请求时出错: ${err}`, toolSteps: [...collectedSteps], elapsed: (Date.now() - startTime) / 1000 }
              : m
          ));
        },
        // onDone
        () => {
          setGenerating(false);
          setActiveSteps([]);
        }
      );
    } catch (err: any) {
      setMessages((p) => p.map((m) =>
        m.id === aiMsgId
          ? { ...m, content: `连接失败: ${err.message || "未知错误"}`, toolSteps: [...collectedSteps], elapsed: (Date.now() - startTime) / 1000 }
          : m
      ));
      setGenerating(false);
      setActiveSteps([]);
    }
  }, [generating]);

  return { messages, generating, activeSteps, sendMessage };
}
