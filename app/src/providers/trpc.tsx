/**
 * MedRAG REST API Adapter — drop-in replacement for tRPC.
 * All existing trpc.xxx.yyy.useQuery() / useMutation() calls work unchanged.
 * Routes calls to src/lib/api.ts → Python FastAPI backend.
 */
import { useQuery, useMutation, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ReactNode } from "react";

// ── Global Error Handler ───────────────────────────────────────
let hasShownOfflineWarning = false;

// ── REST Adapter (matches tRPC interface) ──────────────────────
function createRESTAdapter() {
    const cache = new Map<string, any>();

    function getModule(moduleName: string): any {
        if (cache.has(moduleName)) return cache.get(moduleName);

        const mod = new Proxy({} as Record<string, any>, {
            get(_target, method: string) {
                // Map camelCase to snake_case (tRPC convention → REST convention)
                const restMethod = method; // keep as-is: list, get, create, etc.

                return {
                    useQuery(params?: any, opts?: any) {
                        const qKey = [moduleName, restMethod, params];
                        return useQuery({
                            queryKey: qKey,
                            queryFn: async () => {
                                const fn = getNestedFn(api, moduleName, restMethod);
                                if (!fn) return null;
                                return params ? fn(params) : fn();
                            },
                            ...opts,
                        });
                    },
                    useMutation(opts?: any) {
                        return useMutation({
                            mutationFn: async (args?: any) => {
                                const fn = getNestedFn(api, moduleName, restMethod);
                                if (!fn) throw new Error(`API not found: ${moduleName}.${restMethod}`);
                                if (typeof args === "object" && args !== null) {
                                    // For chat.addMessage, the first arg is sessionId
                                    // For articles.updateStatus, first arg is id
                                    const sig = fn.toString();
                                    if (sig.includes("sessionId") || (moduleName === "chat" && restMethod === "addMessage")) {
                                        if (args.sessionId) return fn(args.sessionId, args);
                                    }
                                    if ((moduleName === "articles" && ["updateStatus", "approve", "delete", "get"].includes(restMethod)) ||
                                        (moduleName === "chat" && ["getSession", "deleteSession"].includes(restMethod))) {
                                        if (args.id) return fn(args.id, args);
                                    }
                                }
                                return fn(args);
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
    if (typeof fn === "function") return fn;
    return null;
}

export const trpc = createRESTAdapter();

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
