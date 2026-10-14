const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createPlayer(options = {}) {
    const requests = [], played = [], notices = [], timers = new Map(), storage = new Map();
    const elements = new Map();
    let timerId = 0;
    function element(id) {
        if (elements.has(id)) return elements.get(id);
        const events = new Map(), classes = new Set();
        const node = {
            id, dataset: {}, style: { setProperty() {}, removeProperty() {} }, value: '100',
            innerText: '', innerHTML: '', textContent: '',
            classList: {
                add(...names) { names.forEach(n => classes.add(n)); },
                remove(...names) { names.forEach(n => classes.delete(n)); },
                contains(n) { return classes.has(n); },
                toggle(n) { if (classes.has(n)) classes.delete(n); else classes.add(n); }
            },
            setAttribute() {}, removeAttribute() {}, scrollIntoView() {},
            querySelector() { return { setAttribute() {}, style: {}, classList: this.classList }; },
            querySelectorAll() { return []; },
            addEventListener(type, fn) {
                if (!events.has(type)) events.set(type, new Set());
                events.get(type).add(fn);
            },
            removeEventListener(type, fn) { events.get(type)?.delete(fn); },
            emit(type, extra = {}) {
                for (const fn of [...(events.get(type) || [])]) {
                    fn({ target: node, stopPropagation() {}, preventDefault() {}, ...extra });
                }
            },
            click() { this.emit('click'); },
            getBoundingClientRect() { return { left: 0, width: 300 }; }
        };
        elements.set(id, node);
        return node;
    }
    const audio = element('audio');
    let src = '/audio-A.mp3';
    Object.assign(audio, {
        currentTime: 60, duration: 240, readyState: options.readyState ?? 1, paused: false,
        ended: false, playbackRate: 1, buffered: { length: 0 },
        play() { this.paused = false; played.push(src); this.emit('play'); return Promise.resolve(); },
        pause() { this.paused = true; this.emit('pause'); }, load() {},
        dataset: { playingPlaylist: 'Test', playingSongName: 'A - Artist', playbackRequest: '0', hasStarted: '1' }
    });
    Object.defineProperty(audio, 'src', {
        get: () => src,
        set: value => { src = value; audio.currentTime = 0; audio.paused = true; }
    });
    const nullIds = new Set(['np-title', 'mini-cover', 'fp-cover', 'mini-cover-img', 'fp-ambient-img']);
    const ctx = {
        console, URL, URLSearchParams, Date, Math,
        navigator: {},
        location: { href: 'https://test.invalid/plugin/', host: 'test.invalid' },
        document: {
            getElementById: id => nullIds.has(id) || id.startsWith('list-cover-') ? null : element(id),
            querySelectorAll: () => [], addEventListener() {},
            body: { classList: element('body').classList, style: {} }
        },
        localStorage: {
            getItem: key => storage.get(key) ?? null,
            setItem: (key, value) => storage.set(key, String(value)),
            removeItem: key => storage.delete(key)
        },
        setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; },
        clearTimeout(id) { timers.delete(id); }, setInterval: () => 0, clearInterval() {},
        fetch(url) {
            return new Promise((resolve, reject) => requests.push({
                url: String(url), resolve: data => resolve({ ok: true, json: async () => data }), reject
            }));
        }
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    for (const file of ['utils.js', 'player.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../../static', file), 'utf8'), ctx, { filename: file });
    }
    Object.assign(ctx, {
        songList: ['A', 'B', 'C'].map((title, i) => ({
            id: i + 1, title, artist: 'Artist', _scrapedCover: '/cover.jpg'
        })),
        currentPlaylist: 'Test', currentIndex: 0, currentSongName: 'A - Artist',
        favoriteList: [], deadSongIndexes: {}, consecutiveFailures: 0, playMode: 1,
        preloadCache: null, defaultCover: '/default.jpg', API: { info: '/info?id=' },
        showToast: text => notices.push(text), fetchSongLyric: async () => null,
        updateNpTitleUI() {}, updatePlayButtonUI() {}
    });
    if (options.bind !== false) ctx.bindPlayerEvents();
    return { ctx, audio, requests, played, notices, timers, storage, element };
}

module.exports = { createPlayer };
