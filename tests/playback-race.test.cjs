const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlayer } = require('./helpers/player.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));

for (const order of [[0, 1], [1, 0]]) {
    test(`last click wins for response order ${order}`, async () => {
        const p = createPlayer();
        const b = p.ctx.playSong(1), c = p.ctx.playSong(2);
        for (const i of order) {
            p.requests[i].resolve({ url: i === 0 ? '/audio-B.mp3' : '/audio-C.mp3' });
            await (i === 0 ? b : c);
        }
        assert.deepEqual(p.played, ['/audio-C.mp3']);
        assert.equal(p.audio.src, '/audio-C.mp3');
        assert.equal(p.ctx.currentSongName, 'C - Artist');
    });
}

test('stale failure does not skip, mark dead or pause the newest selection', async () => {
    const p = createPlayer();
    const b = p.ctx.playSong(1), c = p.ctx.playSong(2);
    p.requests[1].resolve({ url: '/audio-C.mp3' });
    await c;
    p.requests[0].reject(new Error('B timed out'));
    await b;
    assert.equal(p.notices.length, 0);
    assert.equal(p.ctx.consecutiveFailures, 0);
    assert.equal(Object.keys(p.ctx.deadSongIndexes).length, 0);
    assert.equal(p.audio.paused, false);
});

test('B C B uses request identity, not song name or index', async () => {
    const p = createPlayer();
    const selections = [p.ctx.playSong(1), p.ctx.playSong(2), p.ctx.playSong(1)];
    for (const i of [2, 1, 0]) {
        p.requests[i].resolve({ url: `/audio-request-${i}.mp3` });
        await selections[i];
    }
    assert.deepEqual(p.played, ['/audio-request-2.mp3']);
});

test('old A end/error cannot replace pending C', async () => {
    const p = createPlayer();
    const c = p.ctx.playSong(2);
    p.audio.emit('ended');
    p.audio.emit('error');
    assert.equal(p.requests.length, 1);
    assert.equal(p.notices.length, 0);
    p.requests[0].resolve({ url: '/audio-C.mp3' });
    await c;
});

test('stale cloud resume and metadata do not seek or play B after C', async () => {
    const p = createPlayer({ readyState: 0 });
    p.ctx.ConfigManager.set('config', 'playlist_configs', { Test: { resumeLocal: 'global' } });
    const b = p.ctx.playSong(1);
    p.requests[0].resolve({ url: '/audio-B.mp3' });
    await tick();
    const c = p.ctx.playSong(2);
    p.requests[2].resolve({ url: '/audio-C.mp3' });
    await tick();
    p.requests[3].resolve({ data: { songName: 'C - Artist', time: 12 } });
    await c;
    p.requests[1].resolve({ data: { songName: 'B - Artist', time: 90 } });
    await b;
    p.audio.emit('loadedmetadata');
    assert.equal(p.audio.currentTime, 12);
    assert.deepEqual(p.played, ['/audio-C.mp3']);
});

test('a pending metadata listener is removed on the next selection', async () => {
    const p = createPlayer({ readyState: 0 });
    const b = p.ctx.playSong(1, false, 80);
    p.requests[0].resolve({ url: '/audio-B.mp3' });
    await b;
    const c = p.ctx.playSong(2, false, 10);
    p.requests[1].resolve({ url: '/audio-C.mp3' });
    await c;
    p.audio.emit('loadedmetadata');
    assert.equal(p.audio.currentTime, 10);
});

test('late preloading cannot overwrite a newer selection cache', async () => {
    const p = createPlayer();
    const preload = p.ctx.scoutNextSong(1);
    const c = p.ctx.playSong(2);
    p.requests[1].resolve({ url: '/audio-C.mp3' });
    await c;
    p.requests[0].resolve({ url: '/audio-B.mp3' });
    await preload;
    assert.equal(p.ctx.preloadCache, null);
    assert.equal(p.ctx.isScouting, false);
});

test('late lyric result from an earlier request for the same song is ignored', async () => {
    const p = createPlayer();
    const lyrics = [], resolvers = [];
    p.ctx.LyricsEngine = { parse: lrc => lyrics.push(lrc), sync() {} };
    p.ctx.fetchSongLyric = () => new Promise(resolve => resolvers.push(resolve));
    const first = p.ctx.playSong(1), second = p.ctx.playSong(1);
    p.requests[1].resolve({ url: '/new.mp3' }); await second;
    resolvers[1]('new lyric'); await tick();
    resolvers[0]('old lyric'); await tick();
    p.requests[0].resolve({ url: '/old.mp3' }); await first;
    assert.equal(lyrics.at(-1), 'new lyric');
});

test('late cross-playlist scout cannot overwrite the current preload cache', async () => {
    const p = createPlayer();
    const scout = p.ctx.scoutCrossPlaylistSong('Other', { id: 99, title: 'Old' });
    const c = p.ctx.playSong(2);
    p.requests[1].resolve({ url: '/audio-C.mp3' }); await c;
    const latestCache = { playlist: 'Test', index: 0 };
    p.ctx.preloadCache = latestCache;
    p.ctx.isScouting = true;
    p.requests[0].resolve({ url: '/old.mp3' }); await scout;
    assert.equal(p.ctx.preloadCache, latestCache);
    assert.equal(p.ctx.isScouting, true);
});
