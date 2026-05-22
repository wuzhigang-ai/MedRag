"""Test frontend routes and mock authentication"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from fastapi.testclient import TestClient


def test_static_routes_return_200():
    """All 4 HTML pages return 200"""
    from api import app
    client = TestClient(app)
    for path in ["/", "/login", "/admin", "/chat"]:
        resp = client.get(path)
        assert resp.status_code == 200, f"{path} returned {resp.status_code}"


def test_login_valid_credentials():
    """Mock login with valid credentials returns role"""
    from api import app
    client = TestClient(app)
    resp = client.post("/api/login", json={"username": "admin", "password": "admin123"})
    assert resp.status_code == 200
    data = resp.json()
    assert "token" in data
    assert data["role"] == "admin"


def test_login_invalid_credentials():
    """Mock login with wrong password returns 401"""
    from api import app
    client = TestClient(app)
    resp = client.post("/api/login", json={"username": "admin", "password": "wrong"})
    assert resp.status_code == 401


def test_register_and_login():
    """Register a new user then login"""
    from api import app
    client = TestClient(app)
    resp = client.post("/api/register", json={"username": "doctor1", "password": "pass123", "role": "user"})
    assert resp.status_code == 200
    assert resp.json()["role"] == "user"

    # Now login with the registered user
    resp2 = client.post("/api/login", json={"username": "doctor1", "password": "pass123"})
    assert resp2.status_code == 200
    assert resp2.json()["role"] == "user"


def test_upload_state_in_status():
    """/api/status includes upload_progress field"""
    from api import app
    from fastapi.testclient import TestClient
    client = TestClient(app)
    resp = client.get("/api/status")
    assert resp.status_code == 200
    data = resp.json()
    assert "upload_progress" in data, f"No upload_progress in: {data.keys()}"
    up = data["upload_progress"]
    assert up["state"] in ("idle", "uploading", "parsing", "indexing", "done", "error")
    print(f"✓ /api/status has upload_progress: {up}")
