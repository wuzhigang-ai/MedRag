@echo off
echo ============================================
echo   MedASR — 医疗RAG知识库系统
echo ============================================
echo.

REM Check Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python not found. Please install Python 3.11+
    pause
    exit /b 1
)

REM Check .env
if not exist .env (
    echo [WARN] .env file not found.
    echo Copy .env.example to .env and fill in API keys.
    copy .env.example .env
    echo Created .env from .env.example — please edit it with your API keys.
    pause
    exit /b 1
)

REM Check dependencies
echo Checking dependencies...
python -c "import fastapi, uvicorn, openai, sentence_transformers, faiss, numpy" >nul 2>&1
if %errorlevel% neq 0 (
    echo [WARN] Some dependencies missing. Installing...
    pip install -r requirements.txt
)

REM Create required directories
if not exist cache mkdir cache
if not exist uploads mkdir uploads
if not exist output mkdir output

echo.
echo Starting MedASR server...
echo Open http://localhost:8000 in your browser
echo Login: admin / admin123 (admin) or user / user123 (user)
echo Press Ctrl+C to stop
echo.

python -m uvicorn api:app --host 0.0.0.0 --port 8000

pause
