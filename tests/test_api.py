"""Test API endpoints

Tests verify endpoint structure and correctness.
Requires BAIDU_API_KEY in .env for LLM-dependent tests to pass fully.
"""
import sys
import os
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
load_dotenv()

from fastapi.testclient import TestClient
from openai import AuthenticationError


def _has_llm_key():
    """Check if any valid LLM API key is configured."""
    # Pipeline uses BAIDU_API_KEY for RAG queries
    if os.getenv("BAIDU_API_KEY"):
        return True
    # XUNFEI_API_KEY for LightRAG/entity extraction
    if os.getenv("XUNFEI_API_KEY"):
        return True
    return False


def test_health():
    from api import app
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    print("OK /health returns 200")


def test_api_routes_registered():
    """Verify all expected routes exist on the app."""
    from api import app
    client = TestClient(app)

    # /api/agent should return 422 (missing body) not 404 (not found)
    response = client.post("/api/agent")
    assert response.status_code != 404, "/api/agent returned 404 - endpoint not registered"

    # /api/query should return 422 (missing body) not 404
    response = client.post("/api/query")
    assert response.status_code != 404, "/api/query returned 404 - endpoint not registered"

    print("OK all routes registered")
    routes = [r.path for r in app.routes if hasattr(r, 'methods') and 'POST' in r.methods]
    print(f"  POST routes: {routes}")


def test_query_faiss():
    """Test /api/query with auto-fallback (requires valid BAIDU_API_KEY)."""
    from api import app
    client = TestClient(app)

    if not _has_llm_key():
        print("SKIP /api/query: no BAIDU_API_KEY or XUNFEI_API_KEY in .env")
        return

    try:
        response = client.post("/api/query", json={
            "question": "Stanford B型主动脉夹层的分型是什么？",
            "top_k": 5
        })
        assert response.status_code == 200
        data = response.json()
        assert "answer" in data, f"No answer field: {data.keys()}"
        assert len(data["answer"]) > 20, f"Answer too short: {len(data['answer'])} chars"
        assert data["source_count"] > 0, f"No sources returned"
        print(f"OK /api/query: {data['source_count']} sources, engine={data.get('engine', 'unknown')}")
    except AuthenticationError:
        print("SKIP /api/query: API key invalid (check BAIDU_API_KEY in .env)")


def test_agent_endpoint():
    """Test /api/agent multi-hop reasoning endpoint (requires valid BAIDU_API_KEY)."""
    from api import app
    client = TestClient(app)

    if not _has_llm_key():
        print("SKIP /api/agent: no BAIDU_API_KEY or XUNFEI_API_KEY in .env")
        return

    try:
        response = client.post("/api/agent", json={
            "question": "Stanford B型主动脉夹层的分型是什么？",
            "top_k": 5
        })
        assert response.status_code == 200
        data = response.json()
        assert "answer" in data, f"No answer field: {data.keys()}"
        assert "reasoning_trace" in data, f"No reasoning_trace field: {data.keys()}"
        assert "steps" in data, f"No steps field: {data.keys()}"
        assert "model" in data, f"No model field: {data.keys()}"
        assert len(data["answer"]) > 20, f"Answer too short: {len(data['answer'])} chars"
        print(f"OK /api/agent: {data['steps']} steps, model={data.get('model', 'unknown')}")
    except AuthenticationError:
        print("SKIP /api/agent: API key invalid (check BAIDU_API_KEY in .env)")


def test_status():
    from api import app
    client = TestClient(app)
    response = client.get("/api/status")
    assert response.status_code == 200
    data = response.json()
    assert data["total_chunks"] > 0
    assert data["total_documents"] > 0
    print(f"OK /api/status: {data['total_chunks']} chunks, {data['total_documents']} docs")


if __name__ == "__main__":
    test_health()
    test_api_routes_registered()
    test_query_faiss()
    test_agent_endpoint()
    test_status()
    print("\nAll API tests passed!")
