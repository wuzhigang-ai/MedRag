import { NextRequest } from "next/server";

const BACKEND = process.env.BACKEND_URL || "http://localhost:8000";

export async function POST(req: NextRequest) {
  const { messages } = await req.json();
  const lastMessage = messages?.[messages.length - 1]?.content || "";

  // Forward to Python Agent SSE endpoint
  const backendRes = await fetch(
    `${BACKEND}/api/agent/stream?question=${encodeURIComponent(lastMessage)}`,
    { headers: { Accept: "text/event-stream" } }
  );

  if (!backendRes.ok) {
    // Fallback to non-streaming endpoint
    const fallbackRes = await fetch(`${BACKEND}/api/agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: lastMessage, top_k: 8 }),
    });
    const data = await fallbackRes.json();
    const answer = data.answer || "抱歉，请求失败。";
    // Return as simulated SSE stream
    return new Response(
      `data: ${JSON.stringify({ type: "text", content: answer })}\n\ndata: [DONE]\n\n`,
      { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } }
    );
  }

  // Stream the SSE response, translating step events to text
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const reader = backendRes.body?.getReader();
      if (!reader) {
        controller.close();
        return;
      }
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data: ")) continue;
            const data = trimmed.slice(6);
            if (data === "[DONE]") {
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              break;
            }
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === "step") {
                // Format tool calls as visible text
                const label = getToolLabel(parsed.tool);
                const preview = parsed.preview ? `: ${parsed.preview.slice(0, 80)}` : "";
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: "step", content: `🔍 ${label}${preview}` })}\n\n`
                  )
                );
              } else if (parsed.type === "answer") {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: "text", content: parsed.answer })}\n\n`
                  )
                );
              } else if (parsed.type === "error") {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ type: "text", content: `❌ ${parsed.message}` })}\n\n`
                  )
                );
              }
            } catch {
              // Skip unparseable lines
            }
          }
        }
      } catch {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "text", content: "连接中断，请重试。" })}\n\n`
          )
        );
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

function getToolLabel(tool: string): string {
  const labels: Record<string, string> = {
    search_rag: "检索知识库",
    cross_check: "交叉验证",
    get_evidence: "获取证据",
    list_docs: "列出文献",
    deep_retrieve: "深度检索",
    extract_chart: "提取图表",
    understand: "理解问题",
    synthesize: "综合回答",
    verify: "验证答案",
  };
  return labels[tool] || tool;
}
