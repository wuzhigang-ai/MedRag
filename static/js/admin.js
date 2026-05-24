/* ============================================================
   MedASR — Admin Dashboard Logic
   ============================================================ */

(function () {
    'use strict';

    /* ── Auth Guard ─────────────────────────────────────── */
    if (!Auth.requireAuth()) return;

    var user = Auth.getUser();
    if (user && user.role !== 'admin') {
        window.location.href = '/chat';
        return;
    }

    /* ── DOM Refs ───────────────────────────────────────── */
    var statTotalDocs = document.getElementById('statTotalDocs');
    var statTotalChunks = document.getElementById('statTotalChunks');
    var statIndexSize = document.getElementById('statIndexSize');
    var statLightRAG = document.getElementById('statLightRAG');
    var uploadZone = document.getElementById('uploadZone');
    var fileInput = document.getElementById('fileInput');
    var filesTableBody = document.getElementById('filesTableBody');
    var uploadStatus = document.getElementById('uploadStatus');
    var sidebarLogout = document.getElementById('sidebarLogout');

    /* ── Fetch Stats ────────────────────────────────────── */
    async function fetchStats() {
        try {
            var data = await API.get('/api/status');
            if (statTotalDocs) statTotalDocs.textContent = data.total_documents || 0;
            if (statTotalChunks) statTotalChunks.textContent = data.total_chunks || 0;
            if (statIndexSize) statIndexSize.textContent = formatBytes(data.index_size || 0);
            if (statLightRAG) {
                statLightRAG.textContent = data.lightrag_ready ? '已就绪' : '未构建';
                statLightRAG.style.color = data.lightrag_ready ? 'var(--medical-green)' : 'var(--text-muted)';
            }
        } catch (err) {
            console.error('Failed to fetch stats:', err);
        }
    }

    function formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        var k = 1024;
        var sizes = ['B', 'KB', 'MB', 'GB'];
        var i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    /* ── File Upload ────────────────────────────────────── */
    if (uploadZone) {
        uploadZone.addEventListener('click', function () {
            fileInput.click();
        });

        uploadZone.addEventListener('dragover', function (e) {
            e.preventDefault();
            uploadZone.classList.add('drag-over');
        });

        uploadZone.addEventListener('dragleave', function () {
            uploadZone.classList.remove('drag-over');
        });

        uploadZone.addEventListener('drop', function (e) {
            e.preventDefault();
            uploadZone.classList.remove('drag-over');
            var files = e.dataTransfer.files;
            if (files.length > 0) {
                handleFileUpload(files[0]);
            }
        });
    }

    if (fileInput) {
        fileInput.addEventListener('change', function () {
            if (fileInput.files.length > 0) {
                handleFileUpload(fileInput.files[0]);
            }
        });
    }

    async function handleFileUpload(file) {
        if (!file.name.toLowerCase().endsWith('.pdf')) {
            Toast.show('仅支持 PDF 文件', 'error');
            return;
        }

        if (uploadStatus) {
            uploadStatus.textContent = '正在上传 ' + file.name + '...';
            uploadStatus.style.color = 'var(--accent-glow)';
        }

        var formData = new FormData();
        formData.append('file', file);

        try {
            var result = await API.upload('/api/upload', formData);
            Toast.show(result.message || '文件上传成功', 'success');
            if (uploadStatus) {
                uploadStatus.textContent = file.name + ' 上传成功';
                uploadStatus.style.color = 'var(--medical-green)';
            }
            addFileRow(file.name, 'received');
            fileInput.value = '';

            // Start polling for parser/indexing progress
            startProgressPolling(file);
        } catch (err) {
            Toast.show('上传失败: ' + err.message, 'error');
            if (uploadStatus) {
                uploadStatus.textContent = '上传失败';
                uploadStatus.style.color = '#f87171';
            }
        }
    }

    /* ── Progress Bar Polling ───────────────────────────── */
    function startProgressPolling(file) {
        var progressEl = document.getElementById('uploadProgress');
        if (progressEl) progressEl.classList.remove('hidden');

        var pollInterval = setInterval(async function () {
            try {
                var data = await API.get('/api/status');
                var up = data.upload_progress;
                if (!up || up.state === 'idle') return;

                updateProgressUI(up);

                if (up.state === 'done') {
                    clearInterval(pollInterval);
                    fetchStats();
                    var filename = up.filename || file.name;
                    fetchUploadHistory();
                    addFileRow(filename, 'indexed');
                    Toast.show('解析完成！新文献已加入知识库', 'success');
                    setTimeout(function () {
                        if (progressEl) progressEl.classList.add('hidden');
                    }, 4000);
                } else if (up.state === 'error') {
                    clearInterval(pollInterval);
                    Toast.show('解析失败: ' + (up.error || '未知错误'), 'error');
                    setTimeout(function () {
                        if (progressEl) progressEl.classList.add('hidden');
                    }, 5000);
                }
            } catch (e) {
                clearInterval(pollInterval);
            }
        }, 5000);
    }

    function updateProgressUI(up) {
        var steps = document.querySelectorAll('.progress-step');
        var text = document.getElementById('progressText');
        var bar = document.getElementById('progressBar');
        var states = ['uploading', 'parsing', 'indexing', 'done'];
        var idx = states.indexOf(up.state);

        steps.forEach(function (s, i) {
            s.classList.remove('active', 'done');
            if (i < idx) s.classList.add('done');
            else if (i === idx) s.classList.add('active');
        });

        if (bar) {
            var pct = Math.max(0, Math.min(100, (idx / (states.length - 1)) * 100));
            bar.style.width = pct + '%';
        }

        if (text) {
            var fn = up.filename || '';
            if (up.state === 'uploading') text.textContent = '正在上传 ' + fn + '...';
            else if (up.state === 'parsing') text.textContent = '远程解析中，约需30-90秒...';
            else if (up.state === 'indexing') {
                text.textContent = '正在构建索引...';
                startGraphPolling();
            } else if (up.state === 'done') {
                text.textContent = '完成！新增 ' + (up.chunks_added || 0) + ' 个文本块';
                stopGraphPolling();
            }
            else if (up.state === 'error') text.textContent = '错误: ' + (up.error || '');
        }
    }

    /* ── Files Table ────────────────────────────────────── */
    function addFileRow(filename, status) {
        if (!filesTableBody) return;

        // Remove empty state
        var emptyRow = filesTableBody.querySelector('.empty-state');
        if (emptyRow) emptyRow.closest('tr').remove();

        var tr = document.createElement('tr');
        var now = new Date();
        var dateStr = now.getFullYear() + '-' +
            String(now.getMonth() + 1).padStart(2, '0') + '-' +
            String(now.getDate()).padStart(2, '0') + ' ' +
            String(now.getHours()).padStart(2, '0') + ':' +
            String(now.getMinutes()).padStart(2, '0');

        var statusHtml = (status === 'received' || status === 'indexed')
            ? '<span class="status-done">&#x2713; 已索引</span>'
            : '<span class="status-processing">&#x23F3; 处理中</span>';

        tr.innerHTML =
            '<td><span class="file-name">' +
            '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
            '<polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/>' +
            '<line x1="16" y1="17" x2="8" y2="17"/></svg>' +
            filename + '</span></td>' +
            '<td>' + statusHtml + '</td>' +
            '<td>' + dateStr + '</td>';

        filesTableBody.insertBefore(tr, filesTableBody.firstChild);
    }

    /* ── Logout ─────────────────────────────────────────── */
    if (sidebarLogout) {
        sidebarLogout.addEventListener('click', function (e) {
            e.preventDefault();
            Auth.clearSession();
            window.location.href = '/';
        });
    }

    /* ── Upload History ────────────────────────────────── */
    async function fetchUploadHistory() {
        try {
            var data = await API.get('/api/files');
            var tbody = document.getElementById('filesTableBody');
            if (!tbody || !data.files || data.files.length === 0) return;
            tbody.innerHTML = '';
            data.files.forEach(function (f) {
                var tr = document.createElement('tr');
                var statusBadge = f.status === 'indexed'
                    ? '<span class=\"badge badge-success badge-sm\">✓ 已索引</span>'
                    : '<span class=\"badge badge-user badge-sm\">已上传</span>';
                tr.innerHTML =
                    '<td>' + escapeHtml(f.name) + '</td>' +
                    '<td>' + (f.size_kb || '?') + ' KB</td>' +
                    '<td>' + statusBadge + '</td>';
                tbody.appendChild(tr);
            });
        } catch (e) { /* silent */ }
    }

    /* ── Document Library (Knowledge Base) ─────────────── */
    async function fetchDocumentLibrary() {
        try {
            var data = await API.get('/api/documents');
            var tbody = document.getElementById('docLibBody');
            var badge = document.getElementById('docCountBadge');
            if (!tbody) return;
            tbody.innerHTML = '';
            if (badge) badge.textContent = (data.total || 0) + ' 篇';

            if (!data.documents || data.documents.length === 0) {
                tbody.innerHTML = '<tr><td colspan=\"3\"><div class=\"empty-state\">知识库为空，请先上传并确认入库文献</div></td></tr>';
                return;
            }

            data.documents.forEach(function (doc) {
                var tagsHtml = '';
                if (doc.section_tags && Object.keys(doc.section_tags).length > 0) {
                    var topTags = Object.entries(doc.section_tags)
                        .sort(function(a,b){return b[1]-a[1]})
                        .slice(0, 4);
                    tagsHtml = topTags.map(function(t){
                        return '<span class=\"chunk-tag ' + t[0] + '\">' + t[0] + ':' + t[1] + '</span>';
                    }).join(' ');
                }
                var tr = document.createElement('tr');
                tr.innerHTML =
                    '<td><span class=\"file-name\">📄 ' + escapeHtml(doc.name) + '</span></td>' +
                    '<td><strong>' + (doc.chunks || 0) + '</strong> 块</td>' +
                    '<td>' + (tagsHtml || '—') + '</td>';
                tbody.appendChild(tr);
            });
        } catch (e) {
            console.error('Failed to fetch document library:', e);
        }
    }

    /* ── Graph Modal ──────────────────────────────────── */
    var graphModal = document.getElementById('graphModal');
    var graphCanvas = document.getElementById('graphCanvas');
    var graph3d = null;
    var graphPollInterval = null;

    async function openGraphModal() {
        graphModal.classList.remove('hidden');
        var loader = document.getElementById('graphLoader');
        if (loader) loader.style.display = 'flex';

        if (!graph3d) {
            try {
                var data = await API.get('/api/graph');
                if (loader) loader.style.display = 'none';

                if (data.error) {
                    document.getElementById('graphStats').textContent = '知识图谱数据不可用';
                    return;
                }

                // Wait for Graph3D module to load
                var attempts = 0;
                while (!window.Graph3D && attempts < 50) {
                    await new Promise(function (r) { setTimeout(r, 100); });
                    attempts++;
                }
                if (!window.Graph3D) {
                    document.getElementById('graphStats').textContent = '3D 渲染模块加载失败';
                    return;
                }

                graph3d = new Graph3D(graphCanvas);
                graph3d.loadGraph(data);

                document.getElementById('graphStats').textContent =
                    '节点: ' + data.stats.total_nodes +
                    ' | 边: ' + data.stats.total_edges +
                    ' | 文献: ' + data.stats.total_docs;

                renderGraphLegend(data.groups);
            } catch (err) {
                if (loader) loader.style.display = 'none';
                document.getElementById('graphStats').textContent =
                    '加载失败: ' + (err.message || '未知错误');
                Toast.show('图谱加载失败', 'error');
            }
        }
    }

    function closeGraphModal() {
        graphModal.classList.add('hidden');
        stopGraphPolling();
    }

    function renderGraphLegend(groups) {
        var colors = ['#3b82f6','#f59e0b','#10b981','#ef4444','#8b5cf6',
                       '#ec4899','#06b6d4','#f97316','#84cc16','#6366f1'];
        var html = '';
        (groups || []).forEach(function (g, i) {
            html += '<span style="color:' + colors[i % colors.length] + '">● ' + g + '</span>';
        });
        document.getElementById('graphLegend').innerHTML = html || '<span>暂无数据</span>';
    }

    async function updateGraphBtnStats() {
        try {
            var data = await API.get('/api/graph');
            var el = document.getElementById('graphBtnStats');
            if (el && data.stats) {
                el.textContent = '(' + data.stats.total_nodes + '实体 · ' +
                    data.stats.total_edges + '关系)';
            }
        } catch (e) { /* silent */ }
    }

    function startGraphPolling() {
        stopGraphPolling();
        graphPollInterval = setInterval(async function () {
            if (!graph3d || graphModal.classList.contains('hidden')) return;
            try {
                var delta = await API.get('/api/graph/delta');
                if (delta.new_node_count > 0) {
                    var badge = document.getElementById('graphDeltaBadge');
                    if (badge) {
                        badge.style.display = '';
                        badge.textContent = '+ ' + delta.new_node_count +
                            ' 节点, + ' + delta.new_edge_count + ' 关系';
                    }
                    if (graph3d) {
                        graph3d.addNodesWithAnimation(delta.new_nodes);
                        graph3d.addEdgesWithAnimation(delta.new_edges);
                    }
                    updateGraphBtnStats();
                    // Update header stats
                    var s = graph3d.getStats();
                    document.getElementById('graphStats').textContent =
                        '节点: ' + s.nodes + ' | 边: ' + s.edges;
                }
            } catch (e) { /* silent */ }
        }, 3000);
    }

    function stopGraphPolling() {
        if (graphPollInterval) {
            clearInterval(graphPollInterval);
            graphPollInterval = null;
        }
    }

    document.getElementById('openGraphBtn').addEventListener('click', function () {
        openGraphModal();
    });

    document.getElementById('closeGraphBtn').addEventListener('click', function () {
        closeGraphModal();
    });

    /* ── Periodic Refresh ───────────────────────────────── */
    fetchStats();
    fetchUploadHistory();
    fetchDocumentLibrary();
    updateGraphBtnStats();
    setInterval(fetchStats, 30000);
    setInterval(fetchDocumentLibrary, 60000);

    /* ── Smart Chunk Preview ──────────────────────────── */
    var chunkPreview = document.getElementById('chunkPreview');
    var cpContent = document.getElementById('cpContent');
    var cpDocName = document.getElementById('cpDocName');
    var cpStats = document.getElementById('cpStats');
    var cpTextCount = document.getElementById('cpTextCount');
    var cpImgCount = document.getElementById('cpImgCount');
    var cpTblCount = document.getElementById('cpTblCount');
    var currentPreviewData = null;
    var currentTab = 'text';

    async function startChunkPreview(file) {
        try {
            var formData = new FormData();
            formData.append('file', file);
            var resp = await fetch('/api/preview', { method: 'POST', body: formData });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            var data = await resp.json();
            currentPreviewData = data;
            renderPreview(data);
            chunkPreview.classList.remove('hidden');
            cpDocName.textContent = file.name;
            cpStats.textContent = data.chunks.length + ' 文本块 · ' + data.images.length + ' 图表';
        } catch (e) {
            Toast.show('预览生成失败: ' + (e.message || '未知错误'), 'error');
        }
    }

    function renderPreview(data) {
        var textChunks = (data.chunks || []).filter(function(c) { return c.type === 'text'; });
        var tableChunks = (data.chunks || []).filter(function(c) { return c.type === 'table'; });
        var images = data.images || [];
        cpTextCount.textContent = textChunks.length;
        cpImgCount.textContent = images.length;
        cpTblCount.textContent = tableChunks.length;
        showPreviewTab(currentTab);
    }

    function showPreviewTab(tab) {
        currentTab = tab;
        document.querySelectorAll('.cp-tab').forEach(function(t) { t.classList.remove('active'); });
        document.querySelector('[data-tab=\"' + tab + '\"]').classList.add('active');

        var data = currentPreviewData;
        if (!data) return;
        var html = '';

        if (tab === 'text') {
            (data.chunks || []).filter(function(c) { return c.type === 'text'; }).forEach(function(c) {
                var tagClass = c.section_tag || 'results';
                html += '<div class=\"cp-chunk\">' +
                    '<div class=\"chunk-meta\">' +
                        '<span class=\"chunk-tag ' + tagClass + '\">' + (c.section_tag || 'results') + '</span>' +
                        '<span class=\"chunk-page\">p.' + (c.page || '?') + ' | ' + (c.length || 0) + ' 字</span>' +
                    '</div>' +
                    '<div class=\"chunk-text\">' + escapeHtml(c.text || '') + '</div>' +
                '</div>';
            });
        } else if (tab === 'images') {
            (data.images || []).forEach(function(img) {
                html += '<div class=\"cp-image-card\">' +
                    '<div class=\"img-caption\">🖼️ ' + escapeHtml(img.caption || '') + '</div>' +
                    '<span class=\"chunk-page\">p.' + (img.page || '?') + '</span>' +
                '</div>';
            });
        } else if (tab === 'tables') {
            (data.chunks || []).filter(function(c) { return c.type === 'table'; }).forEach(function(c) {
                html += '<div class=\"cp-chunk\">' +
                    '<div class=\"chunk-meta\"><span class=\"chunk-tag results\">TABLE</span>' +
                    '<span class=\"chunk-page\">p.' + (c.page || '?') + '</span></div>' +
                    '<div class=\"chunk-text\">' + escapeHtml((c.caption || '') + ' ' + (c.body || '')).substring(0, 300) + '</div>' +
                '</div>';
            });
        }
        cpContent.innerHTML = html || '<p style=\"color:var(--text-muted);font-size:.85rem;\">暂无内容</p>';
    }

    document.querySelectorAll('.cp-tab').forEach(function(tab) {
        tab.addEventListener('click', function() { showPreviewTab(this.getAttribute('data-tab')); });
    });

    document.getElementById('cpCancelBtn').addEventListener('click', function() {
        chunkPreview.classList.add('hidden');
        currentPreviewData = null;
    });

    document.getElementById('cpConfirmBtn').addEventListener('click', async function() {
        if (!currentPreviewData || !currentPreviewData.doc_id) {
            Toast.show('请先上传PDF生成预览', 'error');
            return;
        }
        var btn = document.getElementById('cpConfirmBtn');
        btn.disabled = true; btn.textContent = '入库中...';
        try {
            await API.post('/api/preview/confirm', { doc_id: currentPreviewData.doc_id });
            Toast.show('✅ 已确认入库！文档已加入知识库', 'success');
            chunkPreview.classList.add('hidden');
            currentPreviewData = null;
            fetchStats();
            fetchFiles();
        } catch (e) {
            Toast.show('入库失败: ' + (e.message || ''), 'error');
            btn.disabled = false; btn.textContent = '✅ 确认入库';
        }
    });

    // Hook into existing upload flow — show preview after upload
    var origHandleFileUpload = handleFileUpload;
    handleFileUpload = async function(file) {
        await origHandleFileUpload(file);
        // After upload, show preview
        setTimeout(function() { startChunkPreview(file); }, 1500);
    };

    function escapeHtml(str) {
        if (!str) return '';
        var d = document.createElement('div');
        d.appendChild(document.createTextNode(str));
        return d.innerHTML;
    }

    /* ── Init Animations ────────────────────────────────── */
    Anim.initPageLoad();
})();
