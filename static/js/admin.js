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
            fetchStats();
        } catch (err) {
            Toast.show('上传失败: ' + err.message, 'error');
            if (uploadStatus) {
                uploadStatus.textContent = '上传失败';
                uploadStatus.style.color = '#f87171';
            }
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

        var statusHtml = status === 'received'
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

    /* ── Periodic Refresh ───────────────────────────────── */
    fetchStats();
    setInterval(fetchStats, 30000);

    /* ── Init Animations ────────────────────────────────── */
    Anim.initPageLoad();
})();
