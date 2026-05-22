# 端到端自动化 Pipeline — 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** PDF 上传 → 远程 MinerU 解析 → 自动加载索引 → 立即可查询。全自动闭环。

**Architecture:** api.py 后台异步任务 (asyncio.create_task) + pipeline.py SSH 解析 + admin.js 5s 轮询进度条。

**Tech Stack:** FastAPI, paramiko, asyncio, vanilla JS

---

## Git Checkpoint

每个任务完成后 commit:
```bash
git add <files>
git commit -m "<message>"
```
如果出错: `git checkout -- <file>` 或 `git reset --hard HEAD~1`

---

### Task 1: pipeline.py — 添加远程解析 + 状态管理

**Files:**
- Modify: `src/pipeline.py`

**Step 1: 添加 `_upload_state` 属性**

在 `__init__` 中添加:
```python
# Upload progress tracking
self._upload_state = {"state": "idle", "filename": None, "error": None, "chunks_added": 0}
```

**Step 2: 添加 `parse_remote_pdf()` 方法**

```python
def parse_remote_pdf(self, pdf_path: str) -> Optional[str]:
    """SSH远程MinerU解析PDF, 返回content_list JSON的本地路径"""
    import paramiko
    
    remote_host = "82.156.142.212"
    remote_port = 22
    remote_user = "root"
    remote_password = "16693039508@m"
    remote_pdf_dir = "/root/pdfs"
    remote_output_dir = "/root/output"
    
    pdf_path = Path(pdf_path)
    local_output_dir = self.content_dir
    
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    
    try:
        ssh.connect(remote_host, port=remote_port, username=remote_user, password=remote_password, timeout=30)
        sftp = ssh.open_sftp()
        
        # Upload PDF
        remote_pdf = f"{remote_pdf_dir}/{pdf_path.name}"
        sftp.put(str(pdf_path), remote_pdf)
        
        # Run MinerU
        cmd = f"cd /root && source /root/mineru_env/bin/activate 2>/dev/null; export HF_ENDPOINT=https://hf-mirror.com; mineru -p '{remote_pdf}' -o '{remote_output_dir}/{pdf_path.stem}' -b pipeline -l ch --formula True --table True"
        stdin, stdout, stderr = ssh.exec_command(cmd, timeout=600)
        exit_code = stdout.channel.recv_exit_status()
        
        if exit_code != 0:
            raise RuntimeError(f"MinerU failed (exit={exit_code}): {stderr.read().decode()[:500]}")
        
        # Find content_list.json
        find_cmd = f"find {remote_output_dir}/{pdf_path.stem} -name '*_content_list.json' -type f"
        stdin, stdout, stderr = ssh.exec_command(find_cmd)
        files = stdout.read().decode().strip().split('\n')
        
        if not files or not files[0]:
            raise RuntimeError("No content_list.json generated")
        
        remote_json = files[0].strip()
        local_json = local_output_dir / f"{pdf_path.stem}_content_list.json"
        sftp.get(remote_json, str(local_json))
        
        sftp.close()
        ssh.close()
        
        return str(local_json)
    finally:
        try: ssh.close()
        except: pass
```

**Step 3: 修改 `add_document()` 接受 content_list JSON 路径**

