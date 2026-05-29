/**
 * MedRAG REST API Adapter — drop-in replacement for tRPC.
 * All existing trpc.xxx.yyy.useQuery() / useMutation() calls work unchanged.
 * Routes calls to src/lib/api.ts → Python FastAPI backend.
 */
import { useQuery, useMutation, useQueryClient, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ReactNode } from "react";

// ── useUtils: tRPC cache invalidation → React Query ──
function createUseUtils() {
    return function useUtils() {
        const qc = useQueryClient();
        return new Proxy({} as any, {
            get(_target, moduleName: string) {
                if (moduleName === "invalidate") {
                    return () => qc.invalidateQueries();
                }
                return new Proxy({} as any, {
                    get(_target2, method: string) {
                        if (method === "invalidate") {
                            return () => qc.invalidateQueries({ queryKey: [moduleName] });
                        }
                        return {
                            invalidate: () => qc.invalidateQueries({ queryKey: [moduleName, method] }),
                        };
                    },
                });
            },
        });
    };
}

// ── REST Adapter ───────────────────────────────────
function createRESTAdapter() {
    const cache = new Map<string, any>();

    function getModule(moduleName: string): any {
        if (cache.has(moduleName)) return cache.get(moduleName);

        const mod = new Proxy({} as Record<string, any>, {
            get(_target, method: string) {
                return {
                    useQuery(params?: any, opts?: any) {
                        const qKey = [moduleName, method, params];
                        return useQuery({
                            queryKey: qKey,
                            queryFn: async () => {
                                const fn = getNestedFn(api, moduleName, method);
                                if (!fn) return null;
                                return callApiFn(fn, params);
                            },
                            ...opts,
                        });
                    },
                    useMutation(opts?: any) {
                        return useMutation({
                            mutationFn: async (args?: any) => {
                                const fn = getNestedFn(api, moduleName, method);
                                if (!fn) throw new Error(`API not found: ${moduleName}.${method}`);
                                return callApiFn(fn, args);
                            },
                            ...opts,
                        });
                    },
                };
            },
        });

        cache.set(moduleName, mod);
        return mod;
    }

    return new Proxy({} as any, {
        get(_target, moduleName: string) {
            return getModule(moduleName);
        },
    });
}

function getNestedFn(obj: any, moduleName: string, method: string): Function | null {
    const mod = obj[moduleName];
    if (!mod) return null;
    const fn = mod[method];
    return typeof fn === "function" ? fn : null;
}

/**
 * Smart argument mapping: handles tRPC conventions → REST conventions.
 *
 * tRPC mutations often pass { id, ...other } as a single object.
 * Our REST API expects id as first positional arg.
 *
 * Examples:
 *   { id: 1 }                          → fn(1)
 *   { id: 1, status: "approved" }      → fn(1, "approved") or fn(1, { status: "approved" })
 *   { title: "hello" }                 → fn({ title: "hello" })
 *   "simpleString"                     → fn("simpleString")
 */
function callApiFn(fn: Function, args: any): any {
    if (args === null || args === undefined) return fn();

    // Non-object → pass directly
    if (typeof args !== "object" || Array.isArray(args)) return fn(args);

    const keys = Object.keys(args);

    // { id: N } or { id: N, ...rest }
    if ("id" in args) {
        const { id, ...rest } = args;
        const restKeys = Object.keys(rest);
        if (restKeys.length === 0) {
            return fn(id);
        }
        if (restKeys.length === 1) {
            // Try fn(id, value) — e.g. updateStatus(id, "approved")
            return fn(id, rest[restKeys[0]]);
        }
        return fn(id, rest);
    }

    // { sessionId: N, ...rest } → fn(sessionId, rest)
    if ("sessionId" in args) {
        const { sessionId, ...rest } = args;
        return fn(sessionId, rest);
    }

    // { messageId: N, ...rest } → fn(messageId, rest)
    if ("messageId" in args) {
        const { messageId, ...rest } = args;
        return fn(messageId, rest);
    }

    // { articleId: N, ...rest } → fn(articleId, rest)
    if ("articleId" in args) {
        const { articleId, ...rest } = args;
        return fn(articleId, rest);
    }

    // Plain object → pass as-is
    return fn(args);
}

const _adapter = createRESTAdapter();
const _directProps = { useUtils: createUseUtils() };
export const trpc = new Proxy(_directProps, {
    get(target, prop: string) {
        if (prop in target) return (target as any)[prop];
        return (_adapter as any)[prop];
    },
});

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
