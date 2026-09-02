// static/player.js
(function(window) {
    'use strict';

    // 内部微型 DOM 获取器
    const $ = (id) => document.getElementById(id);

    // 🌟 终极融合：全局统一的歌词获取中枢 (三级瀑布流)
    window.fetchSongLyric = async function(rawItem, targetSongName) {
        let finalLrc = null;
        try {
            // 1. SongLoft 官方数据库 (最高优先级，含网盘和被入库的在线歌)
            if (rawItem && rawItem.id) {
                try {
                    const slRes = await fetch(`/api/v1/songs/${rawItem.id}/lyric`);
                    if (slRes.ok) {
                        const slData = await slRes.json();
                        if (slData && slData.lyric) {
                            console.log(`[歌词] 命中 SongLoft 官方数据库`);
                            return slData.lyric;
                        }
                    }
                } catch(e) {}
            }

            // 2. LXMusic 原生接口 (仅在线歌曲)
            if (rawItem && rawItem._isOnlineObj && rawItem.plugin_entry_path !== 'dav') {
                let sd = rawItem.source_data;
                if (typeof sd === 'string') { try { sd = JSON.parse(sd); } catch(e){} }
                const engineValEl = document.getElementById('engine-val');
                const currentEngine = engineValEl ? engineValEl.dataset.value : 'LXMusic';
                if (currentEngine === 'LXMusic') {
                    try {
                        const lrcUrl = `/api/v1/jsplugin/lxmusic/api/direct/lyric?source=${sd.source}&songmid=${sd.songmid || sd.musicId}&musicId=${sd.musicId}&duration=${sd.duration}`;
                        const lrcRes = await fetch(lrcUrl);
                        const lrcData = await lrcRes.json();
                        if (lrcData.code === 0 && lrcData.data && lrcData.data.lyric) {
                            console.log(`[歌词] 命中 LXMusic 插件原生接口`);
                            return lrcData.data.lyric;
                        }
                    } catch(e) {}
                }
            }

            // 3. iWebPlayer 自研刮削兜底
            finalLrc = await window.fetchScrape(rawItem, 'lyric', targetSongName);
            if (finalLrc) {
                console.log(`[歌词] 命中 iWebPlayer 自定义刮削`);
                return finalLrc;
            }

            console.log(`[歌词] 最终未找到任何歌词`);
        } catch(e) {
            console.error("统一歌词获取流水线崩溃:", e);
        }
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

        let favSvg = '';
        if (checkFav && window.favoriteList && window.favoriteList.includes(text)) {
            favSvg = `<svg style="flex-shrink: 0; margin-left: 4px;" viewBox="0 0 24 24" width="18" height="18" fill="var(--primary)" color="var(--primary)"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`;
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

            if (rawItem && rawItem.file_path) {
                const match = String(rawItem.file_path).match(/\.([a-zA-Z0-9]+)$/);
                if (match) {
                    let ext = match[1].toUpperCase();
                    if (validExts.includes(ext)) {
                        extension = ext;
                        isVisible = true;
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
              ${extHtml}${favSvg}
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

        const isOpen = forceState !== undefined ? forceState : !fullPlayer.classList.contains('open');
        if (isOpen) {
            fullPlayer.classList.add('open');
            document.body.classList.add('player-open');
            if (window.isIOS || window.innerWidth < 600) document.body.style.overflow = 'hidden';
        } else {
            fullPlayer.classList.remove('open');
            document.body.classList.remove('player-open');
            document.body.style.overflow = '';
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

        window.showToast("⏳ 正在同步...");
        try {
            if (isFav) {
                await fetch(`/api/v1/playlists/${plId}/songs/${rawSong.id}`, { method: 'DELETE' });
            } else {
                await fetch(`/api/v1/playlists/${plId}/songs`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ song_ids: [rawSong.id] })
                });
            }

            if (window.reloadGlobalData) await window.reloadGlobalData();

            const currentlyFav = window.favoriteList.includes(songName);
            const favIcon = $(`fav-${index}`);
            if (favIcon) favIcon.style.display = currentlyFav ? 'block' : 'none';

            if (currentlyFav) window.showToast(`❤️ 已收藏: ${songName}`);
            else window.showToast(`💔 已取消收藏: ${songName}`);

            if (songName === window.currentSongName) {
                window.updateNpTitleUI(window.currentSongName);
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
            let sd = rawItem.source_data;
            if (typeof sd === 'string') { try { sd = JSON.parse(sd); } catch(e){} }

            const serverName = sd.configName || (window.webdavData ? window.webdavData.currentServer : '');

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
                    const globalToken = window.getAccessToken ? window.getAccessToken() : "";
                    return `/api/v1/proxy?url=${encodeURIComponent(finalUrl)}&access_token=${globalToken}`;
                } catch(e) {}
            }
        }
        return null;
    };

    // =========================================================================
    // 🌟 核心引擎重构：播放请求流转
    // =========================================================================
    window.playSong = async function(index, autoPlay = true, resumeTime = 0) {
        if (window._davDirectTimeout) clearTimeout(window._davDirectTimeout);
        if (index < 0 || index >= window.songList.length) return;

        const rawItem = window.songList[index];
        const targetSongName = window.getSongNameObj(rawItem);
        const globalToken = window.getAccessToken ? window.getAccessToken() : "";

        // =========================================================
        // 🌟 分叉 1：小爱音箱播放流
        // =========================================================
        if (window.MiotManager && window.MiotManager.currentDevice.type === 'miot') {
            const audioEl = $('audio');
            if (audioEl && !audioEl.paused) audioEl.pause();

            const pl = window.playlistMeta ? window.playlistMeta.find(p => p.name === window.currentPlaylist) : null;
            let targetPlId = pl ? pl.id : null;

            if (!targetPlId) {
                if (window.showToast) window.showToast("⏳ 正在将列表打包推送到音箱...", true);
                targetPlId = await window.MiotManager.syncListToPushPlaylist(window.songList);
                if (!targetPlId) {
                    if (window.showToast) window.showToast("❌ 打包推送失败，请重试");
                    return;
                }
            }

            window.highlightSongUI(index);
            window.updateNpTitleUI(window.currentSongName, true, false);

            if (autoPlay) {
                window.MiotManager.playPlaylist(targetPlId, index);
            }

            const fpCover = $('fp-cover');
            const miniCoverImg = $('mini-cover-img');

            const handleCoverError = function() {
                if (this.src !== window.defaultCover) {
                    this.src = window.defaultCover;
                    if (!rawItem._scrapedCover) {
                        window.fetchScrape(rawItem, 'cover', window.currentSongName).then(hdCover => {
                            if (hdCover && window.currentSongName === window.getSongNameObj(rawItem)) {
                                rawItem._scrapedCover = hdCover;
                                if (fpCover) fpCover.src = hdCover;
                                if (miniCoverImg) miniCoverImg.src = hdCover;
                                const listImg = $('list-cover-' + index);
                                if (listImg) listImg.src = hdCover;
                                if(window.updateMediaSession) window.updateMediaSession(window.currentSongName, hdCover, window.favoriteList, window.APP_LOGO);
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
                if (fpCover) fpCover.src = coverSrc;
                if (miniCoverImg) miniCoverImg.src = coverSrc;
                const ambientImg = $('fp-ambient-img');
                if (ambientImg) ambientImg.src = coverSrc;
                if(window.updateMediaSession) window.updateMediaSession(window.currentSongName, coverSrc, window.favoriteList, window.APP_LOGO);
            };

            applyCoverUI(finalCover);

            if (finalCover === window.defaultCover) {
                window.fetchScrape(rawItem, 'cover', window.currentSongName).then(hdCover => {
                    if (window.currentSongName === window.getSongNameObj(rawItem) && hdCover) {
                        rawItem._scrapedCover = hdCover;
                        if (listImg) listImg.src = hdCover;
                        applyCoverUI(hdCover);
                    }
                }).catch(()=>{});
            }

            // 🌟 触发统一歌词获取
            if (window.LyricsEngine) window.LyricsEngine.parse(null);
            window.fetchSongLyric(rawItem, targetSongName).then(lrc => {
                if (targetSongName === window.currentSongName && window.LyricsEngine) {
                    window.LyricsEngine.parse(lrc || null);
                }
            });

            return; // 彻底阻断本机 <audio>！
        }
        // =========================================================

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
            if (this.src !== window.defaultCover) {
                this.src = window.defaultCover;
                if (!rawItem._scrapedCover) {
                    window.fetchScrape(rawItem, 'cover', targetSongName).then(hdCover => {
                        if (targetSongName === window.currentSongName && hdCover) {
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
            if (targetSongName !== window.currentSongName) return;
            if (finalCover && finalCover !== currentRenderedCover) {
                if (fpCover) fpCover.src = finalCover;
                if (miniCoverImg) miniCoverImg.src = finalCover;
                const ambientImg = $('fp-ambient-img');
                if (ambientImg) ambientImg.src = finalCover;
                if(window.updateMediaSession) window.updateMediaSession(window.currentSongName, finalCover, window.favoriteList, window.APP_LOGO);
                currentRenderedCover = finalCover;
            }
        };

        applyUI();

        if (finalCover === window.defaultCover) {
            window.fetchScrape(rawItem, 'cover', targetSongName).then(hdCover => {
                if (targetSongName === window.currentSongName && hdCover) {
                    finalCover = hdCover;
                    rawItem._scrapedCover = hdCover;
                    if (listImg) listImg.src = hdCover;
                    applyUI();
                }
            }).catch(()=>{});
        }

        // 🌟 触发统一歌词获取 (纯异步并轨，不阻塞下面的音频流提取)
        if (window.LyricsEngine) window.LyricsEngine.parse(null);
        window.fetchSongLyric(rawItem, targetSongName).then(lrc => {
            if (targetSongName === window.currentSongName && window.LyricsEngine) {
                window.LyricsEngine.parse(lrc || null);
                if (audioEl && !audioEl.paused) window.LyricsEngine.sync(audioEl.currentTime);
            }
        });

        const plConfig = window.getPlaylistConfig ? window.getPlaylistConfig(window.currentPlaylist) : {};
        if (typeof window.updateFpSpeedUI === 'function') window.updateFpSpeedUI(plConfig.speedLocal || 1.0);

        const cornerFav = $('fp-corner-fav');
        if (cornerFav) {
            const isFav = window.favoriteList.includes(targetSongName);
            cornerFav.style.color = isFav ? 'var(--primary)' : 'var(--text-main)';
            cornerFav.querySelector('svg').setAttribute('fill', isFav ? 'currentColor' : 'none');
        }

        try {
            let info = null;

            if (window.preloadCache && (window.preloadCache.index === index || (window.preloadCache.isCross && window.preloadCache.playlist === window.currentPlaylist && index === 0))) {
                console.log("⚡ [极速切歌] 命中音频流预读缓存！");
                info = window.preloadCache.data;
            } else {
                const davUrl = window.getWebDavStreamUrl(rawItem);

                if (davUrl) {
                    info = { url: davUrl };
                }
                else if (rawItem._isOnlineObj && rawItem.plugin_entry_path !== 'dav') {
                    let sd = rawItem.source_data;
                    if (typeof sd === 'string') { try { sd = JSON.parse(sd); } catch(e){} }
                    const engineValEl = $('engine-val');
                    const currentEngine = engineValEl ? engineValEl.dataset.value : 'LXMusic';

                    if (currentEngine === 'LXMusic') {
                        const bestQuality = window.getBestLxQuality(sd, window.getLxQuality());
                        const urlData = await window.fetchLxMusicUrl(sd, bestQuality);

                        if (urlData && urlData.url) info = { url: urlData.url };
                        else if (urlData && urlData.data) info = { url: typeof urlData.data === 'string' ? urlData.data : urlData.data.url };
                    }
                }
                else {
                    const res = await fetch((window.API ? window.API.info : './musicinfo?id=') + rawItem.id);
                    info = await res.json();
                }
            }

            window.preloadCache = null;

            if (!info || !info.url) throw new Error("接口未返回有效的播放直链");

            if (info && info.url && audioEl) {
                // 🌟 更新当前全局活动现场 (代替旧的 local_state)
                window.ProgressManager.setActive(window.currentPlaylist, window.currentSongName, 0);

                audioEl.dataset.playingPlaylist = window.currentPlaylist;
                audioEl.dataset.playingSongName = targetSongName;
                audioEl.dataset.hasStarted = "0";
                audioEl.src = info.url;

                // 🌟 新增：WebDAV 直连模式专属的 8 秒硬超时防卡死
                if (window._davDirectTimeout) clearTimeout(window._davDirectTimeout);
                const isDavDirect = rawItem.plugin_entry_path === 'dav' && window.ConfigManager.get('webdav', 'settings.mode') === 'direct';

                if (isDavDirect) {
                    const targetIdx = index;
                    window._davDirectTimeout = setTimeout(() => {
                        if (window.currentIndex === targetIdx && audioEl.readyState === 0) {
                            console.warn("[超时] WebDAV 直连无响应，强行斩断");
                            audioEl.src = '';
                            window.showToast("⚠️ 直连节点无响应，自动跳过...");

                            window.consecutiveFailures++;
                            window.markSongAsDead(window.currentPlaylist, targetIdx);
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

                let targetResumeTime = resumeTime > 0 ? resumeTime : 0;
                let targetSpeed = plConfig.speedLocal || 1.0;

                // 🌟 精准匹配：无视旧配置，只从新架构读取
                if (targetResumeTime === 0) {
                    if (plConfig.resumeLocal === 'off') {
                        // 未开启续播：看书签
                        const lastData = window.ProgressManager.getPlLast(window.currentPlaylist);
                        if (lastData && lastData.name === window.currentSongName) targetResumeTime = lastData.time;
                    } else {
                        // 开启了续播：看历史
                        const historyData = window.ProgressManager.getPlHistory(window.currentPlaylist);
                        const found = historyData.find(item => item.name === window.currentSongName);
                        if (found) targetResumeTime = found.time;
                    }
                }

                if (plConfig.resumeLocal === 'global') {
                    try {
                        const res = await fetch(`./sync?playlist=${encodeURIComponent(window.currentPlaylist)}`);
                        if (res.ok) {
                            const resData = await res.json();
                            if (resData && resData.data && resData.data.songName === window.currentSongName) {
                                targetResumeTime = resData.data.time;
                            }
                        }
                    } catch(e) { }
                }

                audioEl.defaultPlaybackRate = targetSpeed;
                audioEl.playbackRate = targetSpeed;
                if (typeof window.updateFpSpeedUI === 'function') window.updateFpSpeedUI(targetSpeed);

                window.updateNpTitleUI(window.currentSongName, true, true);

                const restoreProgress = () => {
                    if (audioEl.duration && targetResumeTime > 0) {
                        audioEl.currentTime = targetResumeTime;
                        if(timeCurrentEl) timeCurrentEl.innerText = window.formatTime(targetResumeTime);
                        if(timeDurationEl) timeDurationEl.innerText = window.formatTime(audioEl.duration);
                        if(progressBar) progressBar.style.width = (targetResumeTime / audioEl.duration * 100) + '%';
                        if(window.LyricsEngine) window.LyricsEngine.sync(targetResumeTime);
                    }
                    audioEl.removeEventListener('loadedmetadata', restoreProgress);
                };

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
            if (window._davDirectTimeout) clearTimeout(window._davDirectTimeout);
            console.error("播放请求失败:", err);
            window.showToast("⚠️ 获取链接失败，自动跳过...");

            if (window.currentIndex !== -1) {
                window.consecutiveFailures++;
                window.markSongAsDead(window.currentPlaylist, window.currentIndex);
            }

            if(window.updatePlayButtonUI) window.updatePlayButtonUI(false);

            if (window.consecutiveFailures >= 5) {
                window.showToast(`🛑 连续 5 首歌曲无法播放，已暂停。`);
                window.consecutiveFailures = 0;
            } else {
                setTimeout(() => {
                    if (typeof window.playNextSong === 'function') {
                        window.playNextSong(true);
                    }
                }, 1000);
            }
        }
    };

    window.scoutNextSong = async function(targetIndex, depth = 0) {
        if (depth >= 5 || targetIndex === window.currentIndex || !window.songList || window.songList.length === 0) return;
        window.isScouting = true;

        const rawItem = window.songList[targetIndex];
        try {
            let targetAudioUrl = null;
            let fetchedData = null;

            // 🌟 预读：WebDAV 模式分流（在线资源）公共函数处理
            const davUrl = window.getWebDavStreamUrl(rawItem);

            if (davUrl) {
                targetAudioUrl = davUrl;
                fetchedData = { url: targetAudioUrl };
            }
            else if (rawItem._isOnlineObj && rawItem.plugin_entry_path !== 'dav') {
                let sd = rawItem.source_data;
                if (typeof sd === 'string') { try { sd = JSON.parse(sd); } catch(e){} }
                const bestQuality = window.getBestLxQuality(sd, window.getLxQuality());
                const urlData = await window.fetchLxMusicUrl(sd, bestQuality);

                if (urlData && urlData.url) {
                    targetAudioUrl = urlData.url;
                    fetchedData = urlData;
                } else if (urlData && urlData.data) {
                    targetAudioUrl = typeof urlData.data === 'string' ? urlData.data : urlData.data.url;
                    fetchedData = typeof urlData.data === 'string' ? { url: urlData.data } : urlData.data;
                }
            } else {
                const res = await fetch((window.API ? window.API.info : './musicinfo?id=') + rawItem.id);
                fetchedData = await res.json();
                if (fetchedData && fetchedData.url) {
                    targetAudioUrl = fetchedData.url;
                }
            }

            if (targetAudioUrl) {
                window.preloadCache = { index: targetIndex, url: targetAudioUrl, data: fetchedData };
                console.log(`📡 [预读成功] 已提前解析第 ${targetIndex} 首歌曲直链:`, targetAudioUrl);
            } else {
                throw new Error("解析出的音频直链为空");
            }
        } catch (e) {
            console.warn(`📡 [预读失败] 第 ${targetIndex} 首歌曲探测异常:`, e);
            window.markSongAsDead(window.currentPlaylist, targetIndex);
            let nextNextIdx = (window.playMode === 2 && window.songList.length > 1) ?
                Math.floor(Math.random() * window.songList.length) :
                (targetIndex + 1 >= window.songList.length ? 0 : targetIndex + 1);
            await window.scoutNextSong(nextNextIdx, depth + 1);
        }
        window.isScouting = false;
    };

    window.scoutCrossPlaylistSong = async function(playlistName, rawItem) {
        if (!rawItem || window.isScouting) return;
        window.isScouting = true;
        try {
            let targetAudioUrl = null;
            let fetchedData = null;

            // 🌟 跨单预读：WebDAV 模式分流（在线资源）公共函数处理
            const davUrl = window.getWebDavStreamUrl(rawItem);

            if (davUrl) {
                targetAudioUrl = davUrl;
                fetchedData = { url: targetAudioUrl };
            }
            else if (rawItem._isOnlineObj && rawItem.plugin_entry_path !== 'dav') {
                let sd = rawItem.source_data;
                if (typeof sd === 'string') { try { sd = JSON.parse(sd); } catch(e){} }
                const bestQuality = window.getBestLxQuality(sd, window.getLxQuality());
                const urlData = await window.fetchLxMusicUrl(sd, bestQuality);

                if (urlData && urlData.url) {
                    targetAudioUrl = urlData.url;
                    fetchedData = urlData;
                } else if (urlData && urlData.data) {
                    targetAudioUrl = typeof urlData.data === 'string' ? urlData.data : urlData.data.url;
                    fetchedData = typeof urlData.data === 'string' ? { url: urlData.data } : urlData.data;
                }
            } else {
                const res = await fetch((window.API ? window.API.info : './musicinfo?id=') + rawItem.id);
                fetchedData = await res.json();
                if (fetchedData && fetchedData.url) {
                    targetAudioUrl = fetchedData.url;
                }
            }

            if (targetAudioUrl) {
                window.preloadCache = { isCross: true, playlist: playlistName, data: fetchedData, url: targetAudioUrl };
                console.log(`📡 [跨单预读成功] 已提前解析目标歌曲直链:`, targetAudioUrl);
            }
        } catch (e) {
            console.warn(`📡 [跨单预读失败]:`, e);
        }
        window.isScouting = false;
    };

    // =========================================================================
    // 🌟 核心引擎重构：音频事件与控件绑定中枢 (从 index.html 迁移而来)
    // =========================================================================
    window.updateFpSpeedUI = function(speed) {
        const fpCornerSpeed = document.getElementById('fp-corner-speed');
        const fpSpeedSlider = document.getElementById('fp-speed-slider');
        const audioEl = document.getElementById('audio');
        if(fpCornerSpeed) fpCornerSpeed.textContent = window.formatSpeed(speed);
        if(fpSpeedSlider) fpSpeedSlider.value = speed;
        if(audioEl) audioEl.playbackRate = speed;
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
        let isDragging = false;

        // 1. 音频核心事件监听
        audioEl.addEventListener('play', () => {
          window.updatePlayButtonUI(true);
          if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
          window.setupMediaSession(audioEl, btnPrev, btnNext);
          const conf = window.getPlaylistConfig(window.currentPlaylist);
          if (conf.resumeLocal === 'off') {
              const currentDeadList = window.deadSongIndexes[window.currentPlaylist] || [];
              document.querySelectorAll('[id^="time-wrap-"]').forEach(el => {
                  const idx = parseInt(el.id.replace('time-wrap-', ''));
                  if (!currentDeadList.includes(idx)) el.innerHTML = '';
              });
          }
        });

        audioEl.addEventListener('playing', () => { audioEl.dataset.hasStarted = "1"; window.consecutiveFailures = 0; if ('mediaSession' in navigator) window.setupMediaSession(audioEl, btnPrev, btnNext); });

        audioEl.addEventListener('pause', () => {
          window.updatePlayButtonUI(false);
          if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
          if (audioEl.src && !audioEl.ended && window.currentSongName) {
              const actualPlayingPl = audioEl.dataset.playingPlaylist || window.currentPlaylist;
              const actualPlayingSong = audioEl.dataset.playingSongName || window.currentSongName;
              window.syncToCloud(actualPlayingPl, actualPlayingSong, audioEl.currentTime, audioEl.playbackRate, true);
          }
        });

        audioEl.addEventListener('error', () => {
          if (window._davDirectTimeout) clearTimeout(window._davDirectTimeout);
          if (audioEl.src && audioEl.src !== window.location.href) {
            if (audioEl.dataset.hasStarted === "1") { window.updatePlayButtonUI(false); return; }
            window.showToast("⚠️ 歌曲链接拒绝访问，自动跳过...");
            if (window.currentIndex !== -1) { window.consecutiveFailures++; window.markSongAsDead(window.currentPlaylist, window.currentIndex); }
            window.updatePlayButtonUI(false);
            if (window.consecutiveFailures >= 5) { window.showToast(`🛑 连续 5 首歌曲无法播放，已暂停。`); window.consecutiveFailures = 0; }
            else { setTimeout(() => { playNextSong(true); }, 1000); }
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
          if (!audioEl.duration || isDragging) return;
          const current = audioEl.currentTime;
          const duration = audioEl.duration;

          const currentItem = window.songList[window.currentIndex];
          const isDavDirect = currentItem && currentItem.plugin_entry_path === 'dav' && window.ConfigManager.get('webdav', 'settings.mode') === 'direct';

          if (isDavDirect && audioEl.buffered.length > 0) {
              const bufferEnd = audioEl.buffered.end(audioEl.buffered.length - 1);
              if (bufferEnd - current < 0.2 && current < duration - 1) {
                  if (!window._stalledRecoveryTimeout) {
                      window._stalledRecoveryTimeout = setTimeout(() => {
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

              window.ProgressManager.setActive(actualPlayingPl, actualPlayingSong, current);

              const conf = window.getPlaylistConfig(actualPlayingPl);
              if (conf.resumeLocal === 'off') {
                  window.ProgressManager.setPlLast(actualPlayingPl, actualPlayingSong, current);
              } else {
                  window.ProgressManager.setPlHistory(actualPlayingPl, actualPlayingSong, current);
                  window.syncToCloud(actualPlayingPl, actualPlayingSong, current, audioEl.playbackRate, false);

                  if (actualPlayingPl === window.currentPlaylist && actualPlayingSong === window.currentSongName) {
                      const timeWrap = document.getElementById(`time-wrap-${window.currentIndex}`);
                      if (timeWrap) {
                        timeWrap.innerHTML = `<div style="display: flex; align-items: center; font-size: 11px; color: var(--primary); font-variant-numeric: tabular-nums; margin-left: 8px; flex-shrink: 0; font-weight: 500;">${window.SVG_ICONS.stopwatch}${window.formatTime(current)}</div>`;
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
          if (!window._hasManuallyPlayed && window.currentIndex !== -1 && audioEl.paused && (!audioEl.src || audioEl.src === window.location.href)) {
              window._hasManuallyPlayed = true; window.playSong(window.currentIndex, true); return;
          }
          window._hasManuallyPlayed = true;
          if (audioEl.src && audioEl.src !== window.location.href) {
              if (audioEl.paused) audioEl.play(); else { window.isPageBtnPause = true; audioEl.pause(); setTimeout(() => { window.isPageBtnPause = false; }, 200); }
              return;
          }
          if (window.songList.length === 0) return;
          if (window.currentIndex === -1) { window.playSong(0); return; }
        });

        document.addEventListener('click', (e) => { if (modePopup && !modePopup.contains(e.target) && !e.target.closest('#btn-mode')) modePopup.classList.remove('show'); });
        btnMode.addEventListener('click', (e) => { e.stopPropagation(); modePopup.classList.toggle('show'); });
        modePopup.querySelectorAll('.mode-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation(); window.playMode = parseInt(item.dataset.mode); window.updatePlayModeUI();
                if (!window.MiotManager || window.MiotManager.currentDevice.type !== 'miot') {
                    window.ConfigManager.set('config', 'player_state.playMode', window.playMode); // 🌟 使用新引擎
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
        audioEl.addEventListener('ended', () => playNextSong(true));

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
        function handleDragStart(e) { if (!audioEl.duration) return; isDragging = true; progressBar.style.width = (getPercentage(e) * 100) + '%'; }
        function handleDragMove(e) {
          if (!isDragging || !audioEl.duration) return; e.preventDefault();
          const p = getPercentage(e); progressBar.style.width = (p * 100) + '%'; timeCurrentEl.innerText = window.formatTime(p * audioEl.duration); timeDurationEl.innerText = window.formatTime(audioEl.duration);
        }
        function handleDragEnd(e) { if (!isDragging || !audioEl.duration) return; isDragging = false; audioEl.currentTime = getPercentage(e) * audioEl.duration; }

        progressContainer.addEventListener('mousedown', handleDragStart);
        document.addEventListener('mousemove', handleDragMove);
        document.addEventListener('mouseup', handleDragEnd);
        progressContainer.addEventListener('touchstart', handleDragStart, { passive: false });
        document.addEventListener('touchmove', handleDragMove, { passive: false });
        document.addEventListener('touchend', handleDragEnd);
    };

})(window);