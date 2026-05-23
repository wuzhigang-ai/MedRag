/* ============================================================
   MedASR — Login / Register Logic
   ============================================================ */

(function () {
    'use strict';

    var isRegisterMode = false;

    /* ── DOM ────────────────────────────────────────────── */
    var form = document.getElementById('loginForm');
    var title = document.getElementById('loginTitle');
    var subtitle = document.getElementById('loginSubtitle');
    var roleGroup = document.getElementById('roleGroup');
    var toggleLink = document.getElementById('toggleMode');
    var errorEl = document.getElementById('formError');
    var submitBtn = document.getElementById('submitBtn');
    var usernameInput = document.getElementById('username');
    var passwordInput = document.getElementById('password');
    var roleOptions = document.querySelectorAll('.role-option');
    var selectedRole = 'user';

    /* ── Delegated click for auth mode toggle link ────────── */
    toggleLink.addEventListener('click', function (e) {
        if (e.target.tagName === 'A') {
            e.preventDefault();
            toggleAuthMode();
        }
    });

    /* ── Toggle Login / Register ────────────────────────── */
    window.toggleAuthMode = function () {
        isRegisterMode = !isRegisterMode;
        if (isRegisterMode) {
            title.textContent = '创建账号';
            subtitle.textContent = '注册加入 MedASR 医学知识平台';
            roleGroup.classList.remove('hidden');
            submitBtn.textContent = '注册';
            toggleLink.innerHTML = '已有账号？<a>登录</a>';
            // Reset role selection to match UI
            selectedRole = 'user';
            roleOptions.forEach(function (o) { o.classList.remove('selected'); });
            if (roleOptions.length > 0) roleOptions[0].classList.add('selected');
        } else {
            title.textContent = '欢迎回来';
            subtitle.textContent = '登录 MedASR 医学知识平台';
            roleGroup.classList.add('hidden');
            submitBtn.textContent = '登录';
            toggleLink.innerHTML = '没有账号？<a>注册</a>';
        }
        errorEl.textContent = '';
    };

    /* ── Role Selection ─────────────────────────────────── */
    roleOptions.forEach(function (opt) {
        opt.addEventListener('click', function () {
            roleOptions.forEach(function (o) { o.classList.remove('selected'); });
            opt.classList.add('selected');
            selectedRole = opt.getAttribute('data-role');
        });
    });

    /* ── Form Submit ────────────────────────────────────── */
    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        errorEl.textContent = '';

        var username = usernameInput.value.trim();
        var password = passwordInput.value.trim();

        if (!username || !password) {
            errorEl.textContent = '请填写所有字段';
            return;
        }

        if (password.length < 3) {
            errorEl.textContent = '密码至少需要3个字符';
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = '处理中...';

        try {
            var endpoint = isRegisterMode ? '/api/register' : '/api/login';
            var payload = isRegisterMode
                ? { username: username, password: password, role: selectedRole }
                : { username: username, password: password };

            var result = await API.post(endpoint, payload);

            Auth.setSession(result.token, {
                username: result.username,
                role: result.role
            });

            Toast.show(isRegisterMode ? '注册成功，正在跳转...' : '登录成功，正在跳转...', 'success');

            setTimeout(function () {
                if (result.role === 'admin') {
                    window.location.href = '/admin';
                } else {
                    window.location.href = '/chat';
                }
            }, 600);
        } catch (err) {
            errorEl.textContent = err.message || '操作失败，请重试';
            submitBtn.disabled = false;
            submitBtn.textContent = isRegisterMode ? '注册' : '登录';
        }
    });

    /* ── Keyboard submit ────────────────────────────────── */
    passwordInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            form.dispatchEvent(new Event('submit'));
        }
    });

    usernameInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            passwordInput.focus();
        }
    });

    /* ── Init ───────────────────────────────────────────── */
    if (Auth.isLoggedIn()) {
        var user = Auth.getUser();
        if (user && user.role === 'admin') {
            window.location.href = '/admin';
        } else if (user) {
            window.location.href = '/chat';
        }
    } else if (document.referrer && document.referrer.indexOf('/admin') !== -1) {
        errorEl.textContent = '请先登录后再访问管理后台';
    } else if (document.referrer && document.referrer.indexOf('/chat') !== -1) {
        errorEl.textContent = '请先登录后再使用问答功能';
    }
})();
