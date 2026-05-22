/* ============================================================
   MedASR — Shared API Wrapper
   ============================================================ */

const API = {
    base: '',

    async get(path) {
        const r = await fetch(this.base + path);
        if (!r.ok) throw new Error(await r.text());
        return r.json();
    },

    async post(path, data) {
        const r = await fetch(this.base + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!r.ok) throw new Error(await r.text());
        return r.json();
    },

    async upload(path, formData) {
        const r = await fetch(this.base + path, {
            method: 'POST',
            body: formData
        });
        if (!r.ok) throw new Error(await r.text());
        return r.json();
    },

    async stream(path, onChunk, onDone, onError) {
        try {
            const r = await fetch(this.base + path);
            if (!r.ok) throw new Error(await r.text());
            const reader = r.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data: ')) continue;
                    const data = trimmed.slice(6);
                    if (data === '[DONE]') {
                        if (onDone) onDone();
                        return;
                    }
                    try {
                        const parsed = JSON.parse(data);
                        if (onChunk) onChunk(parsed);
                    } catch (e) {
                        // skip malformed chunks
                    }
                }
            }
            if (onDone) onDone();
        } catch (e) {
            if (onError) onError(e);
        }
    }
};

/* ── Toast Helper ──────────────────────────────────────── */
const Toast = {
    show(msg, type) {
        type = type || 'info';
        let container = document.querySelector('.toast-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'toast-container';
            document.body.appendChild(container);
        }
        const el = document.createElement('div');
        el.className = 'toast toast-' + type;
        el.textContent = msg;
        container.appendChild(el);
        setTimeout(function () {
            el.style.opacity = '0';
            el.style.transform = 'translateX(60px)';
            el.style.transition = 'all 0.3s ease-out';
            setTimeout(function () { el.remove(); }, 300);
        }, 3500);
    }
};

/* ── Auth Helpers ──────────────────────────────────────── */
const Auth = {
    getToken() {
        return localStorage.getItem('medasr_token');
    },
    getUser() {
        try {
            return JSON.parse(localStorage.getItem('medasr_user') || 'null');
        } catch (e) {
            return null;
        }
    },
    setSession(token, user) {
        localStorage.setItem('medasr_token', token);
        localStorage.setItem('medasr_user', JSON.stringify(user));
    },
    clearSession() {
        localStorage.removeItem('medasr_token');
        localStorage.removeItem('medasr_user');
    },
    isLoggedIn() {
        return !!this.getToken();
    },
    requireAuth() {
        if (!this.isLoggedIn()) {
            window.location.href = '/login';
            return false;
        }
        return true;
    }
};

/* ── Animation Helper ──────────────────────────────────── */
const Anim = {
    initPageLoad() {
        const els = document.querySelectorAll('.animate-on-load');
        els.forEach(function (el, i) {
            el.style.transitionDelay = (i * 80) + 'ms';
            requestAnimationFrame(function () {
                el.classList.add('visible');
            });
        });
    }
};
