/* ============================================================
   MedASR — Landing Page Typing Effect
   ============================================================ */

(function () {
    'use strict';

    /* ── Typing Effect ─────────────────────────────────── */
    var text = '医学知识，从未如此精准';
    var el = document.getElementById('typedText');
    var i = 0;

    function type() {
        if (i < text.length) {
            el.textContent += text.charAt(i);
            i++;
            setTimeout(type, 50);
        }
    }

    // Start after page load settles
    setTimeout(type, 400);

    /* ── Page Load Animations ──────────────────────────── */
    Anim.initPageLoad();
})();
