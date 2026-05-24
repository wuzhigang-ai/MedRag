/**
 * Backend API Client — proxies requests to Python FastAPI (port 8000)
 */

// In browser, use localhost:8000 directly. Server-side can use env var.
const BACKEND = typeof window !== "undefined"
  ? "http://localhost:8000"
  : (process.env.NEXT_PUBLIC_BACKEND_URL || process.env.BACKEND_URL || "http://localhost:8000");

export interface GraphData {
  nodes: Array<{ id: string; label: string; weight: number; group: string }>;
  edges: Array<{ source: string; target: string; weight: number }>;
  stats: { total_nodes: number; total_edges: number; total_docs: number };
  groups: string[];
}

export interface AgentResponse {
  question: string;
  answer: string;
  reasoning_trace: Array<{ step: number; tool: string; args: unknown; result_preview: string }>;
  steps: number;
  model: string;
  sources: Array<{ title: string; type: string }>;
}

export interface KBStatus {
  total_chunks: number;
  total_documents: number;
  index_size: number;
  lightrag_ready: boolean;
  unique_sources: string[];
  upload_progress: { state: string; filename?: string; error?: string; chunks_added?: number };
}

async function fetchBackend<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${BACKEND}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error((err as { detail?: string }).detail || `HTTP ${res.status}`);
  }
  return res.json();
}

export const backend = {
  // Auth
  login: (username: string, password: string) =>
    fetchBackend<{ token: string; role: string; username: string }>("/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  register: (username: string, password: string, role = "user") =>
    fetchBackend<{ token: string; role: string; username: string }>("/api/register", {
      method: "POST",
      body: JSON.stringify({ username, password, role }),
    }),

  // RAG
  query: (question: string, topK = 8) =>
    fetchBackend<{ question: string; answer: string; source_count: number; sources: unknown[]; engine: string }>(
      "/api/query",
      { method: "POST", body: JSON.stringify({ question, top_k: topK }) }
    ),

  agentQuery: (question: string, topK = 8) =>
    fetchBackend<AgentResponse>("/api/agent", {
      method: "POST",
      body: JSON.stringify({ question, top_k: topK }),
    }),

  // Knowledge Graph
  getGraph: () => fetchBackend<GraphData>("/api/graph"),

  getGraphDelta: () =>
    fetchBackend<{
      new_nodes: GraphData["nodes"];
      new_edges: GraphData["edges"];
      new_node_count: number;
      new_edge_count: number;
    }>("/api/graph/delta"),

  // Status
  getStatus: () => fetchBackend<KBStatus>("/api/status"),

  // Files
  getFiles: () => fetchBackend<{ files: Array<{ name: string; size_kb: number; status: string }> }>("/api/files"),

  uploadPDF: (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return fetch(`${BACKEND}/api/upload`, { method: "POST", body: formData }).then((r) => r.json());
  },

  // Feedback
  submitFeedback: (question: string, answer: string, rating: string, username: string) =>
    fetchBackend<{ status: string }>("/api/feedback", {
      method: "POST",
      body: JSON.stringify({ question, answer, rating, username }),
    }),
};