在现有 `add_document()` 方法中（或新增 `add_parsed_document()`），加载 content_list JSON 并追加到 FAISS:
```python
def add_parsed_document(self, content_list_path: str) -> int:
    """加载远程解析的content_list JSON, 追加到FAISS索引"""
    with open(content_list_path, encoding='utf-8') as f:
        data = json.load(f)
    
    doc_name = Path(content_list_path).stem.replace('_content_list', '')
    new_chunks = 0
    
    for item in data:
        if item.get('type') == 'text':
            text = item.get('text', '').strip()
            if text and len(text) > 30:
                h = hashlib.md5(text.encode()).hexdigest()
                # Check against existing
                existing_hashes = set(hashlib.md5(c.encode()).hexdigest() for c in self.all_chunks)
                if h in existing_hashes:
                    continue
                self.all_chunks.append(text)
                self.sources.append(f"{doc_name} [p.{item.get('page_idx', '?')}]")
                self.chunk_meta.append({'type': 'text', 'page_idx': item.get('page_idx', 0), 'doc_name': doc_name})
                new_chunks += 1
    
    if new_chunks > 0 and self.faiss_index is not None:
        embeddings = self.encode([self.all_chunks[-(new_chunks):][0]], show_progress=False)  # placeholder
        texts_to_encode = [self.all_chunks[i] for i in range(len(self.all_chunks) - new_chunks, len(self.all_chunks))]
        new_embs = self.encode(texts_to_encode, show_progress=False)
        self.faiss_index.add(new_embs.astype(np.float32))
        self.save_index()
    
    self.doc_count = len(set(s.split(' [p.')[0] for s in self.sources))
    return new_chunks
```

**Step 4: 验证**

```bash
python -c "from src.pipeline import MedicalRAGPipeline; p = MedicalRAGPipeline(); p.load_index(); print('_upload_state:', p._upload_state)"
```

Expected: `_upload_state: {'state': 'idle', ...}`

**Step 5: Commit**

```bash
git add src/pipeline.py
git commit -m "feat: add remote PDF parsing + upload state tracking to pipeline"
```

---

### Task 2: api.py — 异步上传 + 后台解析 + 状态暴露

**Files:**
- Modify: `api.py`

**Step 1: 修改 `/api/upload` 为后台异步任务**

```python
@app.post("/api/upload")
async def upload_pdf(file: UploadFile = File(...)):
    """上传PDF → 后台自动解析 → 自动索引"""
    if not file.filename.endswith('.pdf'):
        raise HTTPException(400, "仅支持PDF文件")
    
    p = get_pipeline()
    
    # Save file
    file_path = UPLOAD_DIR / file.filename
    content = await file.read()
    file_path.write_bytes(content)
    
    # Set uploading state
    p._upload_state = {"state": "uploading", "filename": file.filename, "error": None, "chunks_added": 0}
    
    # Launch background task
    async def process_pdf():
        try:
            p._upload_state["state"] = "parsing"
            content_list_path = await asyncio.to_thread(p.parse_remote_pdf, str(file_path))
            
            p._upload_state["state"] = "indexing"
            n = await asyncio.to_thread(p.add_parsed_document, content_list_path)
            
            p._upload_state = {"state": "done", "filename": file.filename, "error": None, "chunks_added": n}
        except Exception as e:
            p._upload_state = {"state": "error", "filename": file.filename, "error": str(e)[:300], "chunks_added": 0}
    
    asyncio.create_task(process_pdf())
    
    return {"status": "accepted", "filename": file.filename, "message": "PDF上传成功，后台解析中"}
```

**Step 2: 修改 `GET /api/status` 返回上传进度**

在 `kb_status()` 返回中添加:
```python
upload_progress = p._upload_state if hasattr(p, '_upload_state') else {"state": "idle"}
return KBStatusResponse(
    ...,
    upload_progress=upload_progress,
)
```

并在 `KBStatusResponse` 中加字段:
```python
class KBStatusResponse(BaseModel):
    ...
    upload_progress: dict = {}
```

**Step 3: 验证**

```bash
# Start server
python api.py &
sleep 3
# Test upload (must be multipart)
curl -X POST http://localhost:8000/api/upload -F "file=@相关样例/todo1992.pdf"
```

Expected: `{"status":"accepted","filename":"todo1992.pdf",...}`

**Step 4: Commit**

```bash
git add api.py
git commit -m "feat: async background PDF upload → parse → index pipeline"
```

---

### Task 3: admin.js + admin.html — 轮询进度条

**Files:**
- Modify: `static/js/admin.js`
- Modify: `templates/admin.html`

