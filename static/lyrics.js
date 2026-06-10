// static/lyrics.js
window.LyricsEngine = (function() {
    let parsedLyrics = [];
    let manualScrolling = false;
    let resumeTimer = null;
    let dragStartY = 0;
    let startOffset = 0;
    let wrapperEl = null;
    let containerEl = null;

    function init(wrapperId, containerId) {
        wrapperEl = document.getElementById(wrapperId);
        containerEl = document.getElementById(containerId);
        bindEvents();
    }

    function parse(lrcString) {
        parsedLyrics = [];
        if (!lrcString) {
            containerEl.innerHTML = '<div class="no-lyrics">暂无歌词，请欣赏音乐吧</div>';
            containerEl.style.transform = `translateY(0px)`;
            return;
        }
        const lines = lrcString.split('\n');
        const timeRegex = /\[(\d{2,}):(\d{2}(?:\.\d{1,3})?)\](.*)/;
        lines.forEach(line => {
            const match = timeRegex.exec(line);
            if (match) {
                const min = parseInt(match[1], 10);
                const sec = parseFloat(match[2]);
                const text = match[3].trim();
                if (text) parsedLyrics.push({ time: min * 60 + sec, text: text });
            }
        });
        if (parsedLyrics.length > 0) {
            parsedLyrics = [...Array.from({ length: 2 }, (_, i) => ({ time: i * 0.1, text: '\u200B' })), ...parsedLyrics];
        }
        if (parsedLyrics.length === 0) {
            containerEl.innerHTML = '<div class="no-lyrics">暂无歌词，请欣赏音乐吧</div>';
            containerEl.style.transform = `translateY(0px)`;
        } else {
            containerEl.innerHTML = parsedLyrics.map((lyric, idx) => `<div class="lyric-line" id="lyric-${idx}">${lyric.text}</div>`).join('');
        }
    }

    function sync(currentTime) {
        if (parsedLyrics.length === 0 || manualScrolling) return;
        let activeIndex = -1;
        for (let i = 0; i < parsedLyrics.length; i++) {
            if (currentTime >= parsedLyrics[i].time) activeIndex = i;
            else break;
        }
        if (activeIndex !== -1) {
            const oldActive = document.querySelector('.lyric-line.active');
            if (oldActive) oldActive.classList.remove('active');
            const currentLine = document.getElementById(`lyric-${activeIndex}`);
            if (currentLine) {
                currentLine.classList.add('active');
                const offset = currentLine.offsetTop - (wrapperEl.offsetHeight / 2) + (currentLine.offsetHeight / 2);
                containerEl.style.transform = `translateY(-${Math.max(0, offset)}px)`;
            }
        }
    }

    function getOffset() {
        const m = /translateY\(-?(\d+(?:\.\d+)?)px\)/.exec(containerEl.style.transform || '');
        return m ? parseFloat(m[1]) : 0;
    }

    function getMaxOffset() {
        return Math.max(0, containerEl.scrollHeight - wrapperEl.offsetHeight);
    }

    function bindEvents() {
        if (!wrapperEl) return;

        function onDragStart(e) {
            if (e.type === 'mousedown' && e.button !== 0) return;
            if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = null; }
            manualScrolling = true;
            dragStartY = (e.touches ? e.touches[0].clientY : e.clientY);
            startOffset = getOffset();
            containerEl.style.transition = 'none';
            wrapperEl.classList.add('dragging');
            document.body.style.userSelect = 'none';
            document.body.style.webkitUserSelect = 'none';
            if (e.type === 'mousedown') e.preventDefault();
        }

        function onDragMove(e) {
            if (!manualScrolling || (e.type === 'mousemove' && e.buttons !== 1)) return;
            e.preventDefault();
            const delta = (e.touches ? e.touches[0].clientY : e.clientY) - dragStartY;
            containerEl.style.transform = `translateY(-${Math.max(0, Math.min(getMaxOffset(), startOffset - delta))}px)`;
        }

        function onDragEnd() {
            if (!manualScrolling) return;
            containerEl.style.transition = '';
            document.body.style.userSelect = '';
            document.body.style.webkitUserSelect = '';
            wrapperEl.classList.remove('dragging');
            if (resumeTimer) clearTimeout(resumeTimer);
            resumeTimer = setTimeout(() => { resumeTimer = null; manualScrolling = false; }, 2000);
        }

        wrapperEl.addEventListener('mousedown', onDragStart);
        document.addEventListener('mousemove', onDragMove, { passive: false });
        document.addEventListener('mouseup', onDragEnd);
        wrapperEl.addEventListener('touchstart', onDragStart, { passive: false });
        wrapperEl.addEventListener('touchmove', onDragMove, { passive: false });
        wrapperEl.addEventListener('touchend', onDragEnd);
    }

    return { init, parse, sync };
})();