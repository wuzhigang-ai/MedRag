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

    /* ── Fetch File List ─────────────────────────────────── */
    async function fetchFiles() {
        try {
            var data = await API.get('/api/files');
            if (data.files && data.files.length > 0) {
                data.files.forEach(function (f) {
                    addFileRow(f.name, f.status);
                });
            }
        } catch (e) {
            console.error('Failed to fetch files:', e);
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
    fetchFiles();
    updateGraphBtnStats();
    setInterval(fetchStats, 30000);

    /* ── Init Animations ────────────────────────────────── */
    Anim.initPageLoad();
})();
