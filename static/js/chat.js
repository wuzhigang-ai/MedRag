/* ============================================================
   MedASR — Agent Chat Interface
   ============================================================ */

(function () {
    'use strict';

    /* ── Auth Guard ─────────────────────────────────────── */
    if (!Auth.requireAuth()) return;

    var user = Auth.getUser();
    var displayName = user ? user.username : '用户';

    /* ── State ──────────────────────────────────────────── */
    var conversations = [
        {
            id: 'conv-1',
            title: 'TBAD 诊断标准',
            preview: 'Explore diagnostic criteria for Type B aortic dissection...',
            date: '2026-05-20',
            messages: []
        },
        {
            id: 'conv-2',
            title: '药物治疗方案',
            preview: 'Compare antihypertensive regimens for acute TBAD...',
            date: '2026-05-19',
            messages: []
        },
        {
            id: 'conv-3',
            title: '分型分期',
            preview: 'Stanford vs DeBakey classification systems...',
            date: '2026-05-18',
            messages: []
        }
    ];
    var activeConvId = null;
    var isStreaming = false;

    /* ── DOM Refs ───────────────────────────────────────── */
    var convList = document.getElementById('convList');
    var chatMessages = document.getElementById('chatMessages');
    var chatEmpty = document.getElementById('chatEmpty');
    var chatInput = document.getElementById('chatInput');
    var sendBtn = document.getElementById('sendBtn');
    var currentTitle = document.getElementById('currentTitle');
    var newConvBtn = document.getElementById('newConvBtn');

    /* ── SVG Icons (inline helpers) ─────────────────────── */
    function svgIcon(name) {
        var icons = {
            'search': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
            'send': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
            'chevron-right': '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
            'brain': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a4 4 0 0 0-4 4c0 2 1 4 4 6"/><path d="M12 2a4 4 0 0 1 4 4c0 2-1 4-4 6"/><path d="M12 12c-3 2-4 4-4 6a4 4 0 0 0 8 0c0-2-1-4-4-6"/></svg>',
            'search-icon': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
            'check': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
            'sparkles': '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5z"/></svg>',
            'chat': '<svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
            'pin': '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.5a3.5 3.5 0 0 0-3.5-3.5h-7A3.5 3.5 0 0 0 5 15.5V17z"/><path d="M8 12V7a4 4 0 1 1 8 0v5"/></svg>'
        };
        return icons[name] || '';
    }

    /* ── Render Conversation List ───────────────────────── */
    function renderConvList() {
        if (!convList) return;
        convList.innerHTML = '';
        conversations.forEach(function (conv) {
            var div = document.createElement('div');
            div.className = 'conv-item' + (conv.id === activeConvId ? ' active' : '');
            div.setAttribute('data-conv-id', conv.id);
            div.innerHTML =
                '<div class="conv-title">' + escapeHtml(conv.title) + '</div>' +
                '<div class="conv-preview">' + escapeHtml(conv.preview) + '</div>' +
                '<div class="conv-date">' + conv.date + '</div>';
            div.addEventListener('click', function () {
                selectConversation(conv.id);
            });
            convList.appendChild(div);
        });
    }

    function selectConversation(convId) {
        activeConvId = convId;
        var conv = conversations.find(function (c) { return c.id === convId; });
        if (conv) {
            if (currentTitle) currentTitle.textContent = conv.title;
            renderMessages(conv.messages);
            chatEmpty.style.display = 'none';
            chatMessages.style.display = 'flex';
        }
        renderConvList();
    }

    /* ── Render Messages ────────────────────────────────── */
    function renderMessages(messages) {
        if (!chatMessages) return;
        chatMessages.innerHTML = '';

        if (messages.length === 0) {
            showEmptyState();
            return;
        }

        messages.forEach(function (msg) {
            appendMessageBubble(msg, false);
        });
        scrollToBottom();
    }

    function appendMessageBubble(msg, animate) {
        if (!chatMessages) return;

        var msgDiv = document.createElement('div');
        msgDiv.className = 'message ' + msg.role;

        var bubbleDiv = document.createElement('div');
        bubbleDiv.className = 'bubble';

        if (msg.role === 'agent' && msg.answer) {
            // Agent message with formatted answer
            bubbleDiv.innerHTML = formatAnswer(msg.answer);

            // Reasoning trace
            if (msg.reasoningTrace && msg.reasoningTrace.length > 0) {
                var traceDiv = buildReasoningTrace(msg.reasoningTrace);
                bubbleDiv.appendChild(traceDiv);
            }

            // Source citations
            if (msg.sources && msg.sources.length > 0) {
                var srcDiv = buildSourceCitations(msg.sources);
                bubbleDiv.appendChild(srcDiv);
            }

            // Feedback buttons
            if (!msg._feedbackRendered) {
                msg._feedbackRendered = true;
                var fbDiv = buildFeedbackButtons(msg);
                bubbleDiv.appendChild(fbDiv);
            }
        } else if (msg.role === 'agent' && msg.thinking) {
            // Still thinking - just show spinner
            bubbleDiv.innerHTML = '';
        } else {
            // User message - plain text
            bubbleDiv.textContent = msg.content;
        }

        msgDiv.appendChild(bubbleDiv);
        chatMessages.appendChild(msgDiv);

        if (animate) {
            scrollToBottom();
        }
    }

    function buildReasoningTrace(trace) {
        var container = document.createElement('div');
        container.className = 'reasoning-trace';

        var toggle = document.createElement('button');
        toggle.className = 'trace-toggle';
        toggle.innerHTML = svgIcon('chevron-right') + ' 推理过程 (' + trace.length + ' 步)';
        toggle.addEventListener('click', function () {
            var isOpen = toggle.classList.toggle('open');
            stepsDiv.style.display = isOpen ? 'flex' : 'none';
            var chevron = toggle.querySelector('svg');
            if (chevron) chevron.style.transform = isOpen ? 'rotate(90deg)' : 'rotate(0deg)';
        });

        var stepsDiv = document.createElement('div');
        stepsDiv.className = 'trace-steps';
        // Open by default during/after streaming so steps are visible
        stepsDiv.style.display = 'flex';
        toggle.classList.add('open');

        trace.forEach(function (step) {
            var stepDiv = document.createElement('div');
            stepDiv.className = 'trace-step';

            var stepLabel = getStepLabel(step.tool || step.step);
            var argsPreview = '';
            if (step.args) {
                try {
                    var a = typeof step.args === 'string' ? JSON.parse(step.args) : step.args;
                    argsPreview = Object.values(a).slice(0, 2).join(', ').substring(0, 60);
                } catch(e) {}
            }
            stepDiv.innerHTML =
                '<span class="step-icon">' + getStepIcon(step.tool || step.step) + '</span>' +
                '<div class="step-body">' +
                '<span class="step-label">' + escapeHtml(stepLabel) + '</span>' +
                (argsPreview ? '<span class="step-args">' + escapeHtml(argsPreview) + '</span>' : '') +
                '</div>';
            stepsDiv.appendChild(stepDiv);
        });

        container.appendChild(toggle);
        container.appendChild(stepsDiv);
        return container;
    }

    function buildSourceCitations(sources) {
        var container = document.createElement('div');
        container.className = 'source-citations';

        sources.forEach(function (src) {
            if (typeof src === 'object' && src.image_url) {
                // Render chart image card
                var card = document.createElement('div');
                card.className = 'chart-card';
                var imgUrl = src.image_url;
                var chartType = src.chart_type || '图表';
                var caption = src.text_preview || '';
                card.innerHTML =
                    '<div class="chart-card-header">' +
                        svgIcon('search-icon') + ' ' + escapeHtml(chartType) + ' — ' + escapeHtml(src.source || '') +
                    '</div>' +
                    '<img src="' + imgUrl + '" class="chart-img" loading="lazy" ' +
                        'onerror="var img=this;img.style.display=\'none\';img.parentElement.querySelector(\'.chart-card-header\').style.color=\'#999\'" ' +
                        'onclick="window.open(\'' + imgUrl + '\',\'_blank\')" ' +
                        'title="点击查看大图"/>' +
                    (caption ? '<div class="chart-caption">' + escapeHtml(caption.substring(0, 160)) + '</div>' : '');
                container.appendChild(card);
            } else {
                var tag = document.createElement('span');
                tag.className = 'source-tag';
                var srcName = typeof src === 'string' ? src : (src.title || src.source || src.name || String(src));
                var srcType = (typeof src === 'object' && src.type) ? src.type : '文献';
                tag.innerHTML = svgIcon('pin') + ' ' + escapeHtml(srcName) +
                    ' <span class="source-badge">' + escapeHtml(srcType) + '</span>';
                container.appendChild(tag);
            }
        });

        return container;
    }

    /* ── Feedback Buttons ───────────────────────────────── */
    function buildFeedbackButtons(msg) {
        var container = document.createElement('div');
        container.className = 'feedback-row';

        if (msg._feedbackGiven) {
            container.innerHTML = '<span class="feedback-done">' +
                (msg._feedbackRating === 'helpful' ? '✓ 已标记为有帮助' : '已标记为无帮助') +
                '</span>';
            return container;
        }

        container.innerHTML =
            '<span class="feedback-label">这个回答有帮助吗？</span>' +
            '<button class="feedback-btn helpful" data-rating="helpful">' +
                '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>' +
                ' 有帮助' +
            '</button>' +
            '<button class="feedback-btn not-helpful" data-rating="not_helpful">' +
                '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10zM17 2h2.67a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H17"/></svg>' +
                ' 无帮助' +
            '</button>';

        container.querySelectorAll('.feedback-btn').forEach(function (btn) {
            btn.addEventListener('click', async function () {
                var rating = btn.getAttribute('data-rating');
                msg._feedbackGiven = true;
                msg._feedbackRating = rating;
                try {
                    var user = Auth.getUser();
                    await API.post('/api/feedback', {
                        question: (activeConvId && conversations ? (conversations.find(function(c){return c.id===activeConvId}) || {}).preview || '' : ''),
                        answer: (msg.answer || '').substring(0, 300),
                        rating: rating,
                        username: user ? user.username : 'anonymous'
                    });
                } catch (e) { /* silent */ }
                // Re-render
                var newFb = buildFeedbackButtons(msg);
                container.parentNode.replaceChild(newFb, container);
            });
        });

        return container;
    }

    function getStepLabel(tool) {
        var labels = {
            'understand': '理解问题',
            'search_rag': '检索知识库',
            'search': '检索知识库',
            'cross_check': '交叉验证',
            'cross_check_contradictions': '矛盾检测',
            'synthesize': '综合回答',
            'generate_answer': '综合回答',
            'verify': '验证答案'
        };
        return labels[tool] || tool || '处理中...';
    }

    function getStepIcon(tool) {
        var icons = {
            'understand': svgIcon('brain'),
            'search_rag': svgIcon('search-icon'),
            'search': svgIcon('search-icon'),
            'cross_check': svgIcon('check'),
            'cross_check_contradictions': svgIcon('check'),
            'synthesize': svgIcon('sparkles'),
            'generate_answer': svgIcon('sparkles'),
            'verify': svgIcon('check')
        };
        return icons[tool] || svgIcon('chevron-right');
    }

    function formatAnswer(text) {
        if (!text) return '';

        var lines = text.split('\n');
        var html = '';
        var inTable = false;
        var inCodeBlock = false;
        var codeContent = '';
        var inList = false;

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            var trimmed = line.trim();

            // Code block fence
            if (trimmed.startsWith('```')) {
                if (inCodeBlock) {
                    html += '<pre><code>' + escapeHtml(codeContent.trim()) + '</code></pre>';
                    codeContent = '';
                    inCodeBlock = false;
                } else {
                    if (inList) { html += '</ul>'; inList = false; }
                    inCodeBlock = true;
                }
                continue;
            }
            if (inCodeBlock) {
                codeContent += line + '\n';
                continue;
            }

            // Table row
            if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
                if (inList) { html += '</ul>'; inList = false; }
                var cells = trimmed.split('|').filter(function(c) { return c.trim(); });
                var isHeaderSep = cells.every(function(c) { return /^[\s\-:]+$/.test(c); });
                if (isHeaderSep) continue;
                var tag = inTable ? 'td' : 'th';
                if (!inTable) { html += '<table><thead><tr>'; }
                else if (tag === 'th') { html += '</tr></thead><tbody><tr>'; }
                else if (i > 0 && lines[i-1].trim().startsWith('|') && /^[\s\-:|]+$/.test(lines[i-1].trim())) {
                    html += '<tr>';
                } else if (cells.length > 0 && !inTable) {
                    html += '<table><tr>';
                }
                for (var j = 0; j < cells.length; j++) {
                    html += '<' + tag + '>' + formatInline(escapeHtml(cells[j].trim())) + '</' + tag + '>';
                }
                html += '</tr>';
                inTable = true;
                continue;
            } else if (inTable) {
                html += '</tbody></table>';
                inTable = false;
            }

            // Headings
            var headingMatch = trimmed.match(/^(#{1,4})\s+(.+)/);
            if (headingMatch) {
                if (inList) { html += '</ul>'; inList = false; }
                var level = headingMatch[1].length;
                html += '<h' + level + '>' + formatInline(escapeHtml(headingMatch[2])) + '</h' + level + '>';
                continue;
            }

            // Unordered list
            var listMatch = trimmed.match(/^[-*]\s+(.+)/);
            if (listMatch) {
                if (!inList) { html += '<ul>'; inList = true; }
                html += '<li>' + formatInline(escapeHtml(listMatch[1])) + '</li>';
                continue;
            } else if (inList && trimmed) {
                // Ordered list
                var olistMatch = trimmed.match(/^\d+\.\s+(.+)/);
                if (olistMatch) {
                    html += '<li>' + formatInline(escapeHtml(olistMatch[1])) + '</li>';
                    continue;
                }
            }
            if (inList && !trimmed) { html += '</ul>'; inList = false; continue; }

            // Blockquote
            if (trimmed.startsWith('> ')) {
                if (inList) { html += '</ul>'; inList = false; }
                html += '<blockquote>' + formatInline(escapeHtml(trimmed.slice(2))) + '</blockquote>';
                continue;
            }

            // Horizontal rule
            if (trimmed === '---' || trimmed === '***' || trimmed === '___') {
                if (inList) { html += '</ul>'; inList = false; }
                html += '<hr>';
                continue;
            }

            // Empty line → paragraph break
            if (!trimmed) {
                if (inList) { html += '</ul>'; inList = false; }
                continue;
            }

            // Regular paragraph
            if (inList) { html += '</ul>'; inList = false; }
            html += '<p>' + formatInline(escapeHtml(trimmed)) + '</p>';
        }

        if (inList) html += '</ul>';
        if (inTable) html += '</tbody></table>';
        if (inCodeBlock && codeContent) html += '<pre><code>' + escapeHtml(codeContent.trim()) + '</code></pre>';

        return html || '<p>' + escapeHtml(text) + '</p>';
    }

    function formatInline(text) {
        // Bold, italic, code
        text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
        text = text.replace(/`(.+?)`/g, '<code>$1</code>');
        return text;
    }

    function escapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    /* ── Show / Hide Empty State ────────────────────────── */
    function showEmptyState() {
        if (chatEmpty) chatEmpty.style.display = 'flex';
        if (chatMessages) chatMessages.style.display = 'none';
    }

    function hideEmptyState() {
        if (chatEmpty) chatEmpty.style.display = 'none';
        if (chatMessages) chatMessages.style.display = 'flex';
    }

    /* ── Scroll ─────────────────────────────────────────── */
    function scrollToBottom() {
        if (chatMessages) {
            requestAnimationFrame(function () {
                chatMessages.scrollTop = chatMessages.scrollHeight;
            });
        }
    }

    /* ── Thinking Indicator ─────────────────────────────── */
    var thinkingEl = null;

    var workbenchEl = null;
    var startTime = null;
    var timerInterval = null;

    function showThinking() {
        hideEmptyState();
        startTime = Date.now();
        workbenchEl = document.createElement('div');
        workbenchEl.className = 'agent-workbench';
        workbenchEl.id = 'agentWorkbench';
        workbenchEl.innerHTML =
            '<div class="workbench-header">' +
                '<div class="workbench-status">' +
                    '<span class="pulse-dot active"></span>' +
                    '<span class="wb-status-text">Agent 分析中...</span>' +
                '</div>' +
                '<span class="workbench-timer" id="wbTimer">0.0s</span>' +
            '</div>' +
            '<div class="workbench-steps" id="wbSteps"></div>';
        chatMessages.appendChild(workbenchEl);
        scrollToBottom();

        // Start timer
        timerInterval = setInterval(function () {
            var el = document.getElementById('wbTimer');
            if (el && startTime) {
                el.textContent = ((Date.now() - startTime) / 1000).toFixed(1) + 's';
            }
        }, 200);
    }

    function removeThinking() {
        if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
        if (workbenchEl) {
            // Mark complete
            var dot = workbenchEl.querySelector('.pulse-dot');
            if (dot) { dot.classList.remove('active'); dot.classList.add('done'); }
            var status = workbenchEl.querySelector('.wb-status-text');
            if (status) status.textContent = '分析完成';
        }
    }

    function addWorkbenchStep(data) {
        var stepsEl = document.getElementById('wbSteps');
        if (!stepsEl) return;

        var card = document.createElement('div');
        card.className = 'wb-step-card';
        card.style.animation = 'slideInRight 0.35s ease-out';

        var icon = getStepIcon(data.tool || '');
        var label = getStepLabel(data.tool || '');
        var elapsed = data.elapsed || ((Date.now() - startTime) / 1000).toFixed(1);

        // Enhanced details per tool type
        var extraHtml = '';
        if (data.tool === 'search_rag' && data.preview) {
            try {
                var items = JSON.parse(String(data.preview).replace(/\.\.\.$/,''));
                if (Array.isArray(items) && items.length > 0) {
                    extraHtml = '<div class="wb-step-badge">📄 命中 ' + items.length + ' 条文献</div>';
                }
            } catch(e) {}
        }
        if (data.tool === 'analyze_image' && data.args) {
            extraHtml = '<div class="wb-step-badge">🔬 VLM 图表分析</div>';
        }
        if (data.tool === 'cross_check') {
            extraHtml = '<div class="wb-step-badge">🔍 证据一致性验证</div>';
        }

        card.innerHTML =
            '<div class="wb-step-head">' +
                '<span class="wb-step-icon">' + icon + '</span>' +
                '<span class="wb-step-name">' + escapeHtml(label) + '</span>' +
                '<span class="wb-step-time">' + elapsed + 's</span>' +
            '</div>' +
            extraHtml +
            '<div class="wb-step-args">' + escapeHtml(
                (typeof data.args === 'object' ? JSON.stringify(data.args) : String(data.args || '')).substring(0, 100)
            ) + '</div>' +
            (data.preview && data.tool !== 'search_rag' ? '<div class="wb-step-preview">' + escapeHtml(String(data.preview).substring(0, 150)) + '</div>' : '');

        stepsEl.appendChild(card);
        scrollToBottom();
    }

    /* ── Send Message ───────────────────────────────────── */
    async function sendMessage(question) {
        if (isStreaming) return;
        if (!question || !question.trim()) return;

        question = question.trim();
        isStreaming = true;

        // Disable input
        chatInput.value = '';
        chatInput.disabled = true;
        sendBtn.disabled = true;

        // Ensure we have an active conversation
        if (!activeConvId) {
            createNewConversation(question);
        }

        var conv = conversations.find(function (c) { return c.id === activeConvId; });
        if (!conv) {
            createNewConversation(question);
            conv = conversations.find(function (c) { return c.id === activeConvId; });
        }

        // Add user message
        var userMsg = { role: 'user', content: question };
        conv.messages.push(userMsg);
        appendMessageBubble(userMsg, true);
        hideEmptyState();

        // Show thinking
        showThinking();

        // Create agent message placeholder
        var agentMsg = {
            role: 'agent',
            answer: '',
            reasoningTrace: [],
            sources: []
        };
        conv.messages.push(agentMsg);

        try {
            // Try SSE streaming first
            await streamAgentResponse(question, agentMsg);
        } catch (err) {
            // Fallback to regular POST
            console.warn('SSE stream failed, falling back to POST:', err);
            try {
                await postAgentResponse(question, agentMsg);
            } catch (err2) {
                removeThinking();
                var errMsg = (err2.message || '未知错误');
                if (errMsg.includes('429') || errMsg.includes('quota')) {
                    agentMsg.answer = '⚠️ API配额已用尽，请稍后重试。当前使用百度DeepSeek-V4-Pro，小时配额有限。';
                } else if (errMsg.includes('fetch') || errMsg.includes('连接')) {
                    agentMsg.answer = '⚠️ 无法连接到后端服务。请确认 uvicorn api:app --port 8000 已启动。';
                } else {
                    agentMsg.answer = '抱歉，请求处理失败: ' + errMsg;
                }
                conv.messages.pop();
                conv.messages.push(agentMsg);
                renderMessages(conv.messages);
                Toast.show('请求失败', 'error');
            }
        }

        // Update conversation preview
        conv.preview = question.substring(0, 40) + (question.length > 40 ? '...' : '');

        // Refresh conversation list
        renderConvList();

        // Re-enable input
        isStreaming = false;
        chatInput.disabled = false;
        sendBtn.disabled = false;
        chatInput.focus();
    }

    /* ── SSE Streaming (Live Agent Workbench) ─────────────── */
    function streamAgentResponse(question, agentMsg) {
        return new Promise(function (resolve, reject) {
            var url = '/api/agent/stream?question=' + encodeURIComponent(question);

            var controller = new AbortController();
            var timeoutId = setTimeout(function () { controller.abort(); }, 180000);

            fetch(url, { signal: controller.signal }).then(function (response) {
                if (!response.ok) throw new Error('HTTP ' + response.status);

                var reader = response.body.getReader();
                var decoder = new TextDecoder();
                var buffer = '';

                function processChunk() {
                    reader.read().then(function (result) {
                        if (result.done) {
                            clearTimeout(timeoutId);
                            finishWorkbench(agentMsg);
                            resolve();
                            return;
                        }

                        buffer += decoder.decode(result.value, { stream: true });
                        var lines = buffer.split('\n');
                        buffer = lines.pop() || '';

                        lines.forEach(function (line) {
                            var trimmed = line.trim();
                            if (!trimmed || !trimmed.startsWith('data: ')) return;
                            var data = trimmed.slice(6);
                            if (data === '[DONE]') return;
                            try {
                                var parsed = JSON.parse(data);
                                handleSSEEvent(parsed, agentMsg);
                            } catch (e) { /* skip */ }
                        });

                        // Yield to browser render loop for real-time animation
                        setTimeout(processChunk, 0);
                    }).catch(function (err) {
                        clearTimeout(timeoutId);
                        finishWorkbench(agentMsg);
                        reject(err);
                    });
                }

                processChunk();
            }).catch(function (err) {
                clearTimeout(timeoutId);
                finishWorkbench(agentMsg);
                reject(err);
            });
        });
    }

    function finishWorkbench(agentMsg) {
        removeThinking();
        // Collapse workbench to compact summary
        if (workbenchEl) {
            var stepsEl = document.getElementById('wbSteps');
            var nSteps = stepsEl ? stepsEl.children.length : (agentMsg.reasoningTrace ? agentMsg.reasoningTrace.length : 0);
            var totalTime = startTime ? ((Date.now() - startTime) / 1000).toFixed(1) : '?';
            workbenchEl.outerHTML =
                '<div class="agent-workbench done">' +
                    '<div class="workbench-header" style="cursor:pointer;border-bottom:none">' +
                        '<div class="workbench-status">' +
                            '<span class="pulse-dot done"></span>' +
                            '<span class="wb-status-text">已完成 ' + nSteps + ' 步推理 · ' + totalTime + 's</span>' +
                        '</div>' +
                        '<span class="workbench-timer">' + totalTime + 's</span>' +
                    '</div>' +
                '</div>';
            workbenchEl = null;
        }
        // Append final answer
        if (agentMsg.answer) {
            var conv = conversations.find(function (c) { return c.id === activeConvId; });
            if (conv) {
                appendMessageBubble({
                    role: 'agent',
                    answer: agentMsg.answer,
                    reasoningTrace: agentMsg.reasoningTrace,
                    sources: agentMsg.sources
                }, true);
            }
        } else {
            var conv = conversations.find(function (c) { return c.id === activeConvId; });
            if (conv) {
                appendMessageBubble({
                    role: 'agent',
                    answer: '抱歉，未能生成回答。请重试。',
                    reasoningTrace: agentMsg.reasoningTrace || [],
                    sources: []
                }, true);
            }
        }
        scrollToBottom();
    }

    function handleSSEEvent(data, agentMsg) {
        if (data.type === 'step') {
            addWorkbenchStep(data);
            agentMsg.reasoningTrace.push({
                step: data.step || '',
                tool: data.tool || '',
                args: data.args || '',
                result_preview: data.preview || '',
                elapsed: data.elapsed || 0
            });
            scrollToBottom();
        } else if (data.type === 'answer') {
            agentMsg.answer = data.answer;
            agentMsg.sources = data.sources || [];
        } else if (data.type === 'error') {
            agentMsg.answer = '错误: ' + (data.message || '未知错误');
        }
        // start event is ignored — workbench already showing via showThinking()
    }

    /* ── POST Fallback ──────────────────────────────────── */
    async function postAgentResponse(question, agentMsg) {
        removeThinking();
        try {
            var result = await API.post('/api/agent', {
                question: question,
                top_k: 8
            });
            agentMsg.answer = result.answer || '';
            agentMsg.reasoningTrace = result.reasoning_trace || result.steps || [];
            agentMsg.sources = result.sources || [];
            agentMsg.model = result.model || '';
            // Show steps as workbench cards (retroactively)
            if (agentMsg.reasoningTrace.length > 0) {
                showThinking();
                agentMsg.reasoningTrace.forEach(function (s) { addWorkbenchStep(s); });
                removeThinking();
            }
        } catch (e) {
            agentMsg.answer = '抱歉，请求处理失败: ' + (e.message || '未知错误');
        }
        // Append agent message
        let conv = conversations.find(function (c) { return c.id === activeConvId; });
        if (conv) {
            appendMessageBubble({ role: 'agent', answer: agentMsg.answer, reasoningTrace: agentMsg.reasoningTrace, sources: agentMsg.sources }, true);
        }
        scrollToBottom();
    }

    /* ── New Conversation ───────────────────────────────── */
    function createNewConversation(firstQuestion) {
        var id = 'conv-' + Date.now();
        var title = firstQuestion
            ? firstQuestion.substring(0, 20) + (firstQuestion.length > 20 ? '...' : '')
            : '新对话';

        var conv = {
            id: id,
            title: title,
            preview: firstQuestion || '',
            date: new Date().toISOString().split('T')[0],
            messages: []
        };

        conversations.unshift(conv);
        activeConvId = id;
        if (currentTitle) currentTitle.textContent = title;
        hideEmptyState();
        renderConvList();
    }

    if (newConvBtn) {
        newConvBtn.addEventListener('click', function () {
            activeConvId = null;
            if (currentTitle) currentTitle.textContent = '新对话';
            chatMessages.innerHTML = '';
            showEmptyState();
            renderConvList();
            chatInput.focus();
        });
    }

    /* ── Example Chips ──────────────────────────────────── */
    var exampleChips = document.querySelectorAll('.example-chip');
    exampleChips.forEach(function (chip) {
        chip.addEventListener('click', function () {
            var question = chip.getAttribute('data-query') || chip.textContent.trim();
            sendMessage(question);
        });
    });

    /* ── Send Button ────────────────────────────────────── */
    if (sendBtn) {
        sendBtn.addEventListener('click', function () {
            sendMessage(chatInput.value);
        });
    }

    /* ── Keyboard ───────────────────────────────────────── */
    if (chatInput) {
        chatInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage(chatInput.value);
            }
        });

        // Auto-resize textarea
        chatInput.addEventListener('input', function () {
            chatInput.style.height = 'auto';
            chatInput.style.height = Math.min(chatInput.scrollHeight, 160) + 'px';
        });
    }

    /* ── Role-Based Visibility ──────────────────────────── */
    if (user && user.role === 'admin') {
        var adminLink = document.getElementById('chatAdminLink');
        if (adminLink) adminLink.style.display = '';
    }

    /* ── Logout ──────────────────────────────────────────── */
    var logoutBtn = document.getElementById('chatLogoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function (e) {
            e.preventDefault();
            Auth.clearSession();
            window.location.href = '/login';
        });
    }

    /* ── Init ───────────────────────────────────────────── */
    // CRITICAL: clear state BEFORE anything else
    isStreaming = false;
    if (chatMessages) chatMessages.innerHTML = '';
    if (chatInput) { chatInput.value = ''; chatInput.disabled = false; }
    if (sendBtn) sendBtn.disabled = false;

    renderConvList();
    showEmptyState();

    // Lazy connection check — non-blocking with timeout
    setTimeout(function () {
        var controller = new AbortController();
        var timeout = setTimeout(function () { controller.abort(); }, 5000);
        fetch('/health', { signal: controller.signal })
            .then(function (r) { if (!r.ok) throw new Error('down'); })
            .catch(function () {
                var banner = document.createElement('div');
                banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;padding:10px 16px;text-align:center;font-size:13px;background:rgba(239,68,68,0.12);border-bottom:1px solid rgba(239,68,68,0.25);color:#f87171;';
                banner.textContent = '⚠ 后端服务未连接 — 请运行 uvicorn api:app --port 8000';
                document.body.prepend(banner);
            })
            .finally(function () { clearTimeout(timeout); });
    }, 500);

    // Handle bfcache restore — reset ALL state
    window.addEventListener('pageshow', function (e) {
        if (e.persisted) {
            isStreaming = false;
            if (chatMessages) chatMessages.innerHTML = '';
            if (chatInput) { chatInput.value = ''; chatInput.disabled = false; }
            if (sendBtn) sendBtn.disabled = false;
            renderConvList();
            showEmptyState();
        }
    });
})();
