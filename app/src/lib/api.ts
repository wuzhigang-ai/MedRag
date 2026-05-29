/**
 * MedRAG REST API Client — replaces tRPC calls with native fetch().
 * All endpoints map to Python FastAPI backend (src/api_business.py).
 */

const BASE = ""; // Same-origin; Vite proxies /api to backend

async function request<T>(path: string, options?: RequestInit): Promise<T> {
    const url = BASE + path;
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...((options?.headers as Record<string, string>) || {}),
    };
    const token = localStorage.getItem("medasr_token");
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        let msg = text;
        try {
            const j = JSON.parse(text);
            msg = j.detail || j.message || text;
        } catch {}
        throw new Error(msg || `HTTP ${res.status}`);
    }
    if (res.status === 204) return undefined as T;
    return res.json();
}

function get<T>(path: string): Promise<T> {
    return request<T>(path);
}

function post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
        method: "POST",
        body: body ? JSON.stringify(body) : undefined,
    });
}

function patch<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
        method: "PATCH",
        body: body ? JSON.stringify(body) : undefined,
    });
}

function del<T>(path: string): Promise<T> {
    return request<T>(path, { method: "DELETE" });
}

// Upload uses FormData, no JSON content-type
async function upload<T>(path: string, formData: FormData): Promise<T> {
    const token = localStorage.getItem("medasr_token");
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(BASE + path, {
        method: "POST",
        headers,
        body: formData,
    });
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `HTTP ${res.status}`);
    }
    return res.json();
}

export const api = {
    // ── Auth ──
    auth: {
        me: () => get<{ user: any }>("/api/auth/me"),
        login: (data: { username: string; password: string }) =>
            post<{ token: string; user: any }>("/api/auth/login", data),
        register: (data: { username: string; password: string; confirmPassword: string; role?: string }) =>
            post<{ success: boolean }>("/api/auth/register", data),
        logout: () => post<{ success: boolean }>("/api/auth/logout"),
    },

    // ── Articles ──
    articles: {
        list: (params?: { status?: string; search?: string; articleType?: string; department?: string }) => {
            const qs = new URLSearchParams();
            if (params?.status) qs.set("status", params.status);
            if (params?.search) qs.set("search", params.search);
            if (params?.articleType) qs.set("articleType", params.articleType);
            if (params?.department) qs.set("department", params.department);
            const q = qs.toString();
            return get<any[]>(`/api/articles${q ? "?" + q : ""}`);
        },
        get: (id: number) => get<any>(`/api/articles/${id}`),
        create: (data: any) => post<{ id: number }>("/api/articles", data),
        updateStatus: (id: number, status: string) =>
            patch<{ success: boolean }>(`/api/articles/${id}/status`, { status }),
        approve: (id: number) => post<{ success: boolean }>(`/api/articles/${id}/approve`),
        delete: (id: number) => del<{ success: boolean }>(`/api/articles/${id}`),
        addSegments: (articleId: number, segments: any[]) =>
            post<{ count: number }>(`/api/articles/${articleId}/segments`, { segments }),
        addFigures: (articleId: number, figures: any[]) =>
            post<{ count: number }>(`/api/articles/${articleId}/figures`, { figures }),
        stats: () => get<any>("/api/articles/stats"),
    },

    // ── Chat ──
    chat: {
        listSessions: () => get<any[]>("/api/chat/sessions"),
        createSession: (data: { title?: string; scopeArticles?: number[]; scopeCategories?: string[] }) =>
            post<{ id: number }>("/api/chat/sessions", data),
        getSession: (id: number) => get<any>(`/api/chat/sessions/${id}`),
        addMessage: (sessionId: number, data: {
            role: string; content: string; contentType?: string;
            attachments?: any[]; ragTrace?: any; citations?: any[]; tokenCount?: number;
        }) => post<any>(`/api/chat/sessions/${sessionId}/messages`, data),
        deleteSession: (id: number) => del<{ success: boolean }>(`/api/chat/sessions/${id}`),
        rateMessage: (messageId: number, data: { rating: number; feedback?: string }) =>
            post<{ success: boolean }>(`/api/chat/messages/${messageId}/rate`, data),
    },

    // ── Knowledge Graph ──
    knowledge: {
        getGraph: () => get<{ nodes: any[]; edges: any[]; stats: any }>("/api/graph"),
        stats: () => get<any>("/api/graph/stats"),
        searchNodes: (query: string) => get<any[]>(`/api/graph/nodes/search?query=${encodeURIComponent(query)}`),
    },

    // ── Stats ──
    stats: {
        system: () => get<any>("/api/stats/system"),
        trends: () => get<any[]>("/api/stats/trends"),
        departmentDist: () => get<any[]>("/api/stats/department-dist"),
    },

    // ── Upload (existing endpoint) ──
    upload: (file: File) => {
        const fd = new FormData();
        fd.append("file", file);
        return upload<any>("/api/upload", fd);
    },

    // ── Search (existing endpoint) ──
    search: (question: string, topK: number = 8) =>
        post<any>("/api/search", { question, top_k: topK }),

    async streamAgent(
        question: string,
        onStep: (data: any) => void,
        onAnswer: (data: any) => void,
        onError: (err: string) => void,
        onDone: () => void
    ): Promise<void> {
        const token = localStorage.getItem("medasr_token");
        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;

        const url = `/api/agent/stream?question=${encodeURIComponent(question)}`;
        try {
            const res = await fetch(url, { headers });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const reader = res.body!.getReader();
            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed.startsWith("data: ")) continue;
                    const raw = trimmed.slice(6);
                    if (raw === "[DONE]") { onDone(); return; }
                    try {
                        const data = JSON.parse(raw);
                        if (data.type === "step") onStep(data);
                        else if (data.type === "answer") onAnswer(data);
                        else if (data.type === "error") onError(data.message || "未知错误");
                    } catch {}
                }
            }
            onDone();
        } catch (e: any) {
            onError(e.message || "连接失败");
        }
    },
};

export default api;
