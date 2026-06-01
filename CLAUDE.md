# CLAUDE.md — MedRAG 医疗知识图谱系统

## Mandatory Git Commit Rule (HIGHEST PRIORITY — OVERRIDES ALL OTHER RULES)

**Every single code modification, no matter how small, MUST be committed to the local git repository immediately after the change is made.** This is a non-negotiable, highest-priority global requirement.

- After ANY file edit, write, or creation that changes project source code, immediately run `git add` + `git commit` with a descriptive message
- Do NOT batch multiple unrelated changes into one commit — each logical change gets its own commit
- Do NOT wait for the user to ask you to commit — commit proactively and immediately
- Do NOT skip commits for "trivial" or "temporary" changes — every change matters
- Commit message format: `<type>(<scope>): <brief description>` (e.g., `fix(auth):`, `feat(ui):`, `chore(docs):`, `refactor(api):`)
- After committing, verify with `git status` that the working tree is clean
- If the user explicitly says NOT to commit a specific change, that instruction overrides this rule for that single instance only

**Why:** User consistently demanded immediate local git commits after every code change across 30+ sessions. Lost work, unclear history, and difficulty rolling back changes resulted from delayed commits. This rule ensures 100% traceability and zero lost work.

## Project Architecture

- **Frontend**: React 19 + TypeScript + Vite 7 + Tailwind CSS, located in `app/`
- **Backend**: Python FastAPI + FAISS (BGE-M3) + LightRAG + MySQL 8, located in `src/`
- **Graph Engine**: AntV G6 v5 (d3-force layout) for knowledge graph visualization

## Key Conventions

- Graph node colors: brown-black (#5C4033 dark / #3E2723 light)
- Graph edge colors: red (rgba(239,68,68,0.65) dark / rgba(220,38,38,0.55) light)
- G6 graph uses single useEffect architecture with abort guard
- API calls go through Python FastAPI REST endpoints, not tRPC
- Auth uses JWT Bearer tokens with DB-persisted token management