**Step 1: admin.html 添加进度条 UI**

在上传区下方添加:
```html
<div id="uploadProgress" class="upload-progress hidden">
    <div class="progress-bar-container">
        <div class="progress-bar" id="progressBar"></div>
    </div>
    <div class="progress-steps">
        <span class="progress-step" data-step="uploading">📤 上传中</span>
        <span class="progress-step" data-step="parsing">🔧 解析中</span>
        <span class="progress-step" data-step="indexing">📊 索引中</span>
        <span class="progress-step" data-step="done">✅ 完成</span>
    </div>
    <span class="progress-text" id="progressText"></span>
</div>
```

**Step 2: admin.js 轮询逻辑**

在 `handleFileUpload` 成功后添加:
```javascript
// Show progress bar
var progressEl = document.getElementById('uploadProgress');
if (progressEl) progressEl.classList.remove('hidden');

// Poll for progress
var pollInterval = setInterval(async function () {
    try {
        var data = await API.get('/api/status');
        var up = data.upload_progress;
        if (!up) return;
        
        updateProgressUI(up);
        
        if (up.state === 'done') {
            clearInterval(pollInterval);
            fetchStats();
            addFileRow(up.filename, 'indexed');
            Toast.show('解析完成！新文献已加入知识库', 'success');
            setTimeout(function () {
                if (progressEl) progressEl.classList.add('hidden');
            }, 3000);
        } else if (up.state === 'error') {
            clearInterval(pollInterval);
            Toast.show('解析失败: ' + (up.error || '未知错误'), 'error');
        }
    } catch (e) {
        clearInterval(pollInterval);
    }
}, 5000);

function updateProgressUI(up) {
    var steps = document.querySelectorAll('.progress-step');
    var text = document.getElementById('progressText');
    var states = ['uploading', 'parsing', 'indexing', 'done'];
    var idx = states.indexOf(up.state);
    
    steps.forEach(function (s, i) {
        if (i < idx) s.classList.add('done');
        else if (i === idx) s.classList.add('active');
        else s.classList.remove('active', 'done');
    });
    
    if (text) {
        if (up.state === 'parsing') text.textContent = '正在解析 ' + up.filename + '...';
        else if (up.state === 'indexing') text.textContent = '正在构建索引...';
        else if (up.state === 'done') text.textContent = '完成！新增 ' + up.chunks_added + ' 个文本块';
    }
}
```

**Step 3: pages.css 添加进度条样式**

```css
.upload-progress { margin-top: 16px; padding: 20px; background: var(--bg-elevated); border-radius: 12px; border: 1px solid var(--border); }
.upload-progress.hidden { display: none; }
.progress-bar-container { height: 6px; background: var(--bg-surface); border-radius: 3px; margin-bottom: 12px; overflow: hidden; }
.progress-bar { height: 100%; background: linear-gradient(90deg, var(--accent), var(--medical-green)); border-radius: 3px; width: 0%; transition: width 0.5s ease; }
.progress-steps { display: flex; justify-content: space-between; margin-bottom: 8px; }
.progress-step { font-size: 0.8rem; color: var(--text-muted); display: flex; align-items: center; gap: 4px; }
.progress-step.active { color: var(--accent-glow); font-weight: 600; }
.progress-step.done { color: var(--medical-green); }
.progress-text { font-size: 0.8125rem; color: var(--text-secondary); }
```

**Step 4: 验证**

浏览器: Admin 页面上传 PDF → 进度条从 "上传中" 依次走到 "完成"

**Step 5: Commit**

```bash
git add static/js/admin.js templates/admin.html static/css/pages.css
git commit -m "feat: upload progress bar with 5s polling on admin dashboard"
```

---

### Task 4: 端到端测试

**Files:**
- Modify: `tests/test_frontend.py`

**Step 1: 添加上传端点测试**

