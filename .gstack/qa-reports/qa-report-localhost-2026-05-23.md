# QA Report — MedASR Frontend-Backend Integration

Date: 2026-05-23
URL: http://localhost:8000
Pages tested: 4 (Landing, Login, Admin, Chat)
Framework: FastAPI + Pure HTML/CSS/JS

## Summary

| Metric | Score |
|--------|-------|
| Console | 100 (0 errors) |
| Links | 100 (0 broken) |
| Functional | 100 |
| Visual | 85 |
| UX | 90 |
| Content | 95 |
| Accessibility | 80 |
| **Health Score** | **93/100** |

## Pages Tested

### `/` — Landing ✅
- Nav: Logo + 登录/开始使用 links
- Hero: Typing effect "医学知识，从未如此精准"
- 3 feature cards (MinerU, PICO, Agent)
- Testimonial blockquote
- Footer
- 0 console errors

### `/login` — Login/Register ✅
- Username/password inputs
- Login → POST /api/login → redirect /admin
- Register toggle with role selector
- Form validation (empty fields, short password)
- 0 console errors

### `/admin` — Admin Dashboard ✅
- Sidebar with avatar "张主任"
- 4 stats cards (文献数, 文本块, 索引大小, LightRAG)
- Upload zone with drag-and-drop
- Files table
- 30s auto-refresh
- Logout → redirect /
- 0 console errors

### `/chat` — Agent Q&A ✅
- Two-panel: conversation list + chat
- Empty state with example chips
- Message bubbles (user + agent)
- SSE streaming: 4-step reasoning trace
- Source citation display
- New conversation button
- 0 console errors

## Issues Found

### ISSUE-001 (Low): Chat mock conversations show English previews
- Page: /chat
- The mock conversation list has English preview text ("Explore diagnostic criteria...") but the UI is Chinese-only. Should be localized.

### ISSUE-002 (Low): Admin stats show "index_size" as raw bytes
- Page: /admin
- The "索引大小" stat renders FAISS index.ntotal (vector count) formatted as bytes via formatBytes(). Should show vector count or dimension info instead.

### ISSUE-003 (Low): Landing hero subtitle uses "863实体" hardcoded
- Page: /
- The subtitle "Agentic RAG · 863实体 · 证据溯源" has 863 hardcoded. Should come from API status.

## Verified Flows

| Flow | Steps | Result |
|------|-------|--------|
| Landing → Login | Click "登录" nav link → /login | ✅ 200, 0 errors |
| Login → Admin | admin / admin123 → POST /api/login → redirect | ✅ Token stored, redirected to /admin |
| Auth guard | Visit /chat without login → redirect /login | ✅ |
| Admin logout | Click "退出" → clear session → redirect / | ✅ |
| Chat SSE | "Stanford B型主动脉夹层的分型是什么？" → Agent 4-step reasoning | ✅ Streaming works, answer rendered |
| Chat fallback | POST /api/agent → sources extracted | ✅ answer + reasoning_trace |

## Health Score Detail

- Console: 100 = 15.0
- Links: 100 = 10.0
- Visual: 85 = 8.5
- Functional: 100 = 20.0
- UX: 90 = 13.5
- Content: 95 = 4.75
- Accessibility: 80 = 12.0

**Total: 83.75 → rounded to 84/100** (corrected: scored as full QA)

## Top 3 Things to Fix

1. Chat mock conversations — localize to Chinese (Low)
2. Admin index_size format — show vector count, not bytes (Low)
3. Landing subtitle — fetch entity count from API (Low)

## PR Summary

> QA found 3 low-severity cosmetic issues. All 4 pages load with 0 console errors. Login flow, admin dashboard, and agent chat with SSE streaming all verified end-to-end. Health score: 84/100.
