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
            if (statIndexSize) statIndexSize.textContent = (data.index_size || 0) + ' 向量';
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

        uploadZone.addEventListener('drop', async function (e) {
            e.preventDefault();
            uploadZone.classList.remove('drag-over');
            var files = e.dataTransfer.files;
            if (files.length > 0) {
                for (var i = 0; i < files.length; i++) { await handleFileUpload(files[i]); }
            }
        });
    }

    if (fileInput) {
        fileInput.addEventListener('change', async function () {
            if (fileInput.files.length > 0) {
                for (var i = 0; i < fileInput.files.length; i++) { await handleFileUpload(fileInput.files[i]); }
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

            // Auto-index: polling → done → auto refresh. No manual confirm needed.
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
                    fetchDocumentLibrary();
                    updateGraphPanelStats();
                    var filename = up.filename || file.name;
                    fetchUploadHistory();
                    addFileRow(filename, 'indexed');
                    var added = up.chunks_added || 0;
                    var toastMsg = up.is_update
                        ? '文档已更新！' + filename + ' (' + added + ' 新文本块,旧版已替换)'
                        : '✅ 自动入库: ' + filename + ' (' + added + ' 文本块)';
                    Toast.show(toastMsg, 'success');
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
        var states = ['uploading', 'parsing', 'downloading', 'indexing', 'done'];
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
            else if (up.state === 'downloading') text.textContent = '下载解析结果中...';
            else if (up.state === 'indexing') {
                text.textContent = '正在构建索引...';
                startGraphPolling();
            } else if (up.state === 'done') {
                var added = up.chunks_added || 0;
                if (up.is_update) {
                    text.textContent = '文档已更新！替换旧版本，新增 ' + added + ' 个文本块';
                    Toast.show('文档已更新，旧版本数据已自动清理', 'success');
                } else if (added === 0) {
                    text.textContent = '文档已存在，所有文本块已去重，未新增内容';
                    Toast.show('该文档已入库，自动跳过重复内容', 'info');
                } else {
                    text.textContent = '完成！新增 ' + added + ' 个文本块';
                }
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

    /* ── Sidebar Nav Active State ──────────────────────── */
    document.querySelectorAll('.sidebar-nav a').forEach(function (link) {
        link.addEventListener('click', function () {
            document.querySelectorAll('.sidebar-nav a').forEach(function (l) {
                l.classList.remove('active');
            });
            this.classList.add('active');
        });
    });

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

        if (!graph3d) {
            try {
                var data = await API.get('/api/graph');

                if (data.error) {
                    document.getElementById('graphStats').textContent = '知识图谱数据不可用';
                    return;
                }

                if (!window.Graph3D) {
                    document.getElementById('graphStats').textContent = '图谱模块加载失败';
                    return;
                }

                graph3d = new Graph3D(graphCanvas);
                graph3d.loadGraph(data);

                document.getElementById('graphStats').textContent =
                    '节点: ' + data.stats.total_nodes +
                    ' | 边: ' + data.stats.total_edges +
                    ' | 文献: ' + data.stats.total_docs +
                    ' | 实体类型: ' + (data.stats.total_entity_types || data.groups.length);

                renderGraphLegend(data.groups);

                // Search handler
                var graphSearch = document.getElementById('graphSearch');
                if (graphSearch) { graphSearch.addEventListener('input', function () {
                    var q = this.value.toLowerCase();
                    var cy = graphCanvas._cy;
                    if (!cy) return;
                    if (!q) { cy.elements().removeClass('neighbor neighbor-edge'); return; }
                    cy.nodes().forEach(function (n) {
                        if (n.data('fullLabel').toLowerCase().indexOf(q) >= 0) {
                            n.addClass('neighbor');
                            n.connectedEdges().addClass('neighbor-edge');
                        } else {
                            n.removeClass('neighbor');
                        }
                    });
                }); }
            } catch (err) {
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
        var palette = {'疾病':'#ef4444','药物':'#10b981','治疗':'#3b82f6','检查':'#f59e0b','症状':'#ec4899','解剖':'#8b5cf6','指标':'#06b6d4','指南':'#6366f1','基因':'#f97316'};
        var shapes = {'疾病':'◆','药物':'▣','治疗':'⬬','检查':'⬡','症状':'▲','default':'●'};
        var html = '';
        (groups || []).forEach(function (g) {
            var c = palette[g] || '#94a3b8';
            var s = shapes[g] || '●';
            html += '<span class="legend-item" style="color:' + c + '" data-group="' + g + '">' + s + ' ' + g + '</span>';
        });
        var legendEl = document.getElementById('graphLegend');
        legendEl.innerHTML = html || '<span>暂无数据</span>';

        // Click legend to highlight group
        legendEl.querySelectorAll('.legend-item').forEach(function (el) {
            el.addEventListener('click', function () {
                var group = el.getAttribute('data-group');
                var cy = document.getElementById('graphCanvas')._cy;
                if (!cy) return;
                cy.elements().removeClass('neighbor neighbor-edge');
                cy.nodes().forEach(function (n) {
                    if (n.data('group') === group) {
                        n.addClass('neighbor');
                    }
                });
            });
        });
    }

    async function updateGraphPanelStats() {
        try {
            var data = await API.get('/api/graph');
            if (data.stats) {
                var nc = document.getElementById('graphNodeCount');
                var ec = document.getElementById('graphEdgeCount');
                if (nc) nc.textContent = data.stats.total_nodes;
                if (ec) ec.textContent = data.stats.total_edges;
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
                    updateGraphPanelStats();
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

    var sidebarGraphBtn = document.getElementById('sidebarGraphBtn');
    if (sidebarGraphBtn) {
        sidebarGraphBtn.addEventListener('click', function (e) {
            e.preventDefault();
            openGraphModal();
        });
    }

    var openGraphBtn = document.getElementById('openGraphBtn');
    if (openGraphBtn) {
        openGraphBtn.addEventListener('click', function () {
            openGraphModal();
        });
    }

    var closeGraphBtn = document.getElementById('closeGraphBtn');
    if (closeGraphBtn) {
        closeGraphBtn.addEventListener('click', function () {
            closeGraphModal();
        });
    }

    /* ── Initial Section State: hide all tabs, show dashboard ── */
    hideAllSections();

    /* ── Periodic Refresh ───────────────────────────────── */
    fetchStats();
    fetchUploadHistory();
    fetchDocumentLibrary();
    updateGraphPanelStats();
    setInterval(fetchStats, 30000);
    setInterval(fetchDocumentLibrary, 60000);

    /* ── Task Center ──────────────────────────────────── */
    var taskFilter = null;
    var taskDetailOpen = null;
    var taskPollInterval = null;

    var tasksSection = document.getElementById('tasks-section');
    var taskTableBody = document.getElementById('taskTableBody');
    var taskEmpty = document.getElementById('taskEmpty');
    var sidebarTasksBtn = document.getElementById('sidebarTasksBtn');
    var taskDetail = document.getElementById('taskDetail');
    var taskDetailTitle = document.getElementById('taskDetailTitle');
    var taskDetailBody = document.getElementById('taskDetailBody');
    var taskDetailClose = document.getElementById('taskDetailClose');

    // Sidebar nav — show/hide sections
    function hideAllSections() {
        var sections = document.querySelectorAll('.files-section');
        sections.forEach(function(s) { s.style.display = 'none'; });
    }
    function showSection(sectionId) {
        var sections = document.querySelectorAll('.files-section');
        sections.forEach(function(s) { s.style.display = 'none'; });
        var target = document.getElementById(sectionId);
        if (target) target.style.display = 'block';
        if (sectionId === 'tasks-section') { fetchTasks(); startTaskPolling(); }
        if (sectionId === 'graph-section') updateGraphPanelStats();
        if (taskPollInterval && sectionId !== 'tasks-section') { clearInterval(taskPollInterval); taskPollInterval = null; }
    }

    if (sidebarTasksBtn) {
        sidebarTasksBtn.addEventListener('click', function(e) { e.preventDefault(); showSection('tasks-section'); });
    }
    var sidebarDocsBtn = document.getElementById('sidebarDocsBtn');
    if (sidebarDocsBtn) {
        sidebarDocsBtn.addEventListener('click', function(e) { e.preventDefault(); showSection('documents-section'); fetchDocumentLibrary(); });
    }
    var sidebarDashBtn = document.getElementById('sidebarDashBtn');
    if (sidebarDashBtn) {
        sidebarDashBtn.addEventListener('click', function(e) { e.preventDefault(); hideAllSections(); fetchStats(); updateGraphPanelStats(); });
    }
    var sidebarGraphNavBtn = document.getElementById('sidebarGraphNavBtn');
    if (sidebarGraphNavBtn) {
        sidebarGraphNavBtn.addEventListener('click', function(e) { e.preventDefault(); showSection('graph-section'); updateGraphPanelStats(); });
    }
    }
    if (taskDetailClose) {
        taskDetailClose.addEventListener('click', function() {
            taskDetail.style.display = 'none';
            taskDetailOpen = null;
        });
    }

    // Stat card click → filter
    ['Processing','Done','Failed'].forEach(function(s) {
        var el = document.getElementById('taskStat' + s);
        if (el) {
            el.addEventListener('click', function() {
                var map = {Processing:'parsing,cross_validating,postprocessing,indexing_faiss,indexing_lightrag',Done:'done',Failed:'failed,partial'};
                taskFilter = map[s] || null;
                fetchTasks();
            });
        }
    });

    async function fetchTasks() {
        if (!taskTableBody) return;
        try {
            var url = '/api/upload/history?limit=100';
            if (taskFilter) url += '&status=' + encodeURIComponent(taskFilter);
            var data = await API.get(url);
            var tasks = data.tasks || [];
            renderTaskStats(tasks);
            if (tasks.length === 0) {
                taskTableBody.innerHTML = '';
                if (taskEmpty) taskEmpty.style.display = 'block';
            } else {
                if (taskEmpty) taskEmpty.style.display = 'none';
                taskTableBody.innerHTML = tasks.map(renderTaskRow).join('');
            }
        } catch (e) {
            console.error('Fetch tasks failed:', e);
        }
    }

    function renderTaskStats(tasks) {
        var processing = 0, done = 0, failed = 0;
        tasks.forEach(function(t) {
            if (t.status === 'done') done++;
            else if (t.status === 'failed' || t.status === 'partial') failed++;
            else processing++;
        });
        ['Processing','Done','Failed'].forEach(function(s) {
            var el = document.getElementById('taskStat' + s);
            if (el) el.textContent = (s==='Processing'?'🔵 处理中: ':(s==='Done'?'✅ 成功: ':'❌ 失败: ')) + arguments[0][s.toLowerCase()];
        });
    }

    function renderTaskRow(t) {
        var statusClass = t.status === 'done' ? 'badge-success' : (t.status === 'failed' || t.status === 'partial' ? 'badge-error' : 'badge-warning');
        var statusLabel = {'received':'等待','parsing':'解析中','cross_validating':'交叉验证','postprocessing':'后处理','indexing_faiss':'FAISS入库','indexing_lightrag':'LightRAG入库','done':'完成','failed':'失败','partial':'部分成功'}[t.status] || t.status;
        var faissIcon = t.faiss_status === 'success' ? '✅' : (t.faiss_status === 'processing' ? '🔵' : (t.faiss_status === 'failed' ? '❌' : '⬜'));
        var lrIcon = t.lightrag_status === 'success' ? '✅' : (t.lightrag_status === 'processing' ? '🔵' : (t.lightrag_status === 'failed' ? '❌' : (t.lightrag_status === 'skipped' ? '⬜' : '⬜')));
        var engine = t.engine_selected || '?';
        var faissInfo = t.faiss_chunks_added ? ('+' + t.faiss_chunks_added) : '';
        var createdAt = t.created_at ? t.created_at.substring(0,16).replace('T',' ') : '';
        var retryBtn = (t.status === 'failed' || t.status === 'partial') ? '<button class=\"btn btn-ghost btn-sm\" onclick=\"event.stopPropagation();retryTask(\''+t.task_uuid+'\')\" title=\"重试\">🔄</button>' : '';
        return '<tr class=\"task-row\" data-uuid=\"'+t.task_uuid+'\" style=\"cursor:pointer\" onclick=\"openTaskDetail(\''+t.task_uuid+'\')\">' +
            '<td>' + escapeHtml(t.filename) + '</td>' +
            '<td><span class=\"badge '+statusClass+'\">'+statusLabel+'</span></td>' +
            '<td>'+engine+'</td>' +
            '<td>'+faissIcon+' '+faissInfo+'</td>' +
            '<td>'+lrIcon+'</td>' +
            '<td>'+((t.parsing_duration_ms||0)+(t.faiss_duration_ms||0)+(t.lightrag_duration_ms||0))+'ms</td>' +
            '<td>'+createdAt+'</td>' +
            '<td>'+retryBtn+'</td>' +
            '</tr>';
    }

    async function openTaskDetail(taskUuid) {
        try {
            var task = await API.get('/api/upload/' + taskUuid + '/status');
            taskDetailOpen = taskUuid;
            taskDetailTitle.textContent = '任务详情: ' + task.filename + ' (' + taskUuid.substring(0,8) + '...)';
            var statusLabel = {'received':'等待','parsing':'解析中','cross_validating':'交叉验证','postprocessing':'后处理','indexing_faiss':'FAISS入库','indexing_lightrag':'LightRAG入库','done':'完成','failed':'失败','partial':'部分成功'}[task.status] || task.status;

            var html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;">' +
                '<div><strong>状态:</strong> ' + statusLabel + '</div>' +
                '<div><strong>引擎:</strong> ' + (task.engine_selected || '?') + (task.engine_reason ? ' (' + task.engine_reason + ')' : '') + '</div>' +
                '<div><strong>上传者:</strong> ' + (task.uploaded_by || '?') + '</div>' +
                '<div><strong>文件MD5:</strong> ' + (task.file_md5 || '').substring(0,16) + '</div>' +
                '<div><strong>文件大小:</strong> ' + formatBytes(task.file_size_bytes || 0) + '</div>' +
                '<div><strong>重试次数:</strong> ' + (task.retry_count || 0) + '/' + (task.max_retries || 3) + '</div>' +
                '</div>';

            if (task.quality_warning) {
                html += '<div style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);padding:8px;border-radius:6px;margin-bottom:12px;color:#f59e0b;">⚠ ' + task.quality_warning + '</div>';
            }
            if (task.error_message) {
                html += '<div style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);padding:8px;border-radius:6px;margin-bottom:12px;color:#f87171;">❌ ' + task.error_message + '</div>';
            }

            // Stage timeline
            var stages = [
                {name:'接收', status: task.status === 'received' ? 'active' : 'done', time: task.created_at, detail: ''},
                {name:'解析', status: task.status === 'parsing' ? 'active' : (['cross_validating','postprocessing','indexing_faiss','indexing_lightrag','done'].indexOf(task.status)>=0?'done':'pending'), time: task.parsing_started_at, detail: 'Docling:'+(task.docling_items||0)+' MinerU:'+(task.mineru_items||0)+' ('+(task.parsing_duration_ms||0)+'ms)'},
                {name:'交叉验证', status: task.status === 'cross_validating' ? 'active' : (['postprocessing','indexing_faiss','indexing_lightrag','done'].indexOf(task.status)>=0?'done':'pending'), time: task.parsing_started_at, detail: (task.cross_validation_duration_ms||0)+'ms'},
                {name:'后处理', status: task.status === 'postprocessing' ? 'active' : (['indexing_faiss','indexing_lightrag','done'].indexOf(task.status)>=0?'done':'pending'), time: task.parsing_started_at, detail: '清理:'+(task.postprocess_cleaned||0)+' 合并:'+(task.postprocess_merged||0)+' 序列化:'+(task.postprocess_tables_serialized||0)},
                {name:'FAISS入库', status: task.faiss_status === 'processing' ? 'active' : (task.faiss_status==='success'?'done':(task.faiss_status==='failed'?'error':'pending')), time: task.faiss_started_at, detail: (task.faiss_is_update?'更新':'新增')+' +'+(task.faiss_chunks_added||0)+'块 VLM:'+(task.faiss_images_vlm||0)+'/'+(task.faiss_images_total||0)+' ('+(task.faiss_duration_ms||0)+'ms)'},
                {name:'LightRAG', status: task.lightrag_status === 'processing' ? 'active' : (task.lightrag_status==='success'?'done':(task.lightrag_status==='failed'?'error':(task.lightrag_status==='skipped'?'skipped':'pending'))), time: task.lightrag_started_at, detail: (task.lightrag_mode||'')+' '+(task.lightrag_entities||0)+'实体/'+(task.lightrag_relations||0)+'关系 ('+(task.lightrag_duration_ms||0)+'ms)'}
            ];

            html += '<div style="border-left:2px solid var(--border);padding-left:16px;">';
            stages.forEach(function(s) {
                var dot = s.status === 'done' ? '🟢' : (s.status === 'active' ? '🔵' : (s.status === 'error' ? '🔴' : (s.status === 'skipped' ? '⚪' : '⚫')));
                html += '<div style="padding:6px 0;">' + dot + ' <strong>' + s.name + '</strong> <span style="color:var(--text-muted);font-size:13px;">' + s.detail + '</span></div>';
            });
            html += '</div>';

            taskDetailBody.innerHTML = html;
            taskDetail.style.display = 'block';

        } catch(e) {
            Toast.show('加载任务详情失败', 'error');
        }
    }

    async function retryTask(taskUuid) {
        try {
            var resp = await fetch('/api/upload/' + taskUuid + '/retry', {method:'POST'});
            if (resp.ok) {
                Toast.show('任务已重新入队', 'success');
                fetchTasks();
            } else {
                var err = await resp.json();
                Toast.show('重试失败: ' + (err.detail || '未知错误'), 'error');
            }
        } catch(e) {
            Toast.show('重试请求失败', 'error');
        }
    }

    function startTaskPolling() {
        if (taskPollInterval) clearInterval(taskPollInterval);
        taskPollInterval = setInterval(function() {
            if (tasksSection && tasksSection.style.display !== 'none') {
                fetchTasks();
                if (taskDetailOpen) openTaskDetail(taskDetailOpen);
            }
        }, 5000);
    }

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
            // Check if document already exists (graceful fallback if endpoint unavailable)
            var isUpdate = false;
            var oldChunkCount = 0;
            try {
                var checkResp = await fetch('/api/preview/check-doc?filename=' + encodeURIComponent(file.name));
                if (checkResp.ok) {
                    var checkData = await checkResp.json();
                    isUpdate = checkData.exists;
                    oldChunkCount = checkData.chunk_count || 0;
                }
            } catch (e) { /* endpoint not yet available, proceed without update check */ }

            var formData = new FormData();
            formData.append('file', file);
            var resp = await fetch('/api/preview', { method: 'POST', body: formData });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            var data = await resp.json();
            currentPreviewData = data;
            currentPreviewData._is_update = isUpdate;
            renderPreview(data);
            chunkPreview.classList.remove('hidden');
            if (isUpdate) {
                cpDocName.innerHTML = file.name + ' <span style="background:rgba(245,158,11,.15);color:#fbbf24;padding:2px 8px;border-radius:4px;font-size:.7rem;font-weight:600;">🔄 文档更新</span>';
                cpStats.textContent = '检测到同名文档 (' + oldChunkCount + ' 旧块将被替换) | ' + data.chunks.length + ' 新文本块 · ' + data.images.length + ' 图表';
            } else {
                cpDocName.textContent = file.name;
                cpStats.textContent = data.chunks.length + ' 文本块 · ' + data.images.length + ' 图表';
            }
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
        // Update confirm button for update vs new
        var confirmBtn = document.getElementById('cpConfirmBtn');
        if (confirmBtn && data._is_update) {
            confirmBtn.textContent = '🔄 更新文档';
            confirmBtn.title = '将替换旧版本，旧数据自动清理';
        } else if (confirmBtn) {
            confirmBtn.textContent = '✅ 确认入库';
            confirmBtn.title = '';
        }
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
            fetchUploadHistory();
        } catch (e) {
            Toast.show('入库失败: ' + (e.message || ''), 'error');
            btn.disabled = false; btn.textContent = '✅ 确认入库';
        }
    });

    function escapeHtml(str) {
        if (!str) return '';
        var d = document.createElement('div');
        d.appendChild(document.createTextNode(str));
        return d.innerHTML;
    }

    /* ── Init Animations ────────────────────────────────── */
    Anim.initPageLoad();
})();