```python
def test_upload_endpoint():
    """上传PDF返回202"""
    from api import app
    from fastapi.testclient import TestClient
    client = TestClient(app)
    
    # Test with a small PDF (or skip if no test PDF)
    pdf_path = Path("相关样例/todo1992.pdf")
    if not pdf_path.exists():
        print("SKIP: no test PDF available")
        return
    
    with open(pdf_path, 'rb') as f:
        resp = client.post("/api/upload", files={"file": ("test.pdf", f, "application/pdf")})
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "accepted"
    assert data["filename"] == "test.pdf"
    print("✓ /api/upload returns 202 accepted")

def test_status_has_upload_progress():
    """状态接口包含upload_progress字段"""
    from api import app
    from fastapi.testclient import TestClient
    client = TestClient(app)
    resp = client.get("/api/status")
    assert resp.status_code == 200
    data = resp.json()
    assert "upload_progress" in data
    print(f"✓ /api/status has upload_progress: {data['upload_progress']}")
```

**Step 2: 运行测试**

```bash
pytest tests/test_frontend.py -v
```

Expected: 6/6 pass

**Step 3: Commit**

```bash
git add tests/test_frontend.py
git commit -m "test: add upload + progress tests to frontend suite"
```

---

### Task 5: 集成验证

**Files:** None (手动测试)

**Step 1: 启动服务**

```bash
python api.py
```

**Step 2: 完整流程测试**

1. 浏览器 → `http://localhost:8000/login` → 登录 (admin/admin123)
2. 自动跳转 → `/admin`
3. 上传 PDF → 进度条显示 → 完成后文件列表更新
4. 跳转 → `/chat` → 提问新文献相关问题 → 验证检索到新内容

**Step 3: 提交最终检查**

```bash
git status
git log --oneline -5
pytest tests/test_frontend.py -v
```

## Review Decisions (Eng Review 2026-05-23)

- D1: SSH 凭证移到 .env + 从 scripts/remote_parse.py 导入常量
- D2: 维护 `self._seen_hashes` set 避免每次 O(n) 重建
- C1: pipeline.py 调用 `scripts/remote_parse.RemoteMinerUParser` 而非重复实现
- T1: 加 mock 状态变迁测试 (uploading→parsing→indexing→done)

## NOT in scope

| 项目 | 原因 |
|------|------|
| 并行多文件上传 | 比赛 Demo 单文件足够 |
| 上传进度实时 WebSocket 推送 | 5s 轮询已满足需求 |
| 远程服务器健康检查 | SSH 连接成功即健康信号 |

## What already exists

| 能力 | 位置 | 复用 |
|------|------|------|
| SSH/MinerU 逻辑 | `scripts/remote_parse.py:RemoteMinerUParser` | pipeline.py 导入复用 |
| FAISS 增量索引 | `src/pipeline.py:add_document()` | 扩写为 `add_parsed_document()` |
| `/api/upload` | `api.py:215-229` | 改为后台异步任务 |

## Implementation Tasks

- [ ] **T1 (P1)** — `src/pipeline.py` — parse_remote_pdf() + add_parsed_document() + _seen_hashes
  - Files: `src/pipeline.py`, `.env`
  - Verify: `python -c "p = MedicalRAGPipeline(); p.load_index(); print(len(p._seen_hashes))"`

- [ ] **T2 (P1)** — `api.py` — async background upload + upload_progress
  - Files: `api.py`
  - Verify: `pytest tests/test_frontend.py -v`

- [ ] **T3 (P2)** — `admin.js` + `admin.html` — progress bar + 5s poll
  - Files: `static/js/admin.js`, `templates/admin.html`, `static/css/pages.css`

- [ ] **T4 (P2)** — `tests/test_frontend.py` — upload + status + state transition tests
  - Verify: `pytest tests/test_frontend.py -v` 8/8 pass

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 4 issues, 0 critical gaps |

**VERDICT: ENG REVIEW CLEARED — ready to implement.**
