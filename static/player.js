// static/player.js
(function(window) {
    'use strict';

    // 内部微型 DOM 获取器
    const $ = (id) => document.getElementById(id);

    // 🌟 核心引擎重构：统一在线歌曲身份复原器
    window.restoreOnlineIdentity = function(rawItem) {
        if (!rawItem || !rawItem.id) return rawItem;

        if (!rawItem.plugin_entry_path && window.playlistPool) {
            const trueBody = window.playlistPool.find(s => s.id === rawItem.id);
            if (trueBody && trueBody.plugin_entry_path) {
                rawItem = { ...rawItem, ...trueBody };
            }
        }

        if (rawItem.plugin_entry_path && !rawItem._isOnlineObj) {
            let parsed = false;

            const jsonStr = (typeof rawItem.file_path === 'string' && rawItem.file_path.startsWith('{')) ? rawItem.file_path :
                            ((typeof rawItem.dedup_key === 'string' && rawItem.dedup_key.startsWith('{')) ? rawItem.dedup_key : null);

            if (jsonStr) {
                try {
                    rawItem.source_data = JSON.parse(jsonStr);
                    rawItem._isOnlineObj = true;
                    parsed = true;
                } catch(e) {}
            }

            if (!parsed && rawItem.plugin_entry_path === 'lxmusic' && typeof rawItem.dedup_key === 'string' && rawItem.dedup_key.includes(':')) {
                const parts = rawItem.dedup_key.split(':');
                if (parts.length >= 2) {
                    const source = parts[0];
                    const musicId = parts.slice(1).join(':');

                    rawItem.source_data = {
                        source: source,
                        musicId: musicId,
                        songmid: musicId,
                        duration: rawItem.duration || 0
                    };
                    rawItem._isOnlineObj = true;
                    parsed = true;
                }
            }

            if (!parsed && rawItem.plugin_entry_path === 'dav' && typeof rawItem.dedup_key === 'string' && rawItem.dedup_key.startsWith('dav_')) {
                const rest = rawItem.dedup_key.substring(4);
                const firstSlash = rest.indexOf('/');
                if (firstSlash !== -1) {
                    let configName = rest.substring(0, firstSlash);
                    if (configName.endsWith('_')) configName = configName.slice(0, -1);
                    rawItem.source_data = {
                        configName: configName,
                        path: rest.substring(firstSlash)
                    };
                    rawItem._isOnlineObj = true;
                    parsed = true;
                }
            }
        }

        return rawItem;
    };

    window.fetchSongLyric = async function(rawItem, targetSongName) {
        rawItem = window.restoreOnlineIdentity(rawItem);
        let finalLrc = null;

        const isValidLrc = (lrc) => typeof lrc === 'string' && /\[\d{2,}:\d{2}(?:\.\d{1,3})?\]/.test(lrc);

        try {
            if (rawItem && rawItem.id) {
                try {
                    const slRes = await fetch(`/api/v1/songs/${rawItem.id}/lyric`);
                    if (slRes.ok) {
                        const slData = await slRes.json();
                        if (isValidLrc(slData?.lyric)) {
                            return slData.lyric;
                        }
                    }
                } catch(e) {}
            }

            if (rawItem && rawItem._isOnlineObj && rawItem.plugin_entry_path !== 'dav') {
                let sd = rawItem.source_data;
                if (typeof sd === 'string') { try { sd = JSON.parse(sd); } catch(e){} }

                const isLx = rawItem.plugin_entry_path === 'lxmusic' || (sd && sd.source);
                if (isLx) {
                    try {
                        const lrcUrl = `/api/v1/jsplugin/lxmusic/api/direct/lyric?source=${sd.source}&songmid=${sd.songmid || sd.musicId}&musicId=${sd.musicId}&duration=${sd.duration}`;
                        const lrcRes = await fetch(lrcUrl);
                        const lrcData = await lrcRes.json();
                        if (lrcData.code === 0 && isValidLrc(lrcData.data?.lyric)) {
                            return lrcData.data.lyric;
                        }
                    } catch(e) {}
                }
            }

            finalLrc = await window.fetchScrape(rawItem, 'lyric', targetSongName);
            if (finalLrc) {
                return finalLrc;
            }
        } catch(e) {}

        return null;
    };

    window.markSongAsDead = function(playlistName, songIndex) {
        if (!window.deadSongIndexes[playlistName]) {
            window.deadSongIndexes[playlistName] = [];
        }
        if (!window.deadSongIndexes[playlistName].includes(songIndex)) {
            window.deadSongIndexes[playlistName].push(songIndex);
        }
        if (playlistName === window.currentPlaylist) {
            const timeWrap = $('time-wrap-' + songIndex);
            if (timeWrap) timeWrap.innerHTML = `<div class="song-dead-tag">失效</div>`;
        }
    };

    window.updateNpTitleUI = function(text, checkFav = true, formatReady = true) {
        const miniCover = $('mini-cover');
        const npTitle = $('np-title');
        const audioEl = $('audio');

        if (!text || !npTitle) return;
        if (text === "暂无播放") {
            if (miniCover) miniCover.style.display = 'none';
        } else {
            if (miniCover) miniCover.style.display = 'block';
        }

        let extHtml = '';
        let extension = '';
        let isVisible = false;

        const validExts = ['MP3', 'FLAC', 'WAV', 'M4A', 'AAC', 'OGG', 'APE', 'WMA'];

        if (formatReady && text !== "暂无播放") {
            let rawItem = null;
            if (window.currentIndex !== -1 && window.songList[window.currentIndex]) {
                const currentName = window.getSongNameObj(window.songList[window.currentIndex]);
                if (currentName === text) rawItem = window.songList[window.currentIndex];
            }

            if (rawItem) {
                rawItem = window.restoreOnlineIdentity(rawItem);
                let targetPath = rawItem.file_path;

                if (rawItem.plugin_entry_path === 'dav' && rawItem.source_data && rawItem.source_data.path) {
                    targetPath = rawItem.source_data.path;
                }

                if (!targetPath && typeof rawItem.dedup_key === 'string') {
                    targetPath = rawItem.dedup_key;
                }

                if (targetPath) {
                    const match = String(targetPath).match(/\.([a-zA-Z0-9]+)$/);
                    if (match) {
                        let ext = match[1].toUpperCase();
                        if (validExts.includes(ext)) {
                            extension = ext;
                            isVisible = true;
                        }
                    }
                }
            }

            if (!isVisible && audioEl && audioEl.src) {
                try {
                    let urlToParse = audioEl.src;
                    if (urlToParse.includes('urlb64=')) {
                        const b64 = new URL(urlToParse).searchParams.get('urlb64');
                        try { urlToParse = decodeURIComponent(escape(window.atob(b64))); } catch(e) { urlToParse = window.atob(b64); }
                    }

                    let cleanUrl = urlToParse.split('?')[0].split('#')[0];
                    const match = cleanUrl.match(/\.([a-zA-Z0-9]+)$/);
                    if (match) {
                        let ext = match[1].toUpperCase();
                        if (validExts.includes(ext)) {
                            extension = ext;
                            isVisible = true;
                        }
                    }
                } catch(e) {}
            }
        }

        if (isVisible && extension) {
            const tagStyle = `display: inline-flex; align-items: center; justify-content: center; min-width: 28px; height: 14px; box-sizing: border-box; font-size: 8px; border: 1px solid var(--tag-local); color: var(--tag-local); border-radius: 4px; padding: 0 2px; margin-left: 6px; font-weight: bold; flex-shrink: 0; line-height: 1; transform: translateY(2px);`;
            extHtml = `<span style="${tagStyle}">${extension}</span>`;
        }

        npTitle.innerHTML = `
          <div class="np-marquee-container" style="display: flex; align-items: center; white-space: nowrap;">
            <span class="np-title-text">${text}</span>
            <div class="np-title-extra" style="display: flex; align-items: center; flex-shrink: 0;">
              ${extHtml}
            </div>
          </div>
        `;

        setTimeout(() => {
            const container = npTitle.querySelector('.np-marquee-container');
            if (container) {
                const overflow = container.scrollWidth - npTitle.clientWidth;
                if (overflow > 0) {
                    container.style.setProperty('--scroll-dist', `-${overflow + 20}px`);
                    container.classList.add('marquee-scroll');
                    npTitle.style.justifyContent = 'flex-start';
                } else {
                    container.classList.remove('marquee-scroll');
                    npTitle.style.justifyContent = 'center';
                }
            }
        }, 50);
    };

    window.highlightSongUI = function(index) {
        if (window.currentIndex !== -1) {
            $('song-' + window.currentIndex)?.classList.remove('playing');
        }
        window.currentIndex = index;

        const conf = window.getPlaylistConfig ? window.getPlaylistConfig(window.currentPlaylist) : {};
        if (conf.resumeLocal === 'off') {
            const currentDeadList = window.deadSongIndexes[window.currentPlaylist] || [];
            document.querySelectorAll('[id^="time-wrap-"]').forEach(el => {
                const idx = parseInt(el.id.replace('time-wrap-', ''));
                if (idx !== window.currentIndex && !currentDeadList.includes(idx)) {
                    el.innerHTML = ''; // 瞬间擦除旧歌的时钟[cite: 4]
                }
            });
        }

        const rawItem = window.songList[window.currentIndex];
        window.currentSongName = window.getSongNameObj(rawItem);

        const currentEl = $('song-' + window.currentIndex);
        if (currentEl) {
            currentEl.classList.add('playing');
            setTimeout(() => window.scrollToCurrentSong('smooth'), 100);
        }

        const timeCurrentEl = $('time-current');
        const timeDurationEl = $('time-duration');
        const progressBar = $('progress-bar');

        const isMiot = window.MiotManager && window.MiotManager.currentDevice.type === 'miot';

        if (timeCurrentEl) {
            timeCurrentEl.innerText = isMiot ? "--:--" : "00:00";
        }
        if (timeDurationEl) {
            const dur = window.songList[window.currentIndex]?.duration;
            timeDurationEl.innerText = dur ? window.formatTime(dur) : "--:--";
        }
        if (progressBar) progressBar.style.width = '0%';

        window.updateNpTitleUI(window.currentSongName, true, false);
        const fpCover = $('fp-cover');
        const miniCoverImg = $('mini-cover-img');
        if (fpCover) fpCover.src = window.defaultCover;
        if (miniCoverImg) miniCoverImg.src = window.defaultCover;
        if (window.LyricsEngine) window.LyricsEngine.parse(null);
    };

    window.scrollToCurrentSong = function(behavior = 'smooth') {
        if (window.currentIndex !== -1) {
            const currentEl = $('song-' + window.currentIndex);
            if (currentEl) {
                currentEl.scrollIntoView({ behavior: behavior, block: 'center' });
            }
        }
    };

    window.toggleFullPlayer = function(forceState) {
        const fullPlayer = $('full-player');
        if (!fullPlayer) return;
        if (window.innerWidth >= 960 && document.body.classList.contains('split-view-active')) return;

        const ambientBg = $('fp-ambient-bg');
        const isOpen = forceState !== undefined ? forceState : !fullPlayer.classList.contains('open');

        if (isOpen) {
            fullPlayer.style.transform = '';

            if (ambientBg) {
                ambientBg.style.removeProperty('transition');
                ambientBg.style.removeProperty('opacity');
            }

            fullPlayer.classList.add('open');
            document.body.classList.add('player-open');
            if (window.isIOS || window.innerWidth < 600) document.body.style.overflow = 'hidden';

            if (window.LyricsEngine && typeof window.LyricsEngine.scrollToCurrent === 'function') {
                setTimeout(() => window.LyricsEngine.scrollToCurrent(), 50);
            }
        } else {
            fullPlayer.style.transform = '';
            fullPlayer.classList.remove('open');

            if (ambientBg) {
                ambientBg.style.setProperty('transition', 'opacity 0.4s cubic-bezier(0.25, 0.8, 0.25, 1)', 'important');
                ambientBg.style.setProperty('opacity', '0', 'important');
            }

            if (!fullPlayer.classList.contains('open')) {
                    document.body.classList.remove('player-open');
                    document.body.style.overflow = '';

                    if (ambientBg) {
                        ambientBg.style.removeProperty('transition');
                        ambientBg.style.removeProperty('opacity');
                    }
            }
        }
    };

    window.closeAllSongMenus = function() {
        if (window.activeSongMenuIndex !== -1) {
            const oldMenu = $('song-menu-' + window.activeSongMenuIndex);
            if (oldMenu) oldMenu.classList.remove('show');
            const oldSong = $('song-' + window.activeSongMenuIndex);
            if (oldSong) oldSong.classList.remove('menu-open');
            window.activeSongMenuIndex = -1;
        }
    };

    window.updateSearchUI = function(playlistName) {
        if (window.FilterManager) window.FilterManager.resetUI();
        const searchWrap = $('search-inline-wrap');
        const mfPluginRow = $('mf-plugin-row');
        const onlineToolbar = $('online-toolbar-container');
        const menuWrapper = $('global-menu-1-wrapper');
        const dropzone1 = $('menu-dropzone-row1');

        if (playlistName === '曲库搜索') {
            if (searchWrap) searchWrap.classList.add('show');
            if (mfPluginRow) mfPluginRow.classList.remove('show');
            if (onlineToolbar) onlineToolbar.classList.remove('show');
            if (menuWrapper && dropzone1) dropzone1.appendChild(menuWrapper);

            const savedSearch = localStorage.getItem('iwebplayer.local_search_keyword') || '';
            const searchInput = $('search-input');
            if (searchInput) searchInput.value = savedSearch;

        } else if (playlistName === '在线资源') {
            if (searchWrap) searchWrap.classList.remove('show');
            if (mfPluginRow) mfPluginRow.classList.add('show');
            if (onlineToolbar) onlineToolbar.classList.add('show');
            if (typeof window.refreshOnlineUI === 'function') window.refreshOnlineUI();
        } else {
            if (searchWrap) searchWrap.classList.remove('show');
            if (mfPluginRow) mfPluginRow.classList.remove('show');
            if (onlineToolbar) onlineToolbar.classList.remove('show');
            if (menuWrapper && dropzone1) dropzone1.appendChild(menuWrapper);
        }
        setTimeout(() => {
            const filterWrap = $('filter-action-wrap');
            if (filterWrap) {
                filterWrap.style.display = ((window.FilterManager && window.FilterManager.getContext()) || playlistName === '我的歌单') ? 'flex' : 'none';
            }

            const jumpWrap = $('jump-source-wrap');
            if (jumpWrap) {
                jumpWrap.style.display = (playlistName === '曲库搜索') ? 'flex' : 'none';
            }

            const gridWrap = $('grid-filter-wrap');
            if (playlistName !== '我的歌单') {
                if (gridWrap) gridWrap.style.display = 'none';
            } else {
                if (gridWrap && window._gridFilterKeyword) {
                    gridWrap.style.display = 'flex';
                    const gridInput = $('grid-filter-input');
                    if (gridInput) gridInput.value = window._gridFilterKeyword;
                    $('grid-filter-clear')?.classList.add('show');

                    gridWrap.classList.add('glow');
                    if (window._gridGlowTimer) clearTimeout(window._gridGlowTimer);
                    window._gridGlowTimer = setTimeout(() => gridWrap.classList.remove('glow'), 800);
                }
            }
        }, 50);

        const navSearchBtn = document.getElementById('nav-search-btn');
        if (navSearchBtn) navSearchBtn.classList.toggle('active', playlistName === '曲库搜索');

        const navOnlineBtn = document.getElementById('nav-online-btn');
        if (navOnlineBtn) navOnlineBtn.classList.toggle('active', playlistName === '在线资源');
    };

    window.toggleFavorite = async function(songName, index) {
        if (navigator.vibrate) navigator.vibrate(50);
        const isFav = window.favoriteList.includes(songName);
        const rawSong = window.songList[index];
        if (!rawSong || !rawSong.id) return;

        let plId = null;
        if (window.playlistMeta) {
            const favPl = window.playlistMeta.find(p => p.name === '收藏');
            if (favPl) plId = favPl.id;
        }
        if (!plId) { window.showToast("❌ 找不到收藏歌单"); return; }

        try {
            if (isFav) {
                await fetch(`/api/v1/playlists/${plId}/songs/${rawSong.id}`, { method: 'DELETE' });
                window.favoriteList = window.favoriteList.filter(name => name !== songName);
            } else {
                await fetch(`/api/v1/playlists/${plId}/songs`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ song_ids: [rawSong.id] })
                });
                window.favoriteList.push(songName);
            }

            const currentlyFav = !isFav;
            const favIcon = $(`fav-${index}`);
            if (favIcon) favIcon.style.display = currentlyFav ? 'block' : 'none';

            if (currentlyFav) window.showToast(`❤️ 已收藏: ${songName}`);
            else window.showToast(`💔 已取消收藏: ${songName}`);

            if (songName === window.currentSongName) {
                window.updateNpTitleUI(window.currentSongName, false);
                const coverSrc = $('fp-cover') ?$('fp-cover').src : window.defaultCover;
                if(window.updateMediaSession) window.updateMediaSession(window.currentSongName, coverSrc, window.favoriteList, window.APP_LOGO);

                const cornerFav = $('fp-corner-fav');
                if (cornerFav) {
                    cornerFav.style.color = currentlyFav ? 'var(--primary)' : 'var(--text-main)';
                    cornerFav.querySelector('svg').setAttribute('fill', currentlyFav ? 'currentColor' : 'none');
                }
            }
        } catch (e) {
            window.showToast("❌ 操作失败，请检查网络");
        }
    };

    window.getWebDavStreamUrl = function(rawItem) {
        if (rawItem && rawItem.plugin_entry_path === 'dav') {
            const globalToken = window.getAccessToken ? window.getAccessToken() : "";

            if (rawItem.id && Number.isInteger(Number(rawItem.id)) && window.currentPlaylist !== '在线资源') {
                return `/api/v1/songs/${rawItem.id}/play?access_token=${globalToken}`;
            }

            let sd = rawItem.source_data || {};
            if (typeof sd === 'string') { try { sd = JSON.parse(sd); } catch(e){} }

            const serverName = sd.configName || (window.webdavData ? window.webdavData.currentServer : '');

            if (!serverName || !sd.path) return null;

            if (serverName && window.webdavData && window.webdavData.credentials && window.webdavData.credentials[serverName]) {
                const cred = window.webdavData.credentials[serverName];
                const encodedPath = sd.path.split('/').map(encodeURIComponent).join('/');

                let targetUrl = cred.baseUrl;
                if (targetUrl.endsWith('/') && encodedPath.startsWith('/')) targetUrl += encodedPath.substring(1);
                else if (!targetUrl.endsWith('/') && !encodedPath.startsWith('/')) targetUrl += '/' + encodedPath;
                else targetUrl += encodedPath;

                try {
                    const urlObj = new URL(targetUrl);
                    urlObj.username = cred.username;
                    if (cred.password) urlObj.password = cred.password;
                    const finalUrl = urlObj.toString();
                    return `/api/v1/proxy?url=${encodeURIComponent(finalUrl)}&access_token=${globalToken}`;
                } catch(e) {}
            }
        }
        return null;
    };

    // =========================================================================
    // 🌟 核心引擎重构：播放请求流转
    // =========================================================================
    let playbackRequest = 0;
    let pendingPlayback = false;
    let metadataCleanup = null;
    const playbackTimers = new Set();

    window.invalidatePlaybackRequest = function() {
        playbackRequest++;
        pendingPlayback = false;
        if (metadataCleanup) { metadataCleanup(); metadataCleanup = null; }
        playbackTimers.forEach(clearTimeout);
        playbackTimers.clear();
        if (window._davDirectTimeout) clearTimeout(window._davDirectTimeout);
        if (window._stalledRecoveryTimeout) clearTimeout(window._stalledRecoveryTimeout);
        window._stalledRecoveryTimeout = null;
        window.isScouting = false;
        return playbackRequest;
    };

    const deferPlayback = (request, callback, delay) => {
        const timer = setTimeout(() => {
            playbackTimers.delete(timer);
            if (request === playbackRequest) callback();
        }, delay);
        playbackTimers.add(timer);
        return timer;
    };

    const playbackTrackKey = (song) => JSON.stringify([
        song.plugin_entry_path || 'local', song.id, song.dedup_key || song.file_path || ''
    ]);

    const currentMedia = (audio) => !pendingPlayback &&
        Number(audio.dataset.playbackRequest) === playbackRequest &&
        (!audio.currentSrc || audio.currentSrc === audio.src);

    window.playSong = async function(index, autoPlay = true, resumeTime = 0, options = {}) {
        if (index < 0 || index >= window.songList.length) return;

        const sessionRestore = options.resumeKind === 'session';
        const request = window.invalidatePlaybackRequest();
        if (window.updatePlayButtonUI && autoPlay) window.updatePlayButtonUI(true);
        pendingPlayback = true;
        const isCurrent = () => request === playbackRequest;
        const targetPlaylist = window.currentPlaylist;
        const selectedList = window.songList.slice();

        const rawItem = window.restoreOnlineIdentity(selectedList[index]);
        const targetSongName = window.getSongNameObj(rawItem);
        const globalToken = window.getAccessToken ? window.getAccessToken() : "";

        // =========================================================
        // 🌟 分叉 1：小爱音箱播放流
        // =========================================================
        if (window.MiotManager && window.MiotManager.currentDevice.type === 'miot') {
            const audioEl = $('audio');
            if (audioEl && !audioEl.paused) audioEl.pause();

            window.highlightSongUI(index);
            window.updateNpTitleUI(targetSongName, true, false);

            if (autoPlay) {
                const pl = window.playlistMeta ? window.playlistMeta.find(p => p.name === targetPlaylist) : null;
                let targetPlId = pl ? pl.id : null;
                const isFiltered = window.FilterManager && window.FilterManager.getFilter().trim() !== '';

                if (!targetPlId || isFiltered) {
                    if (window.showToast) window.showToast(isFiltered ? "⏳ 正在打包过滤后的列表推送至音箱..." : "⏳ 正在将列表打包推送到音箱...", true);
                    targetPlId = await window.MiotManager.syncListToPushPlaylist(selectedList);
                    if (!isCurrent()) return;
                    if (!targetPlId) {
                        if (window.showToast) window.showToast("❌ 打包推送失败，请重试");
                        return;
                    }
                }
                if (!isCurrent()) return;
                window.MiotManager.playPlaylist(targetPlId, index);
            }

            const fpCover = $('fp-cover');
            const miniCoverImg = $('mini-cover-img');

            const handleCoverError = function() {
                if (!isCurrent()) return;
                if (this.src && !this.src.includes('/api/v1/proxy') && this.src.startsWith('http') && !this.src.includes(window.location.host)) {
                    const token = window.getAccessToken ? window.getAccessToken() : "";
                    this.src = `/api/v1/proxy?url=${encodeURIComponent(this.src)}&access_token=${token}`;
                    return;
                }

                if (this.src !== window.defaultCover) {
                    this.src = window.defaultCover;
                    if (!rawItem._scrapedCover) {
                        window.fetchScrape(rawItem, 'cover', targetSongName).then(hdCover => {
                            if (isCurrent() && hdCover) {
                                rawItem._scrapedCover = hdCover;
                                if (fpCover) fpCover.src = hdCover;
                                if (miniCoverImg) miniCoverImg.src = hdCover;
                                const listImg = $('list-cover-' + index);
                                if (listImg) listImg.src = hdCover;
                                if(window.updateMediaSession) window.updateMediaSession(targetSongName, hdCover, window.favoriteList, window.APP_LOGO);
                            }
                        }).catch(()=>{});
                    }
                }
            };
            if (fpCover) fpCover.onerror = handleCoverError;
            if (miniCoverImg) miniCoverImg.onerror = handleCoverError;

            let finalCover = window.defaultCover;
            const listImg = $('list-cover-' + index);
            if (listImg && listImg.src && !listImg.src.includes('undefined') && listImg.src !== window.location.href && !listImg.src.startsWith('data:image/svg+xml')) {
                finalCover = listImg.src;
            } else if (rawItem._scrapedCover) {
                finalCover = rawItem._scrapedCover;
            } else if (rawItem.cover_url) {
                const sep = rawItem.cover_url.includes('?') ? '&' : '?';
                finalCover = `${rawItem.cover_url}${sep}access_token=${globalToken}`;
            }

            const applyCoverUI = (coverSrc) => {
                if (!isCurrent()) return;
                if (fpCover) fpCover.src = coverSrc;
                if (miniCoverImg) miniCoverImg.src = coverSrc;
                const ambientImg = $('fp-ambient-img');
                if (ambientImg) ambientImg.src = coverSrc;
                if(window.updateMediaSession) window.updateMediaSession(targetSongName, coverSrc, window.favoriteList, window.APP_LOGO);
            };

            applyCoverUI(finalCover);

            if (finalCover === window.defaultCover) {
                window.fetchScrape(rawItem, 'cover', targetSongName).then(hdCover => {
                    if (isCurrent() && hdCover) {
                        rawItem._scrapedCover = hdCover;
                        if (listImg) listImg.src = hdCover;
                        applyCoverUI(hdCover);
                    }
                }).catch(()=>{});
            }

            if (window.LyricsEngine) window.LyricsEngine.parse(null);
            window.fetchSongLyric(rawItem, targetSongName).then(lrc => {
                if (isCurrent() && window.LyricsEngine) {
                    window.LyricsEngine.parse(lrc || null);
                }
            });

            pendingPlayback = false;
            return;
        }

        // =========================================================
        // 🌟 分叉 2：本机设备播放流
        // =========================================================
        if (window.consecutiveFailures >= 5) {
            window.showToast(`🛑 连续获取失败，已暂停`);
            const audioEl = $('audio');
            if (audioEl && !audioEl.paused) audioEl.pause();
            if(window.updatePlayButtonUI) window.updatePlayButtonUI(false);
            window.consecutiveFailures = 0;
            return;
        }

        window.highlightSongUI(index);

        const fpCover = $('fp-cover');
        const miniCoverImg = $('mini-cover-img');
        const audioEl = $('audio');
        const timeCurrentEl = $('time-current');
        const timeDurationEl = $('time-duration');
        const progressBar = $('progress-bar');

        const handleCoverError = function() {
            if (!isCurrent()) return;
            if (this.src && !this.src.includes('/api/v1/proxy') && this.src.startsWith('http') && !this.src.includes(window.location.host)) {
                const token = window.getAccessToken ? window.getAccessToken() : "";
                this.src = `/api/v1/proxy?url=${encodeURIComponent(this.src)}&access_token=${token}`;
                return;
            }

            if (this.src !== window.defaultCover) {
                this.src = window.defaultCover;
                if (!rawItem._scrapedCover) {
                    window.fetchScrape(rawItem, 'cover', targetSongName).then(hdCover => {
                        if (isCurrent() && hdCover) {
                            rawItem._scrapedCover = hdCover;
                            finalCover = hdCover;
                            applyUI();
                            const listImg = $(`list-cover-${index}`);
                            if (listImg) listImg.src = hdCover;
                        }
                    }).catch(()=>{});
                }
            }
        };

        if (fpCover) fpCover.onerror = handleCoverError;
        if (miniCoverImg) miniCoverImg.onerror = handleCoverError;

        let finalCover = window.defaultCover;
        const listImg = $(`list-cover-${index}`);
        if (listImg && listImg.src && !listImg.src.includes('undefined') && listImg.src !== window.location.href && !listImg.src.startsWith('data:image/svg+xml')) {
            finalCover = listImg.src;
        } else if (rawItem._scrapedCover) {
            finalCover = rawItem._scrapedCover;
        } else if (rawItem.cover_url) {
            const sep = rawItem.cover_url.includes('?') ? '&' : '?';
            finalCover = `${rawItem.cover_url}${sep}access_token=${globalToken}`;
        }

        let currentRenderedCover = null;

        const applyUI = () => {
            if (!isCurrent()) return;
            if (finalCover && finalCover !== currentRenderedCover) {
                if (fpCover) fpCover.src = finalCover;
                if (miniCoverImg) miniCoverImg.src = finalCover;
                const ambientImg = $('fp-ambient-img');
                if (ambientImg) ambientImg.src = finalCover;
                if(window.updateMediaSession) window.updateMediaSession(targetSongName, finalCover, window.favoriteList, window.APP_LOGO);
                currentRenderedCover = finalCover;
            }
        };

        applyUI();

        if (finalCover === window.defaultCover) {
            window.fetchScrape(rawItem, 'cover', targetSongName).then(hdCover => {
                if (isCurrent() && hdCover) {
                    finalCover = hdCover;
                    rawItem._scrapedCover = hdCover;
                    if (listImg) listImg.src = hdCover;
                    applyUI();
                }
            }).catch(()=>{});
        }

        if (window.LyricsEngine) window.LyricsEngine.parse(null);
        window.fetchSongLyric(rawItem, targetSongName).then(lrc => {
            if (isCurrent() && window.LyricsEngine) {
                window.LyricsEngine.parse(lrc || null);
                if (audioEl && !audioEl.paused) window.LyricsEngine.sync(audioEl.currentTime);
            }
        });

        const plConfig = window.getPlaylistConfig ? { ...window.getPlaylistConfig(targetPlaylist) } : {};

        const cornerFav = $('fp-corner-fav');
        if (cornerFav) {
            const isFav = window.favoriteList.includes(targetSongName);
            cornerFav.style.color = isFav ? 'var(--primary)' : 'var(--text-main)';
            cornerFav.querySelector('svg').setAttribute('fill', isFav ? 'currentColor' : 'none');
        }

        try {
            let info = null;

            if (window.preloadCache && window.preloadCache.playlist === targetPlaylist && window.preloadCache.trackKey === playbackTrackKey(rawItem) && (window.preloadCache.index === index || (window.preloadCache.isCross && index === 0))) {
                info = window.preloadCache.data;
            } else {
                const davUrl = window.getWebDavStreamUrl(rawItem);

                if (davUrl) {
                    info = { url: davUrl };
                }
                else if (rawItem._isOnlineObj && rawItem.plugin_entry_path !== 'dav') {
                    let sd = rawItem.source_data;
                    if (typeof sd === 'string') { try { sd = JSON.parse(sd); } catch(e){} }

                    const isLx = rawItem.plugin_entry_path === 'lxmusic' || (sd && sd.source);

                    if (isLx) {
                        const bestQuality = window.getBestLxQuality(sd, window.getLxQuality());
                        const urlData = await window.fetchLxMusicUrl(sd, bestQuality);

                        if (urlData && urlData.url) info = { url: urlData.url };
                        else if (urlData && urlData.data) info = { url: typeof urlData.data === 'string' ? urlData.data : urlData.data.url };
                    }
                }

                if (!info) {
                    const res = await fetch((window.API ? window.API.info : './musicinfo?id=') + rawItem.id);
                    info = await res.json();
                }
            }

            if (!isCurrent()) return;
            window.preloadCache = null;

            if (!info || !info.url) throw new Error("接口未返回有效的播放直链");

            if (info && info.url && audioEl) {
                let targetResumeTime = resumeTime > 0 ? resumeTime : 0;
                let targetSpeed = plConfig.speedLocal || 1.0;

                const prefs = typeof window.getPreferences === 'function' ? window.getPreferences() : {};
                const isAutoResumeOn = prefs.autoResume === true;

                // 🌟 读取分流修复：续播歌单拥有最高特权，无视全局记忆开关
                if (targetResumeTime === 0) {
                    if (plConfig.resumeLocal !== 'off') {
                        // 启用了续播：无论开没开自动记忆，必定去历史记录里恢复进度
                        const historyData = window.ProgressManager.getPlHistory(targetPlaylist);
                        const found = historyData.find(item => item.name === targetSongName);
                        if (found) targetResumeTime = found.time;
                    } else if (isAutoResumeOn) {
                        // 普通歌单：只有在开启了全局自动记忆时，才去恢复最后一首歌的进度
                        const lastData = window.ProgressManager.getPlLast(targetPlaylist);
                        if (lastData && lastData.name === targetSongName) {
                            targetResumeTime = lastData.time;
                        }
                    }
                }

                if (plConfig.resumeLocal === 'global') {
                    try {
                        const res = await fetch(`./sync?playlist=${encodeURIComponent(targetPlaylist)}`);
                        if (!isCurrent()) return;
                        if (res.ok) {
                            const resData = await res.json();
                            if (!isCurrent()) return;
                            if (resData && resData.data && resData.data.songName === targetSongName) {
                                targetResumeTime = resData.data.time;
                            }
                        }
                    } catch(e) { }
                }

                if (!isCurrent()) return;
                window.ProgressManager.setActive(targetPlaylist, targetSongName, 0);

                audioEl.dataset.playingPlaylist = targetPlaylist;
                audioEl.dataset.playingSongName = targetSongName;
                audioEl.dataset.hasStarted = "0";
                audioEl.dataset.playbackRequest = String(request);
                audioEl.src = info.url;
                pendingPlayback = false;

                if (window._davDirectTimeout) clearTimeout(window._davDirectTimeout);
                const isDavDirect = rawItem.plugin_entry_path === 'dav' && window.ConfigManager.get('webdav', 'settings.mode') === 'direct';

                if (isDavDirect) {
                    const targetIdx = index;
                    window._davDirectTimeout = deferPlayback(request, () => {
                        if (isCurrent() && audioEl.readyState === 0) {
                            audioEl.src = '';
                            window.showToast("⚠️ 直连节点无响应，自动跳过...");

                            window.consecutiveFailures++;
                            window.markSongAsDead(targetPlaylist, targetIdx);
                            if (window.updatePlayButtonUI) window.updatePlayButtonUI(false);

                            if (window.consecutiveFailures >= 5) {
                                window.showToast(`🛑 连续 5 首失效，已暂停播放`);
                                window.consecutiveFailures = 0;
                            } else {
                                if (typeof window.playNextSong === 'function') window.playNextSong(true);
                            }
                        }
                    }, 8000);
                }

                audioEl.defaultPlaybackRate = targetSpeed;
                audioEl.playbackRate = targetSpeed;
                if (typeof window.updateFpSpeedUI === 'function') window.updateFpSpeedUI(targetSpeed);

                window.updateNpTitleUI(targetSongName, true, true);

                const restoreProgress = () => {
                    if (!isCurrent()) return;

                    const prefs = typeof window.getPreferences === 'function' ? window.getPreferences() : {};
                    const isAutoResumeOn = prefs.autoResume === true;
                    const shouldRemember = isAutoResumeOn || plConfig.resumeLocal === 'local' || plConfig.resumeLocal === 'global';

                    if (!sessionRestore && !shouldRemember) {
                        targetResumeTime = 0;
                    }

                    if (audioEl.duration && Number.isFinite(Number(targetResumeTime)) && targetResumeTime > 0 && targetResumeTime < audioEl.duration) {
                        audioEl.currentTime = targetResumeTime;
                        if(timeCurrentEl) timeCurrentEl.innerText = window.formatTime(targetResumeTime);
                        if(timeDurationEl) timeDurationEl.innerText = window.formatTime(audioEl.duration);
                        if(progressBar) progressBar.style.width = (targetResumeTime / audioEl.duration * 100) + '%';
                        if(window.LyricsEngine) window.LyricsEngine.sync(targetResumeTime);
                    }
                    audioEl.removeEventListener('loadedmetadata', restoreProgress);
                };

                metadataCleanup = () => audioEl.removeEventListener('loadedmetadata', restoreProgress);
                if (audioEl.readyState >= 1) restoreProgress();
                else audioEl.addEventListener('loadedmetadata', restoreProgress);

                if (!autoPlay) {
                    if(window.updatePlayButtonUI) window.updatePlayButtonUI(false);
                } else {
                    const playPromise = audioEl.play();
                    if (playPromise !== undefined) playPromise.catch(error => {});
                }
            }
        } catch (err) {
            if (!isCurrent()) return;
            pendingPlayback = false;
            if (window._davDirectTimeout) clearTimeout(window._davDirectTimeout);
            window.showToast("⚠️ 获取链接失败，自动跳过...");

            if (index !== -1) {
                window.consecutiveFailures++;
                window.markSongAsDead(targetPlaylist, index);
            }

            if(window.updatePlayButtonUI) window.updatePlayButtonUI(false);

            if (window.consecutiveFailures >= 5) {
                window.showToast(`🛑 连续 5 首歌曲无法播放，已暂停。`);
                window.consecutiveFailures = 0;
            } else {
                deferPlayback(request, () => {
                    if (typeof window.playNextSong === 'function') {
                        window.playNextSong(true);
                    }
                }, 1000);
            }
        }
    };

    window.scoutNextSong = async function(targetIndex, depth = 0) {
        if (depth >= 5 || targetIndex === window.currentIndex || !window.songList || window.songList.length === 0) return;
        const request = playbackRequest;
        const scoutPlaylist = window.currentPlaylist;
        const scoutList = window.songList;
        const validScout = () => request === playbackRequest && scoutPlaylist === window.currentPlaylist && scoutList === window.songList;
        window.isScouting = true;

        const rawItem = window.restoreOnlineIdentity(window.songList[targetIndex]);
        try {
            let targetAudioUrl = null;
            let fetchedData = null;

            const davUrl = window.getWebDavStreamUrl(rawItem);

            if (davUrl) {
                targetAudioUrl = davUrl;
                fetchedData = { url: targetAudioUrl };
            }
            else if (rawItem._isOnlineObj && rawItem.plugin_entry_path !== 'dav') {
                let sd = rawItem.source_data;
                if (typeof sd === 'string') { try { sd = JSON.parse(sd); } catch(e){} }

                const isLx = rawItem.plugin_entry_path === 'lxmusic' || (sd && sd.source);

                if (isLx) {
                    const bestQuality = window.getBestLxQuality(sd, window.getLxQuality());
                    const urlData = await window.fetchLxMusicUrl(sd, bestQuality);

                    if (urlData && urlData.url) {
                        targetAudioUrl = urlData.url;
                        fetchedData = urlData;
                    } else if (urlData && urlData.data) {
                        targetAudioUrl = typeof urlData.data === 'string' ? urlData.data : urlData.data.url;
                        fetchedData = typeof urlData.data === 'string' ? { url: urlData.data } : urlData.data;
                    }
                }
            }

            if (!targetAudioUrl) {
                const res = await fetch((window.API ? window.API.info : './musicinfo?id=') + rawItem.id);
                fetchedData = await res.json();
                if (fetchedData && fetchedData.url) {
                    targetAudioUrl = fetchedData.url;
                }
            }

            if (!validScout()) return;
            if (targetAudioUrl) {
                window.preloadCache = { playlist: scoutPlaylist, trackKey: playbackTrackKey(rawItem), index: targetIndex, url: targetAudioUrl, data: fetchedData };
            } else {
                throw new Error("解析出的音频直链为空");
            }
        } catch (e) {
            if (!validScout()) return;
            window.markSongAsDead(window.currentPlaylist, targetIndex);
            let nextNextIdx = (window.playMode === 2 && window.songList.length > 1) ?
                Math.floor(Math.random() * window.songList.length) :
                (targetIndex + 1 >= window.songList.length ? 0 : targetIndex + 1);
            await window.scoutNextSong(nextNextIdx, depth + 1);
        }
        if (request === playbackRequest) window.isScouting = false;
    };

    window.scoutCrossPlaylistSong = async function(playlistName, rawItem) {
        if (!rawItem || window.isScouting) return;
        const request = playbackRequest;
        window.isScouting = true;

        rawItem = window.restoreOnlineIdentity(rawItem);
        try {
            let targetAudioUrl = null;
            let fetchedData = null;

            const davUrl = window.getWebDavStreamUrl(rawItem);

            if (davUrl) {
                targetAudioUrl = davUrl;
                fetchedData = { url: targetAudioUrl };
            }
            else if (rawItem._isOnlineObj && rawItem.plugin_entry_path !== 'dav') {
                let sd = rawItem.source_data;
                if (typeof sd === 'string') { try { sd = JSON.parse(sd); } catch(e){} }

                const isLx = rawItem.plugin_entry_path === 'lxmusic' || (sd && sd.source);
                if (isLx) {
                    const bestQuality = window.getBestLxQuality(sd, window.getLxQuality());
                    const urlData = await window.fetchLxMusicUrl(sd, bestQuality);

                    if (urlData && urlData.url) {
                        targetAudioUrl = urlData.url;
                        fetchedData = urlData;
                    } else if (urlData && urlData.data) {
                        targetAudioUrl = typeof urlData.data === 'string' ? urlData.data : urlData.data.url;
                        fetchedData = typeof urlData.data === 'string' ? { url: urlData.data } : urlData.data;
                    }
                }
            }

            if (!targetAudioUrl) {
                const res = await fetch((window.API ? window.API.info : './musicinfo?id=') + rawItem.id);
                fetchedData = await res.json();
                if (fetchedData && fetchedData.url) {
                    targetAudioUrl = fetchedData.url;
                }
            }

            if (request !== playbackRequest) return;
            if (targetAudioUrl) {
                window.preloadCache = { trackKey: playbackTrackKey(rawItem), isCross: true, playlist: playlistName, data: fetchedData, url: targetAudioUrl };
            }
        } catch (e) {}
        if (request === playbackRequest) window.isScouting = false;
    };

    // =========================================================================
    // 🌟 核心引擎重构：音频事件与控件绑定中枢
    // =========================================================================
    window.updateFpSpeedUI = function(speed, isFromUser = false) {
        if (window._speedSyncingLock && !isFromUser) return;

        const fpCornerSpeed = document.getElementById('fp-corner-speed');
        const fpSpeedSlider = document.getElementById('fp-speed-slider');
        const audioEl = document.getElementById('audio');

        if (fpCornerSpeed) fpCornerSpeed.textContent = window.formatSpeed(speed);
        if (fpSpeedSlider) fpSpeedSlider.value = speed;
        if (audioEl) audioEl.playbackRate = speed;
    };

    let cloudSyncTimer = null;
    let lastCloudSyncTime = 0;
    window.syncToCloud = function(playlist, songName, time, speed, force = false) {
        if (!playlist || !songName) return;
        const conf = window.getPlaylistConfig(playlist);
        if (conf.resumeLocal !== 'global') return;

        const now = Date.now();
        if (!force && now - lastCloudSyncTime < 10000) {
            if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
            cloudSyncTimer = setTimeout(() => window.syncToCloud(playlist, songName, time, speed, true), 10000 - (now - lastCloudSyncTime));
            return;
        }

        if (cloudSyncTimer) { clearTimeout(cloudSyncTimer); cloudSyncTimer = null; }
        lastCloudSyncTime = now;

        fetch('./sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playlist, songName, time })
        }).catch(()=>{});
    };

    window.bindPlayerEvents = function() {
        // 🌟 动态注入 CSS 护盾：高亮的歌曲强制隐藏时钟（完全不破坏原有 DOM，干净利落）
        if (!document.getElementById('dynamic-playing-style')) {
            const style = document.createElement('style');
            style.id = 'dynamic-playing-style';
            style.innerHTML = `body.is-audio-playing .song-item.playing [id^="time-wrap-"] > *:not(.song-dead-tag) { display: none !important; }`;
            document.head.appendChild(style);
        }

        // 🌟 终极绝杀：直接劫持底层的读取引擎！
        // 保证读取时就切断普通歌单的旧数据，永不闪烁。
        if (window.ProgressManager && !window.ProgressManager._isPatched) {
            const originalGetPlHistory = window.ProgressManager.getPlHistory;
            window.ProgressManager.getPlHistory = function(playlistName) {
                const rawHistory = originalGetPlHistory.call(this, playlistName) || [];
                const conf = window.getPlaylistConfig(playlistName);

                // 1. 如果启用了续播功能的歌单，要排除掉（原样返回所有）
                if (conf.resumeLocal !== 'off') return rawHistory;

                // 2. 禁用自动记忆时：直接返回空，底层就不会渲染任何时钟
                const prefs = typeof window.getPreferences === 'function' ? window.getPreferences() : {};
                if (prefs.autoResume !== true) return [];

                // 3. 开启了自动记忆的普通歌单，只记录/返回当前（最后播放）的那一首！
                const lastData = window.ProgressManager.getPlLast(playlistName);
                if (lastData && lastData.name) {
                    const filtered = rawHistory.filter(item => item.name === lastData.name);
                    return filtered.length > 0 ? filtered : [{ name: lastData.name, time: lastData.time }];
                }
                return [];
            };
            window.ProgressManager._isPatched = true;
        }

        const audioEl = document.getElementById('audio');
        const btnPlay = document.getElementById('btn-play');
        const btnPrev = document.getElementById('btn-prev');
        const btnNext = document.getElementById('btn-next');
        const btnMode = document.getElementById('btn-mode');
        const btnVolume = document.getElementById('btn-volume');
        const volumeSlider = document.getElementById('volume-slider');
        const volumeText = document.getElementById('volume-text');
        const volumePopup = document.getElementById('volume-popup');
        const modePopup = document.getElementById('mode-popup');
        const progressContainer = document.getElementById('progress-container');
        const progressBg = document.getElementById('progress-bg');
        const progressBar = document.getElementById('progress-bar');
        const timeCurrentEl = document.getElementById('time-current');
        const timeDurationEl = document.getElementById('time-duration');
        window.isDragging = false;

        // 1. 音频核心事件监听
        audioEl.addEventListener('play', () => {
          if (!currentMedia(audioEl)) return;
          window.updatePlayButtonUI(true);

          // 🌟 特权 1：只有普通歌单才打隐身标记，续播歌单正常显示时钟！
          const conf = window.getPlaylistConfig(window.currentPlaylist);
          if (conf.resumeLocal === 'off') {
              document.body.classList.add('is-audio-playing');
          }
          if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
          window.setupMediaSession(audioEl, btnPrev, btnNext);
        });

        audioEl.addEventListener('playing', () => { if (!currentMedia(audioEl)) return; audioEl.dataset.hasStarted = "1"; window.consecutiveFailures = 0; if ('mediaSession' in navigator) window.setupMediaSession(audioEl, btnPrev, btnNext); });

        audioEl.addEventListener('pause', () => {
          if (!currentMedia(audioEl)) return;
          window.updatePlayButtonUI(false);
          document.body.classList.remove('is-audio-playing');
          if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
          if (audioEl.src && !audioEl.ended && window.currentSongName) {
              const actualPlayingPl = audioEl.dataset.playingPlaylist || window.currentPlaylist;
              const actualPlayingSong = audioEl.dataset.playingSongName || window.currentSongName;
              window.syncToCloud(actualPlayingPl, actualPlayingSong, audioEl.currentTime, audioEl.playbackRate, true);
          }
        });

        audioEl.addEventListener('error', () => {
          if (!currentMedia(audioEl)) return;
          document.body.classList.remove('is-audio-playing');
          if (window._davDirectTimeout) clearTimeout(window._davDirectTimeout);
          if (audioEl.src && audioEl.src !== window.location.href) {
            if (audioEl.dataset.hasStarted === "1") { window.updatePlayButtonUI(false); return; }
            window.showToast("⚠️ 歌曲链接拒绝访问，自动跳过...");
            if (window.currentIndex !== -1) { window.consecutiveFailures++; window.markSongAsDead(window.currentPlaylist, window.currentIndex); }
            window.updatePlayButtonUI(false);
            if (window.consecutiveFailures >= 5) { window.showToast(`🛑 连续 5 首歌曲无法播放，已暂停。`); window.consecutiveFailures = 0; }
            else { deferPlayback(playbackRequest, () => { playNextSong(true); }, 1000); }
          }
        });

        // 2. 跨歌单智能顺播引擎
        function getCrossPlaylistInfo(offset = 1) {
            if (window.isWebDAVMode && window.currentPlaylist === '在线资源' && window.currentOnlineView === 'detail') {
                const oState = window.StateManager.getState();
                const curFolder = oState.detail_name;
                if (window.webdavData && window.webdavData.library) {
                    const folders = Object.keys(window.webdavData.library);
                    const curIdx = folders.indexOf(curFolder);
                    if (curIdx !== -1 && folders.length > 0) {
                        const nextFolder = folders[(curIdx + offset + folders.length) % folders.length];
                        return { type: 'webdav', name: nextFolder, songs: window.webdavData.library[nextFolder] || [] };
                    }
                }
            } else {
                let opts = Array.from(document.querySelectorAll('#playlist-opts .select-option')).map(el => el.dataset.key).filter(k => k !== '曲库搜索');
                if (opts.length > 0) {
                    let curIdx = opts.indexOf(window.currentPlaylist);
                    let nextName = opts[(curIdx + offset + opts.length) % opts.length];
                    return { type: 'local', name: nextName, songs: window.allPlaylists[nextName] || [] };
                }
            }
            return null;
        }

        function jumpToCrossPlaylist(plInfo, playIndex = 0) {
            if (!plInfo || plInfo.songs.length === 0) return;
            window.isPageBtnPause = true;
            if (plInfo.type === 'webdav') { window.renderWebDavFolder(plInfo.name, plInfo.songs, false, true); }
            else { window.switchPlaylistSilently(plInfo.name); }
            window.playSong(playIndex);
            setTimeout(() => { window.isPageBtnPause = false; }, 500);
        }

        // 3. 时间与进度更新
        audioEl.addEventListener('timeupdate', () => {
          if (!currentMedia(audioEl)) return;
          if (!audioEl.duration || window.isDragging) return;
          const current = audioEl.currentTime;
          const duration = audioEl.duration;

          const currentItem = window.songList[window.currentIndex];
          const isDavDirect = currentItem && currentItem.plugin_entry_path === 'dav' && window.ConfigManager.get('webdav', 'settings.mode') === 'direct';

          if (isDavDirect && audioEl.buffered.length > 0) {
              const bufferEnd = audioEl.buffered.end(audioEl.buffered.length - 1);
              if (bufferEnd - current < 0.2 && current < duration - 1) {
                  if (!window._stalledRecoveryTimeout) {
                      window._stalledRecoveryTimeout = deferPlayback(playbackRequest, () => {
                          const resumeTime = audioEl.currentTime;
                          audioEl.load();
                          audioEl.currentTime = resumeTime;
                          audioEl.play().catch(()=>{});
                          window._stalledRecoveryTimeout = null;
                      }, 500);
                  }
              } else {
                  if (window._stalledRecoveryTimeout) { clearTimeout(window._stalledRecoveryTimeout); window._stalledRecoveryTimeout = null; }
              }
          }

          if (Math.floor(current) % 2 === 0 && Math.floor(current) !== window._lastSavedTime) {
              window._lastSavedTime = Math.floor(current);

              const actualPlayingPl = audioEl.dataset.playingPlaylist || window.currentPlaylist;
              const actualPlayingSong = audioEl.dataset.playingSongName || window.currentSongName;

              // 🌟 极简：直接写入当前时间，底层无多余操作
              window.ProgressManager.setActive(actualPlayingPl, actualPlayingSong, current);
              window.ProgressManager.setPlLast(actualPlayingPl, actualPlayingSong, current);

              const conf = window.getPlaylistConfig(actualPlayingPl);

              // 统一写入 History，不用担心污染，因为劫持器会自动过滤垃圾数据
              window.ProgressManager.setPlHistory(actualPlayingPl, actualPlayingSong, current);
              if (conf.resumeLocal === 'global') {
                  window.syncToCloud(actualPlayingPl, actualPlayingSong, current, audioEl.playbackRate, false);
              }

              // 🌟 特权 2：如果是续播歌单，每2秒动态更新右侧的时钟和时间！
              if (conf.resumeLocal !== 'off' && actualPlayingPl === window.currentPlaylist) {
                  const timeWrap = document.getElementById(`time-wrap-${window.currentIndex}`);
                  if (timeWrap) {
                      const newTimeStr = window.formatTime(current);
                      // 1. 如果有旧时间，正则替换数字，绝不破坏原有 DOM 结构
                      if (/\d{2,}:\d{2}/.test(timeWrap.innerHTML)) {
                          timeWrap.innerHTML = timeWrap.innerHTML.replace(/\d{2,}:\d{2}/, newTimeStr);
                      }
                      // 2. 如果是刚播放的新歌（节点为空），直接注入 100% 原生代码！
                      else if (timeWrap.innerHTML.trim() === '') {
                          const isGlobal = conf.resumeLocal === 'global';
                          const rawSvg = isGlobal ? (window.SVG_ICONS?.cloud_clock || '') : (window.SVG_ICONS?.stopwatch || '');

                          // 🌟 终极修复：直接复制 playlist.js 里的原生样式！
                          timeWrap.innerHTML = `<div style="display: flex; align-items: center; font-size: 11px; color: var(--primary); font-variant-numeric: tabular-nums; margin-left: 8px; flex-shrink: 0; font-weight: 500;">${rawSvg}${newTimeStr}</div>`;
                      }
                  }
              }
          }

          progressBar.style.width = (current / duration * 100) + '%';
          timeCurrentEl.innerText = window.formatTime(current);
          timeDurationEl.innerText = window.formatTime(duration);
          if(window.LyricsEngine) window.LyricsEngine.sync(current);

          if (duration - current <= 20 && !window.preloadCache && !window.isScouting && window.playMode !== 3) {
              let nextScoutIdx = window.currentIndex + 1;
              if (window.playMode === 2 && window.songList.length > 1) {
                  do { nextScoutIdx = Math.floor(Math.random() * window.songList.length); } while (nextScoutIdx === window.currentIndex);
                  if (nextScoutIdx >= 0 && nextScoutIdx < window.songList.length) window.scoutNextSong(nextScoutIdx);
              } else if (window.playMode === 0 && nextScoutIdx >= window.songList.length) {
                  const nextPl = getCrossPlaylistInfo(1);
                  if (nextPl && nextPl.songs.length > 0) window.scoutCrossPlaylistSong(nextPl.name, nextPl.songs[0]);
              } else {
                  if (nextScoutIdx >= window.songList.length) nextScoutIdx = 0;
                  if (nextScoutIdx >= 0 && nextScoutIdx < window.songList.length && nextScoutIdx !== window.currentIndex) window.scoutNextSong(nextScoutIdx);
              }
          }
        });

        // 4. 底部主控按钮
        btnPlay.addEventListener('click', () => {
          if (window.MiotManager && window.MiotManager.currentDevice.type === 'miot') {
              window.MiotManager.togglePlay();
              return;
          }

          if (!window._hasManuallyPlayed && window.currentIndex !== -1 && audioEl.paused) {
              window._hasManuallyPlayed = true;
              window.updatePlayButtonUI(true);
              window.playSong(window.currentIndex, true, audioEl.currentTime);
              return;
          }

          window._hasManuallyPlayed = true;
          if (audioEl.src && audioEl.src !== window.location.href) {
              if (audioEl.paused) {
                  window.updatePlayButtonUI(true);
                  audioEl.play();
              } else {
                  window.isPageBtnPause = true;
                  window.updatePlayButtonUI(false);
                  audioEl.pause();
                  setTimeout(() => { window.isPageBtnPause = false; }, 200);
              }
              return;
          }
          if (window.songList.length === 0) return;
          if (window.currentIndex === -1) { window.playSong(0); return; }
        });

        document.addEventListener('click', (e) => { if (modePopup && !modePopup.contains(e.target) && !e.target.closest('#btn-mode')) modePopup.classList.remove('show'); });
        btnMode.addEventListener('click', (e) => { e.stopPropagation(); modePopup.classList.toggle('show'); });
        modePopup.querySelectorAll('.mode-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                window.playMode = parseInt(item.dataset.mode);
                window.updatePlayModeUI();

                localStorage.setItem('iwebplayer.local_play_mode', window.playMode);

                if (!window.MiotManager || window.MiotManager.currentDevice.type !== 'miot') {
                    window.ConfigManager.set('config', 'player_state.playMode', window.playMode);
                }
                modePopup.classList.remove('show');
                if (window.MiotManager && window.MiotManager.currentDevice.type === 'miot') window.MiotManager.setPlayMode(window.playMode);
            });
        });

        function playNextSong(isAutoEnd = false) {
            if (window.songList.length === 0) return;
            if (isAutoEnd && window.playMode === 3) { audioEl.currentTime = 0; audioEl.play(); return; }
            if (window.preloadCache && !window.preloadCache.isCross && window.preloadCache.index !== undefined && window.preloadCache.index !== window.currentIndex) { window.playSong(window.preloadCache.index); return; }
            if (window.playMode === 2 && window.songList.length > 1) {
                let nextIdx; do { nextIdx = Math.floor(Math.random() * window.songList.length); } while (nextIdx === window.currentIndex);
                window.playSong(nextIdx); return;
            }
            let nextIdx = window.currentIndex + 1;
            if (window.playMode === 0 && nextIdx >= window.songList.length) {
                const nextPl = getCrossPlaylistInfo(1);
                if (nextPl) { jumpToCrossPlaylist(nextPl, 0); return; }
                else nextIdx = 0;
            }
            if (nextIdx >= window.songList.length) nextIdx = 0;
            window.playSong(nextIdx);
        }

        function playPrevSong() {
            if (window.songList.length === 0) return;
            if (window.playMode === 2 && window.songList.length > 1) {
                let prevIdx; do { prevIdx = Math.floor(Math.random() * window.songList.length); } while (prevIdx === window.currentIndex);
                window.playSong(prevIdx); return;
            }
            let prevIdx = window.currentIndex - 1;
            if (window.playMode === 0 && prevIdx < 0) {
                const prevPl = getCrossPlaylistInfo(-1);
                if (prevPl) { jumpToCrossPlaylist(prevPl, prevPl.songs.length - 1); return; }
            }
            if (prevIdx < 0) prevIdx = window.songList.length - 1;
            window.playSong(prevIdx);
        }

        window.playNextSong = playNextSong;

        // 🌟 恢复原本的 ended 逻辑，不再强行清零
        audioEl.addEventListener('ended', () => {
            document.body.classList.remove('is-audio-playing');
            if (currentMedia(audioEl)) playNextSong(true);
        });

        btnNext.addEventListener('click', () => {
            if (window.preloadCache && window.playMode !== 3) {
                if (window.preloadCache.isCross && window.playMode === 0) {
                    const nextPl = getCrossPlaylistInfo(1);
                    if (nextPl && window.preloadCache.playlist === nextPl.name) {
                        jumpToCrossPlaylist(nextPl, 0);
                        return;
                    }
                } else if (window.preloadCache.index !== window.currentIndex) { window.playSong(window.preloadCache.index); return; }
            }
            playNextSong(false);
        });
        btnPrev.addEventListener('click', playPrevSong);

        // 5. 音量控制
        btnVolume.addEventListener('click', (e) => {
            e.stopPropagation();
            const isMiot = window.MiotManager && window.MiotManager.currentDevice.type === 'miot';
            if (window.isIOS && !isMiot) { window.showToast("iPhone不支持调节本机音量"); return; }
            volumePopup.classList.toggle('show');
        });

        let _volSyncTimeout = null;
        volumeSlider.addEventListener('input', (e) => {
            const vol = e.target.value;
            volumeText.innerText = vol + '%';
            window.updateVolumeIcon(vol);
            if (!window.MiotManager || window.MiotManager.currentDevice.type !== 'miot') {
                window.ConfigManager.set('config', 'player_state.volume', parseInt(vol));
                audioEl.volume = vol / 100;
            }
            if (window.MiotManager && window.MiotManager.currentDevice.type === 'miot') {
                if (_volSyncTimeout) clearTimeout(_volSyncTimeout);
                _volSyncTimeout = setTimeout(() => { window.MiotManager.setVolume(vol); }, 300);
            }
        });

        volumeSlider.addEventListener('change', (e) => {
            if (window.MiotManager && window.MiotManager.currentDevice.type === 'miot') window.MiotManager.setVolume(e.target.value);
        });

        const adjustVolumeBy = (delta) => {
            let currentVol = parseInt(volumeSlider.value) || 0;
            let newVol = currentVol + delta;
            if (newVol > 100) newVol = 100; if (newVol < 0) newVol = 0;
            volumeSlider.value = newVol;
            volumeSlider.dispatchEvent(new Event('input'));
            volumeSlider.dispatchEvent(new Event('change'));
        };
        document.getElementById('vol-plus')?.addEventListener('click', (e) => { e.stopPropagation(); adjustVolumeBy(5); });
        document.getElementById('vol-minus')?.addEventListener('click', (e) => { e.stopPropagation(); adjustVolumeBy(-5); });

        // 6. 进度条拖拽
        function getPercentage(e) {
          const rect = progressBg.getBoundingClientRect();
          let clientX = e.clientX;
          if (e.touches && e.touches.length > 0) clientX = e.touches[0].clientX; else if (e.changedTouches && e.changedTouches.length > 0) clientX = e.changedTouches[0].clientX;
          return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        }

        function getActiveDuration() {
            return (window.MiotManager && window.MiotManager.currentDevice.type === 'miot') ? window.MiotManager.lastWsDuration : audioEl.duration;
        }

        function handleDragStart(e) {
            const duration = getActiveDuration();
            if (!duration) return;
            window.isDragging = true;
            progressBar.style.width = (getPercentage(e) * 100) + '%';
        }
        function handleDragMove(e) {
            const duration = getActiveDuration();
            if (!window.isDragging || !duration) return;
            e.preventDefault();
            const p = getPercentage(e);
            progressBar.style.width = (p * 100) + '%';
            timeCurrentEl.innerText = window.formatTime(p * duration);
            timeDurationEl.innerText = window.formatTime(duration);
        }
        function handleDragEnd(e) {
            const duration = getActiveDuration();
            if (!window.isDragging || !duration) return;
            window.isDragging = false;
            const targetTime = getPercentage(e) * duration;

            if (window.MiotManager && window.MiotManager.currentDevice.type === 'miot') {
                window.MiotManager.seekTo(targetTime);
            } else {
                audioEl.currentTime = targetTime;
            }
        }

        progressContainer.addEventListener('mousedown', handleDragStart);
        document.addEventListener('mousemove', handleDragMove);
        document.addEventListener('mouseup', handleDragEnd);
        progressContainer.addEventListener('touchstart', handleDragStart, { passive: false });
        document.addEventListener('touchmove', handleDragMove, { passive: false });
        document.addEventListener('touchend', handleDragEnd);
    };

})(window);