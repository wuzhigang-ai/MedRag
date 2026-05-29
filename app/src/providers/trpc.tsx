import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import superjson from "superjson";
import type { AppRouter } from "../../api/router";
import type { ReactNode } from "react";

export const trpc = createTRPCReact<AppRouter>();

// ── Environment Detection ──────────────────────────────────────
const isFileProtocol = typeof window !== "undefined" && window.location.protocol === "file:";
const isLocalhost = typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

// ── API URL ────────────────────────────────────────────────────
// When deployed as static site, backend runs separately
// When running in dev mode (vite), backend is proxied via /api
const apiUrl = isFileProtocol ? "http://localhost:3000/api/trpc" : "/api/trpc";

// ── Global Error Handler ───────────────────────────────────────
let hasShownOfflineWarning = false;

function handleTrpcError(error: unknown) {
  const err = error as { message?: string; code?: string };
  
  // Network errors (backend unavailable)
  if (err?.code === "FETCH_ERROR" || err?.code === "TIMEOUT_ERROR") {
    if (!hasShownOfflineWarning) {
      console.warn("[MedRAG] Backend API unavailable. Some features may not work.");
      hasShownOfflineWarning = true;
      // Reset after 30 seconds to allow retry
      setTimeout(() => { hasShownOfflineWarning = false; }, 30000);
    }
    return;
  }
  
  // Auth errors
  if (err?.code === "UNAUTHORIZED") {
    console.warn("[MedRAG] Authentication required.");
    return;
  }
  
  // Other errors logged silently
  console.error("[MedRAG] API Error:", err?.message || "Unknown error");
}

// ── QueryClient with Error Tolerance ──────────────────────────
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: isFileProtocol ? false : (failureCount, error) => {
        const err = error as { code?: string };
        // Don't retry auth errors
        if (err?.code === "UNAUTHORIZED") return false;
        // Don't retry network errors after 2 attempts
        if (err?.code === "FETCH_ERROR" && failureCount >= 2) return false;
        return failureCount < 3;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
      refetchOnWindowFocus: !isFileProtocol,
      staleTime: 60 * 1000,
      // Graceful fallback when API is unavailable
      ...(isFileProtocol ? { enabled: false } : {}),
    },
    mutations: {
      retry: isFileProtocol ? false : 1,
    },
  },
});

// ── tRPC Client ────────────────────────────────────────────────
const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: apiUrl,
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: isFileProtocol ? "same-origin" : "include",
        });
      },
      // Max batch size for performance
      maxURLLength: 2083,
    }),
  ],
});

// ── Provider ───────────────────────────────────────────────────
export function TRPCProvider({ children }: { children: ReactNode }) {
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
