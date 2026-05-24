// @ts-nocheck — CopilotKit runtime types
import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import OpenAI from "openai";
import { NextRequest } from "next/server";

const BACKEND = process.env.BACKEND_URL || "http://localhost:8000";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "sk-placeholder",
});

const serviceAdapter = new OpenAIAdapter({
  openai,
  model: process.env.OPENAI_MODEL || "gpt-4o-mini",
});

const runtime = new CopilotRuntime({
  agents: {
    default: {
      name: "medasr-agent",
      description: "MedASR医学文献检索助手",
      actions: [
    {
      name: "search_rag",
      description: "搜索医学文献知识库，返回相关文献片段、来源、证据等级",
      parameters: [
        { name: "query", type: "string", description: "检索关键词", required: true },
        { name: "top_k", type: "number", description: "返回数量，默认5" },
      ],
      handler: async ({ query, top_k }: { query: string; top_k?: number }) => {
        const res = await fetch(`${BACKEND}/api/query`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: query, top_k: top_k || 5 }),
        });
        const data = await res.json();
        return { answer: data.answer, sources: data.sources || [] };
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
      name: "cross_check",
      description: "检查多篇文献关于某主题的结论一致性",
      parameters: [
        { name: "topic", type: "string", description: "需要验证的医学主题", required: true },
      ],
      handler: async ({ topic }: { topic: string }) => {
        const res = await fetch(`${BACKEND}/api/agent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: `跨文献一致性验证: ${topic}`, top_k: 8 }),
        });
        const data = await res.json();
        return { answer: data.answer };
      },
    },
    {
      name: "extract_chart",
      description: "提取医学文献中图表的结构化数据",
      parameters: [
        { name: "doc_name", type: "string", description: "文献名称", required: true },
        { name: "chart_hint", type: "string", description: "图表提示", required: true },
      ],
      handler: async ({ doc_name, chart_hint }: { doc_name: string; chart_hint: string }) => {
        const res = await fetch(`${BACKEND}/api/query`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: `${doc_name} ${chart_hint} 数据提取`, top_k: 10 }),
        });
        const data = await res.json();
        return { answer: data.answer };
      },
    },
  ],
    },
  },
});

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });
  return handleRequest(req);
};
