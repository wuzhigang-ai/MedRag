/**
 * MedRAG REST API Adapter — drop-in replacement for tRPC.
 * Uses explicit object model (no Proxy) for reliable React Query integration.
 */
import { useQuery, useMutation, useQueryClient, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ReactNode } from "react";

// ── Utility: call API function with smart arg unwrapping ──
function callApiFn(fn: Function, args: any): any {
    if (args === null || args === undefined) return fn();
    if (typeof args !== "object" || Array.isArray(args)) return fn(args);
    // { id: N } → fn(N)
    if ("id" in args && Object.keys(args).length === 1) return fn(args.id);
    // { id: N, status: "approved" } → fn(N, "approved")
    if ("id" in args && "status" in args && Object.keys(args).length === 2) return fn(args.id, args.status);
    // { id: N, ...rest } → fn(N, rest)
    if ("id" in args) { const { id, ...rest } = args; return fn(id, rest); }
    // { sessionId: N, ...rest }
    if ("sessionId" in args) { const { sessionId, ...rest } = args; return fn(sessionId, rest); }
    // { messageId: N, ...rest }
    if ("messageId" in args) { const { messageId, ...rest } = args; return fn(messageId, rest); }
    // { articleId: N, ...rest }
    if ("articleId" in args) { const { articleId, ...rest } = args; return fn(articleId, rest); }
    return fn(args);
}

// ── Hook Factory ──────────────────────────────────
type QueryHook = (params?: any, opts?: any) => any;
type MutationHook = (opts?: any) => any;

interface ModuleDef {
    [method: string]: {
        useQuery?: (params?: any, opts?: any) => any;
        useMutation?: (opts?: any) => any;
    };
}

function makeQueryHook(moduleName: string, method: string): QueryHook {
    return (params?: any, opts?: any) => {
        const qKey = [moduleName, method, params];
        return useQuery({
            queryKey: qKey,
            queryFn: async () => {
                const mod = (api as any)[moduleName];
                const fn = mod?.[method];
                if (typeof fn !== "function") return null;
                return callApiFn(fn, params);
            },
            ...opts,
        });
    };
}

function makeMutationHook(moduleName: string, method: string): MutationHook {
    return (opts?: any) => {
        return useMutation({
            mutationFn: async (args?: any) => {
                const mod = (api as any)[moduleName];
                const fn = mod?.[method];
                if (typeof fn !== "function") throw new Error(`API: ${moduleName}.${method}`);
                return callApiFn(fn, args);
            },
            ...opts,
        });
    };
}

// ── Module Builder ────────────────────────────────
function buildModule(name: string, methods: string[]) {
    const mod: Record<string, any> = {};
    for (const m of methods) {
        mod[m] = {
            useQuery: makeQueryHook(name, m),
            useMutation: makeMutationHook(name, m),
        };
    }
    return mod;
}

// ── Explicit Modules (no Proxy) ───────────────────
const _modules = {
    auth: buildModule("auth", ["me", "login", "register", "logout"]),
    articles: buildModule("articles", [
        "list", "get", "create", "updateStatus", "approve", "delete",
        "addSegments", "addFigures", "stats",
    ]),
    chat: buildModule("chat", [
        "listSessions", "createSession", "getSession", "addMessage",
        "deleteSession", "rateMessage",
    ]),
    knowledge: buildModule("knowledge", ["getGraph", "stats", "searchNodes", "listNodes", "getNode", "createNode", "createEdge", "search"]),
    stats: buildModule("stats", ["system", "trends", "departmentDist"]),
    notes: buildModule("notes", ["list", "get", "create", "update", "delete", "deleteMany"]),
};

// ── useUtils: cache invalidation ──────────────────
function createUseUtils() {
    return function useUtils() {
        const qc = useQueryClient();
        // Build utils shape: utils.articles.list.invalidate() etc.
        const handler: ProxyHandler<any> = {
            get(_target: any, moduleName: string) {
                if (moduleName === "invalidate") return () => qc.invalidateQueries();
                if (moduleName === "then") return undefined; // prevent Promise-like behavior
                return new Proxy({}, {
                    get(_t2: any, method: string) {
                        if (method === "invalidate") return () => qc.invalidateQueries({ queryKey: [moduleName] });
                        if (method === "then") return undefined;
                        return {
                            invalidate: () => qc.invalidateQueries({ queryKey: [moduleName, method] }),
                        };
                    },
                });
            },
        };
        return new Proxy({}, handler);
    };
}

// ── Export ────────────────────────────────────────
export const trpc: any = {
    ..._modules,
    useUtils: createUseUtils(),
};

// ── Query Client ────────────────────────────────
const isFileProtocol = typeof window !== "undefined" && window.location.protocol === "file:";

export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: isFileProtocol ? 0 : 2,
            staleTime: 60_000,
            refetchOnWindowFocus: !isFileProtocol,
        },
        mutations: {
            retry: 1,
        },
    },
});

// ── Provider ────────────────────────────────────
export function TRPCProvider({ children }: { children: ReactNode }) {
    return (
        <QueryClientProvider client={queryClient}>
            {children}
        </QueryClientProvider>
    );
}

export default trpc;
