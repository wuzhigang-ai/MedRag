// @ts-nocheck — CopilotKit runtime types
import { CopilotRuntime, OpenAIAdapter } from "@copilotkit/runtime";
import { NextRequest } from "next/server";

const BACKEND = process.env.BACKEND_URL || "http://localhost:8000";

/**
 * CopilotKit Runtime — BFF layer proxying RAG actions to Python backend.
 * Registers 6 medical Agent tools as CopilotKit server actions.
 */
export async function POST(req: NextRequest) {
  const runtime = new CopilotRuntime({
    actions: [
      {
        name: "search_rag",
        description: "搜索医学文献知识库，返回相关文献片段、来源、证据等级",
        parameters: [
          { name: "query", type: "string", description: "中文检索关键词", required: true },
          { name: "top_k", type: "number", description: "返回数量，默认5" },
        ],
        handler: async ({ query, top_k }) => {
          const res = await fetch(`${BACKEND}/api/query`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question: query, top_k: top_k || 5 }),
          });
          const data = await res.json();
          return {
            answer: data.answer,
            sources: data.sources,
            engine: data.engine || "faiss",
          };
        },
      },
      {
        name: "cross_check",
        description: "检查多篇文献关于某主题的结论一致性",
        parameters: [
          { name: "topic", type: "string", description: "需要验证的医学主题", required: true },
        ],
        handler: async ({ topic }) => {
          const res = await fetch(`${BACKEND}/api/agent`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question: `跨文献一致性验证: ${topic}`, top_k: 8 }),
          });
          const data = await res.json();
          return { answer: data.answer, sources: data.sources };
        },
      },
      {
        name: "list_docs",
        description: "列出知识库中所有已索引的医学文献",
        parameters: [],
        handler: async () => {
          const res = await fetch(`${BACKEND}/api/graph`);
          const data = await res.json();
          return { groups: data.groups, stats: data.stats };
        },
      },
      {
        name: "get_evidence",
        description: "获取特定文献的详细证据和关键发现",
        parameters: [
          { name: "doc_name", type: "string", description: "文献名称", required: true },
        ],
        handler: async ({ doc_name }) => {
          const res = await fetch(`${BACKEND}/api/query`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question: `文献 ${doc_name} 的关键发现和结论`, top_k: 8 }),
          });
          const data = await res.json();
          return { answer: data.answer, sources: data.sources };
        },
      },
      {
        name: "extract_chart",
        description: "提取医学文献中图表的结构化数据",
        parameters: [
          { name: "doc_name", type: "string", description: "文献名称", required: true },
          { name: "chart_hint", type: "string", description: "图表提示(如Table 1基线特征)", required: true },
        ],
        handler: async ({ doc_name, chart_hint }) => {
          const res = await fetch(`${BACKEND}/api/agent`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question: `提取 ${doc_name} 中的 ${chart_hint} 数据`, top_k: 10 }),
          });
          const data = await res.json();
          return { answer: data.answer, sources: data.sources };
        },
      },
      {
        name: "deep_retrieve",
        description: "从多个角度深度检索同一主题",
        parameters: [
          { name: "topic", type: "string", description: "检索主题", required: true },
          { name: "aspects", type: "string[]", description: "检索角度列表" },
        ],
        handler: async ({ topic, aspects }) => {
          const queries = [topic, ...(Array.isArray(aspects) ? aspects : [])];
          const results = await Promise.all(
            queries.map((q) =>
              fetch(`${BACKEND}/api/query`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ question: q, top_k: 5 }),
              }).then((r) => r.json())
            )
          );
          return { answers: results.map((r) => r.answer), sources: results.flatMap((r) => r.sources || []) };
        },
      },
    ],
  });

  const serviceAdapter = new OpenAIAdapter({
    model: process.env.OPENAI_MODEL || "deepseek-v4-pro",
  });

  const { handleRequest } = runtime;
  return handleRequest(req, serviceAdapter);
}
