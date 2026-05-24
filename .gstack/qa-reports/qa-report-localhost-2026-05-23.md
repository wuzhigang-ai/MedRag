# QA Report — MedASR 3D Knowledge Graph

**Date:** 2026-05-23
**Target:** http://localhost:8000
**Scope:** Knowledge graph feature (commits 22fa465 + 8e8b12f)
**Mode:** Standard (diff-aware)
**Framework:** FastAPI + vanilla JS

---

## Health Score: 92/100

| Category | Score | Weight | Weighted |
|----------|-------|--------|----------|
| Console | 85 | 15% | 12.75 |
| Links | 100 | 10% | 10.0 |
| Visual | 95 | 10% | 9.5 |
| Functional | 90 | 20% | 18.0 |
| UX | 95 | 15% | 14.25 |
| Performance | 90 | 10% | 9.0 |
| Content | 100 | 5% | 5.0 |
| Accessibility | 90 | 15% | 13.5 |
| **Total** | | | **92.0** |

## Issues Found: 2 (0 critical, 0 high, 1 medium, 1 low)

### ISSUE-001 [Medium/Operational] — Stale bytecode blocks new endpoints

**Severity:** Medium | **Category:** Functional | **Status:** Deferred

After adding new api.py routes, uvicorn served old bytecode. /api/graph returned 404.
Fix: kill server, clear __pycache__/, restart. Add --reload flag for dev.

### ISSUE-002 [Low/Cosmetic] — WebGL ReadPixels GPU warnings

**Severity:** Low | **Category:** Performance | **Status:** Deferred

Headless Chromium WebGL logs GPU stall warnings with 900 nodes. Not reproducible on hardware GPU.

## Pages Tested

| Page | Status | Notes |
|------|--------|-------|
| /login | PASS | Auth redirect works |
| /admin | PASS | Button shows "(863实体 · 771关系)" |
| /admin (graph modal) | PASS | Opens, WebGL renders, closes |
| /chat | PASS | No regressions |

## API Endpoints

| Endpoint | Status | Response |
|----------|--------|----------|
| GET /api/graph | PASS | 863 nodes, 771 edges, 26 groups |
| GET /api/graph/delta | PASS | Empty delta (no snapshot yet) |

## Console: 0 fresh errors after server restart

## Summary

QA found 2 issues (0 critical), fixed 0, health score 92/100. Knowledge graph feature is ship-ready.
