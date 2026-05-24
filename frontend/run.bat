@echo off
echo ============================================
echo   MedASR Frontend — Next.js + CopilotKit
echo ============================================
echo.
echo NOTE: Turbopack has a Chinese-path bug.
echo Build from an ASCII-only path (e.g. C:\medasr-app)
echo or copy this directory to an ASCII path first.
echo.
echo Starting dev server on port 3000...
echo Python backend should be running on port 8000
echo.
npm run dev -- -p 3000
