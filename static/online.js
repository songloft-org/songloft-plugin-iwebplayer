// static/online.js
(function(window) {
    'use strict';

    // ==========================================
    // 1. 核心基座：多引擎适配器 (Plugin Manager)
    // ==========================================
    window.PluginManager = {
        engines: {},
        currentEngineName: localStorage.getItem('iwebplayer.search_engine') || 'LXMusic',

        register: function(name, engineConfig) {
            this.engines[name] = engineConfig;
            console.log(`🔌 [PluginManager] 引擎已注册: ${name}`);
        },

        getCurrentEngine: function() {
            return this.engines[this.currentEngineName];
        },

        switchEngine: function(name) {
            if (!this.engines[name]) return false;
            this.currentEngineName = name;
            localStorage.setItem('iwebplayer.search_engine', name);
            window.isWebDAVMode = (name === 'WebDAV');
            return true;
        }
    };

    // ==========================================
    // 2. 持久化快照与状态管家 (Snapshot & State)
    // ==========================================
    window.StateManager = {
        getState: function() {
            const key = `iwebplayer.state_${window.PluginManager.currentEngineName}`;
            const defaultState = window.PluginManager.currentEngineName === 'WebDAV'
                ? '{"view":"playlist","keyword":""}'
                : '{"view":"song","keyword":""}';
            try { return JSON.parse(localStorage.getItem(key) || defaultState); }
            catch(e) { return JSON.parse(defaultState); }
        },
        setState: function(stateObj) {
            const key = `iwebplayer.state_${window.PluginManager.currentEngineName}`;
            let current = this.getState();
            Object.assign(current, stateObj);
            localStorage.setItem(key, JSON.stringify(current));
        }
    };

    window.SnapshotManager = {
        saveSnapshot: function(type, htmlContent, songListData) {
            const engine = window.PluginManager.currentEngineName;
            const key = `iwebplayer.snapshot_${engine}`;
            const snapshot = { type: type, html: htmlContent, data: songListData || [], timestamp: Date.now() };
            try {
                const jsonStr = JSON.stringify(snapshot);
                const compressed = window.LZString ? window.LZString.compressToUTF16(jsonStr) : jsonStr;
                localStorage.setItem(key, compressed);
            } catch(e) {}
        },
        restoreSnapshot: function() {
            const engine = window.PluginManager.currentEngineName;
            const compressed = localStorage.getItem(`iwebplayer.snapshot_${engine}`);
            if (!compressed) return false;
            try {
                const jsonStr = window.LZString ? window.LZString.decompressFromUTF16(compressed) : compressed;
                const snapshot = JSON.parse(jsonStr);
                const grid = document.getElementById('playlist-grid');
                const list = document.getElementById('playlist');

                if (snapshot.type === 'playlist_grid') {
                    if (grid) {
                        // 🌟 核心修复：WebDAV的卡片带有专属JS事件，不能暴力替换HTML，必须调用引擎重绘
                        if (engine === 'WebDAV') {
                            window.currentOnlineView = 'playlist';
                            if (typeof window.renderPlaylist === 'function') window.renderPlaylist();
                        } else {
                            grid.innerHTML = snapshot.html;
                        }
                        grid.style.display = 'grid';
                    }
                    if (list) list.style.display = 'none';
                    window.allPlaylists['在线资源'] = snapshot.data || [];
                } else {
                    if (grid) grid.style.display = 'none';
                    if (list) list.style.display = 'block';
                    window.allPlaylists['在线资源'] = snapshot.data || [];
                    window.songList = snapshot.data || [];
                    if (typeof window.renderPlaylist === 'function') window.renderPlaylist();
                }
                return true;
            } catch(e) { return false; }
        }
    };

    window.HistoryManager = {
        save: function(type, textOrName, id, platform, action) {
            const engine = window.PluginManager.currentEngineName;
            let history = JSON.parse(localStorage.getItem('iwebplayer.search_history') || '[]');
            history = history.filter(h => {
                if (type === 'keyword' && h.type === 'keyword') return h.text !== textOrName;
                if (type === 'playlist' && h.type === 'playlist') return h.id !== id;
                return true;
            });
            const newItem = { type, engine, platform: platform || '', action: action || 'song' };
            if (type === 'keyword') newItem.text = textOrName; else { newItem.name = textOrName; newItem.id = id; }
            history.unshift(newItem);
            if (history.length > 10) history = history.slice(0, 10);
            localStorage.setItem('iwebplayer.search_history', JSON.stringify(history));
        }
    };

    // ==========================================
    // 3. 内部私有变量与旧版兼容挂载
    // ==========================================
    window.webdavData = { library: {}, currentServer: '', cachePool: {} };
    window.currentOnlineView = 'song';

    let currentSearchPage = 1;
    let hasMoreOnlineSearch = true;
    let isFetchingOnline = false;
    let onlineMusicItems = [];

    let currentLxPlaylistPage = 1;
    let hasMoreLxPlaylists = true;
    let isFetchingLxPlaylists = false;

    window.getOnlineState = () => window.StateManager.getState();
    window.setOnlineState = (state) => window.StateManager.setState(state);
    window.saveSearchHistory = (item) => {
        if (item.type === 'keyword') window.HistoryManager.save('keyword', item.text, null, item.platform, item.action);
        else window.HistoryManager.save('playlist', item.name, item.id, item.platform, 'playlist');
    };

    // ==========================================
    // 4. 引擎注册 (LXMusic & WebDAV)
    // ==========================================
    window.PluginManager.register('LXMusic', {
        icon: window.SVG_ICONS?.lx_plugin_line || '',
        searchSong: async function(keyword, source, page) {
            const res = await fetch(`/api/v1/jsplugin/lxmusic/api/search`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ keyword, source_id: source, type: "song", page, page_size: 30 })
            });
            const resJson = await res.json();
            if (resJson.code !== 0 || !resJson.data || !resJson.data.list) return { list: [], hasMore: false };
            const mapped = resJson.data.list.map(item => ({
                id: item.songmid || item.musicId, title: item.name || "未知歌曲", artist: item.singer || "未知歌手",
                album: item.album || "", duration: item.duration || 0, cover_url: item.img || null,
                _scrapedCover: item.img || null, _isOnlineObj: true, source_data: item
            }));
            return { list: mapped, hasMore: mapped.length >= 30 };
        },
        searchPlaylist: async function(keyword, source, page) {
            const reqUrl = `/api/v1/jsplugin/lxmusic/api/songlist/search?source_id=${source}&keyword=${encodeURIComponent(keyword)}&page=${page}&limit=30`;
            const res = await fetch(reqUrl);
            const resJson = await res.json();
            if (resJson.code !== 0 || !resJson.data || !resJson.data.list) return { list: [], hasMore: false };
            return { list: resJson.data.list, hasMore: resJson.data.list.length >= 20 };
        },
        getPlaylistDetail: async function(id, source, page) {
            const reqUrl = `/api/v1/jsplugin/lxmusic/api/songlist/detail?source_id=${source}&id=${id}&page=${page}`;
            const res = await fetch(reqUrl);
            const resJson = await res.json();
            if (resJson.code !== 0 || !resJson.data || !resJson.data.list) return [];
            return resJson.data.list.map(item => ({
                id: item.songmid || item.musicId, title: item.name || "未知歌曲", artist: item.singer || "未知歌手",
                album: item.album || "", duration: item.duration || 0, cover_url: item.img || null,
                _scrapedCover: item.img || null, _isOnlineObj: true, source_data: item
            }));
        }
    });

    window.PluginManager.register('WebDAV', {
        icon: window.SVG_ICONS?.webdav || '',
        searchSong: async function(keyword, source, page) {
            if (!window.webdavData.library) return { list: [], hasMore: false };
            let resultSongs = [];
            const lowerKey = keyword.toLowerCase();
            for (const songs of Object.values(window.webdavData.library)) {
                const matches = songs.filter(s => s.title.toLowerCase().includes(lowerKey));
                resultSongs = resultSongs.concat(matches);
            }
            return { list: resultSongs, hasMore: false };
        },
        searchPlaylist: async function(keyword, source, page) { return { list: [], hasMore: false }; },
        getPlaylistDetail: async function(id, source, page) {
            if (window.webdavData && window.webdavData.library[id]) return window.webdavData.library[id];
            return [];
        }
    });

    // ==========================================
    // 5. 🌟 历史面板 (100% 还原你的原生代码UI)
    // ==========================================
    window.renderSearchHistoryPopup = function() {
        let popup = document.getElementById('search-history-popup');
        const inputWrap = document.getElementById('mf-search-input-wrap');
        if (!inputWrap) return;
        if (!popup) {
            popup = document.createElement('ul');
            popup.id = 'search-history-popup';
            popup.className = 'select-options';
            popup.style.cssText = 'position: absolute; top: 100%; left: 0; right: 0; width: 100%; min-width: auto; margin-top: 6px; display: none;';
            inputWrap.appendChild(popup);
        }

        let history = JSON.parse(localStorage.getItem('iwebplayer.search_history') || '[]');

        if (history.length === 0) {
            popup.innerHTML = '<li class="select-option" style="color: var(--text-sub); justify-content: center; font-size: 13px; pointer-events: none;">暂无搜索历史</li>';
            return;
        }

        // 🌟 原汁原味的收起横条
        const closeBarHtml = `
            <div onclick="
                document.getElementById('search-history-popup').style.display='none'; 
                if(document.activeElement) document.activeElement.blur();
            " style="padding: 8px 16px; border-bottom: 1px solid var(--border); color: var(--text-sub); font-size: 12px; cursor: pointer; display: flex; align-items: center; justify-content: flex-end; gap: 2px; background: var(--card-bg); border-radius: 8px 8px 0 0; position: sticky; top: 0; z-index: 10; opacity: 0.8; user-select: none;">
                <span>收起</span>
                <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="18 15 12 9 6 15"></polyline>
                </svg>
            </div>
        `;

        // 🌟 100% 还原的搜歌与搜单布局
        const listHtml = history.map((item, idx) => {
            if (item.type === 'keyword') {
                return `<li class="select-option" data-idx="${idx}" style="justify-content: space-between;"><div class="flex-y-center" style="min-width: 0;"><svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px; opacity:0.6; flex-shrink:0;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg><span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.text}</span></div></li>`;
            } else {
                const platformName = window.PLATFORM_MAP ? (window.PLATFORM_MAP[item.platform] || item.platform) : item.platform;

                // 🌟 终极优雅：直接从引擎基座里读取配置好的图标！
                const engineConfig = window.PluginManager.engines[item.engine];
                const targetSvg = engineConfig ? (engineConfig.icon || '') : '';

                return `<li class="select-option" data-idx="${idx}">
                    <div class="flex-y-center" style="min-width: 0;">
                        ${targetSvg}
                        <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.name} <span style="color: var(--text-sub); font-size: 13px;">(${platformName})</span></span>
                    </div>
                </li>`;
            }
        }).join('');

        const clearBtnHtml = `<div id="clear-history-btn" class="select-option" style="justify-content: center; color: #ef4444; font-size: 13px; border-top: 1px solid var(--border);">清空历史记录</div>`;

        popup.innerHTML = closeBarHtml + listHtml + clearBtnHtml;

        // 绑定全新的中枢重放逻辑
        popup.querySelectorAll('.select-option[data-idx]').forEach(li => {
            li.addEventListener('click', (e) => {
                e.stopPropagation();
                const record = history[parseInt(li.dataset.idx)];
                popup.style.display = 'none';

                const searchInput = document.getElementById('mf-search-input');
                if (searchInput) {
                    searchInput.value = record.type === 'keyword' ? record.text : record.name;
                    searchInput.dispatchEvent(new Event('input'));
                    const mfSearchClear = document.getElementById('mf-search-clear');
                    if (mfSearchClear) mfSearchClear.classList.remove('show');
                }

                // 引擎跳转
                if (record.engine && record.engine !== window.PluginManager.currentEngineName) {
                    window.PluginManager.switchEngine(record.engine);
                }

                const valEngine = document.getElementById('engine-val');
                const valPlatform = document.getElementById('mf-plugin-val');
                const optsPlatform = document.getElementById('mf-plugin-opts');

                if (valEngine) { valEngine.dataset.value = record.engine || 'LXMusic'; valEngine.innerText = record.engine || 'LXMusic'; }
                if (valPlatform && record.platform) {
                    valPlatform.dataset.value = record.platform;
                    valPlatform.innerText = window.PLATFORM_MAP[record.platform] || record.platform;
                    if (optsPlatform) {
                        optsPlatform.querySelectorAll('.select-option').forEach(el => el.classList.remove('active'));
                        const targetLi = optsPlatform.querySelector(`[data-value="${record.platform}"]`);
                        if (targetLi) targetLi.classList.add('active');
                    }
                }

                if (record.type === 'playlist') window.performPlaylistDetail(record.id, record.name, record.platform, true);
                else window.performSearch(record.action || 'song', false, false);
            });
        });

        document.getElementById('clear-history-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            localStorage.setItem('iwebplayer.search_history', '[]');
            window.renderSearchHistoryPopup();
        });
    };

    // ==========================================
    // 6. 统一调度中心：搜索、详情与恢复
    // ==========================================
    window.restoreOnlineView = async function() {
        const oState = window.StateManager.getState();
        const mfSearchInput = document.getElementById('mf-search-input');
        const grid = document.getElementById('playlist-grid');
        const list = document.getElementById('playlist');
        const mfSearchMainBtns = document.getElementById('mf-search-main-btns');
        const mfSearchBackBtn = document.getElementById('mf-search-back-btn');
        const shortDivider = document.querySelector('#global-menu-1-wrapper .divider-v');
        const oldIcon = document.getElementById('mf-search-pl-icon');

        if (!mfSearchInput || !grid || !list) return;

        mfSearchInput.dataset.isTitleMode = "false";
        if (oldIcon) oldIcon.remove();

        const isDav = window.PluginManager.currentEngineName === 'WebDAV';

        // 🌟 核心改造：根据当前选择的引擎，精准探测对应的插件是否在主程序中安装
        let isPluginActive = true;
        try {
            if (isDav) {
                const res = await fetch('/api/v1/jsplugin/dav/lists');
                if (!res.ok) isPluginActive = false;
            } else {
                const res = await fetch('/api/v1/jsplugin/lxmusic/api/sources');
                if (!res.ok) isPluginActive = false;
            }
        } catch (err) {
            isPluginActive = false;
        }

        if (!isPluginActive) {
            if (list) list.style.display = 'block';
            if (grid) grid.style.display = 'none';
            if (list) {
                // 🌟 核心：直接提取 LXMusic 的专属提示模板
                const noPluginStr = window.NO_PLUGIN_HTML || '<div style="text-align: center; padding: 40px; color: var(--text-sub); font-size: 14px;">⚠️ 未检测到 LXMusic 插件，请先在主程序中安装并启用。</div>';
                // 🌟 动态克隆：如果是 WebDAV，直接将模板里的 LXMusic 替换为 WebDAV，保证样式 100% 完全一致！
                list.innerHTML = isDav ? noPluginStr.replace(/LXMusic/gi, 'WebDAV') : noPluginStr;
            }
            return;
        }
        window.currentOnlineView = oState.view;

        if (oState.view === 'song') {
            mfSearchInput.value = isDav ? '' : (oState.keyword || '');
            mfSearchInput.placeholder = isDav ? '在当前网盘中极速过滤...' : '搜全网资源...';
            if (mfSearchMainBtns) mfSearchMainBtns.style.display = isDav ? 'none' : 'flex';
            if (mfSearchBackBtn) mfSearchBackBtn.style.display = 'none';
            if (shortDivider) shortDivider.style.display = isDav ? 'none' : '';

            grid.style.display = 'none';
            list.style.display = 'block';

            window.songList = window.getMergedSongList('在线资源');
            if (window.songList.length === 0) {
                if (!isDav && oState.keyword) {
                    window.performSearch('song', false, false);
                } else {
                    list.innerHTML = isDav ? '<div style="text-align: center; padding: 40px; color: var(--text-sub); font-size: 14px;">请在上方搜索或刷新网盘</div>' : '<div style="text-align: center; padding: 40px; color: var(--text-sub); font-size: 14px;">请在上方输入关键词搜索全网音乐或歌单</div>';
                }
            } else {
                window.renderPlaylist();
            }
        }
        else if (oState.view === 'playlist') {
            mfSearchInput.value = isDav ? '' : (oState.keyword || '');
            mfSearchInput.placeholder = isDav ? '在当前网盘中极速过滤...' : '搜全网资源...';
            if (mfSearchMainBtns) mfSearchMainBtns.style.display = isDav ? 'none' : 'flex';
            if (mfSearchBackBtn) mfSearchBackBtn.style.display = 'none';
            if (shortDivider) shortDivider.style.display = isDav ? 'none' : '';

            list.style.display = 'none';
            grid.style.display = 'grid';

            if (isDav) {
                if (window.loadWebDavServers) window.loadWebDavServers();
            } else {
                if (!grid.querySelector('.pl-card-b')) {
                    if (oState.keyword) {
                        window.performSearch('playlist', false, false);
                    } else {
                        grid.innerHTML = '<div style="text-align: center; padding: 60px; color: var(--text-sub); font-size: 14px; grid-column: 1 / -1;">请在上方输入关键词搜索全网音乐或歌单</div>';
                    }
                }
            }
        }
        else if (oState.view === 'detail') {
            if (isDav && window.webdavData && window.webdavData.library[oState.detail_name]) {
                window.renderWebDavFolder(oState.detail_name, window.webdavData.library[oState.detail_name]);
            } else if (!isDav && oState.detail_id && oState.detail_name && oState.detail_source) {
                window._lastOnlineKeyword = oState.keyword;
                window.performPlaylistDetail(oState.detail_id, oState.detail_name, oState.detail_source, false);
            } else {
                if (isDav) {
                    if (list) { list.style.display = 'block'; list.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-sub); font-size: 14px;">正在恢复网盘资源...</div>'; }
                    if (grid) grid.style.display = 'none';
                    if (mfSearchMainBtns) mfSearchMainBtns.style.display = 'none';
                    if (mfSearchBackBtn) mfSearchBackBtn.style.display = 'block';
                    if (shortDivider) shortDivider.style.display = '';
                    if (mfSearchInput) { mfSearchInput.value = oState.detail_name || ''; mfSearchInput.dataset.isTitleMode = "true"; mfSearchInput.dataset.hasBackBtn = "true"; }
                } else {
                    window.StateManager.setState({ view: 'song' });
                    window.restoreOnlineView();
                }
            }
        }
    };

    window.performSearch = async function(action, isLoadMore = false, isRestore = false) {
        const engineName = window.PluginManager.currentEngineName;
        const engine = window.PluginManager.getCurrentEngine();
        if (!engine) { window.showToast("当前引擎未初始化"); return; }

        const searchInputEl = document.getElementById('mf-search-input');
        let keyword = searchInputEl ? searchInputEl.value.trim() : '';

        if (!keyword && isRestore) {
            const oState = window.StateManager.getState();
            if (oState.keyword) { keyword = oState.keyword; if (searchInputEl) searchInputEl.value = keyword; }
        }

        if (!keyword) {
            if (engineName === 'WebDAV') { if(window.fetchWebDavLibrary) window.fetchWebDavLibrary(); }
            else window.showToast(action === 'playlist' ? "请输入要搜索的歌单关键词" : "请输入要搜索的歌曲关键词");
            return;
        }

        const grid = document.getElementById('playlist-grid');
        const list = document.getElementById('playlist');
        const source = document.getElementById('mf-plugin-val')?.dataset.value || '';

        // 替换为这段（保证打字时焦点不丢失，且不再闪烁 Loading 提示！并且不往本地记录塞垃圾关键字）：
        if (!isLoadMore) {
            // 🌟 修复：WebDAV 是实时搜索，绝不能失去焦点！
            if (searchInputEl && engineName !== 'WebDAV') searchInputEl.blur();
            if (action === 'song') {
                currentSearchPage = 1; hasMoreOnlineSearch = true; window.songList = []; onlineMusicItems = []; window.currentOnlineView = 'song';
                if (grid) grid.style.display = 'none';
                if (list) {
                    list.style.display = 'block';
                    // 🌟 修复：WebDAV 内存瞬间出结果，不再闪烁无用的 Loading 提示
                    if (engineName !== 'WebDAV') list.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-sub); font-size: 14px;">正在抓取，请稍候...</div>';
                }
            } else {
                currentLxPlaylistPage = 1; hasMoreLxPlaylists = true;
                if (list) list.style.display = 'none';
                if (grid) { grid.style.display = 'grid'; grid.innerHTML = '<div style="text-align: center; padding: 60px; color: var(--text-sub); font-size: 14px; grid-column: 1 / -1;">正在拉取海报...</div>'; }
            }
        } else {
            if (action === 'song' && (!hasMoreOnlineSearch || isFetchingOnline)) return;
            if (action === 'playlist' && (!hasMoreLxPlaylists || isFetchingLxPlaylists)) return;
            if (action === 'song') currentSearchPage++;
            if (action === 'playlist') currentLxPlaylistPage++;
        }

        if (action === 'song') isFetchingOnline = true;
        if (action === 'playlist') isFetchingLxPlaylists = true;

        try {
            if (action === 'song') {
                const res = await engine.searchSong(keyword, source, currentSearchPage);
                if (res.list && res.list.length > 0) {
                    if (!isLoadMore && !isRestore) {
                        if (engineName !== 'WebDAV') {
                            window.HistoryManager.save('keyword', keyword, null, source, 'song');
                        } else {
                            // 🌟 核心机制：WebDAV 专属防抖。停手 1.5 秒且有结果时，才作为最终词汇写入历史
                            clearTimeout(window._davHistoryTimer);
                            window._davHistoryTimer = setTimeout(() => {
                                window.HistoryManager.save('keyword', keyword, null, source, 'song');
                            }, 1500);
                        }
                        window.StateManager.setState({ view: 'song', keyword: keyword });
                    }
                    if (isLoadMore) onlineMusicItems = [...onlineMusicItems, ...res.list];
                    else onlineMusicItems = res.list;

                    window.songList = [...onlineMusicItems];
                    window.allPlaylists['在线资源'] = window.songList;
                    hasMoreOnlineSearch = res.hasMore;

                    if (engineName === 'WebDAV') {
                        window.StateManager.setState({ view: 'dav_search', keyword: keyword });
                        window.renderWebDavFolder(keyword, window.songList, true);
                    } else {
                        window.renderPlaylist();
                        const plVal = document.getElementById('playlist-val');
                        if (plVal) plVal.innerHTML = window.formatPlaylistText('在线资源', window.songList.length);
                        // 🌟 修复问题2：快照保存必须移进 else 里！
                        // 这样 WebDAV 搜索时就不会把底层的“海报墙快照”给抹杀掉了
                        if (!isLoadMore) window.SnapshotManager.saveSnapshot('song_list', list.innerHTML, window.songList);
                    }
                } else {
                    if (!isLoadMore) { if (list) list.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-sub); font-size: 14px;">未找到相关内容</div>`; }
                    else { hasMoreOnlineSearch = false; window.showToast("已经是最后一页啦"); }
                }
            } else {
                const res = await engine.searchPlaylist(keyword, source, currentLxPlaylistPage);
                if (res.list && res.list.length > 0) {
                    if (!isLoadMore) {
                        window.HistoryManager.save('keyword', keyword, null, source, 'playlist');
                        window.StateManager.setState({ view: 'playlist', keyword: keyword });
                        grid.innerHTML = '';
                    }

                    const html = res.list.map(item => {
                        const rawName = item.name || '未知歌单'; const mainName = rawName.split(/\||｜/)[0];
                        const subName = item.author || ''; const playCount = item.play_count || '0';
                        const songCountHtml = item.total ? `<div class="pl-time">共 ${item.total} 首</div>` : '';
                        return `
                        <div class="pl-card-b" data-action="open_playlist" data-pl-id="${item.id}" data-pl-name="${mainName.replace(/"/g,"&quot;")}" data-pl-source="${source}" data-pl-engine="LXMusic">
                          <img src="${item.img || ''}" alt="cover" loading="lazy" onerror="this.src=window.defaultCover">
                          <div class="pl-overlay"><div class="pl-name">${mainName}${subName ? '<br>'+subName : ''}</div>${songCountHtml}</div>
                          <div class="pl-playcount"><svg viewBox="0 0 24 24" width="9" height="9" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path></svg> ${playCount}</div>
                        </div>`;
                    }).join('');

                    grid.insertAdjacentHTML('beforeend', html);
                    hasMoreLxPlaylists = res.hasMore;
                    if (!isLoadMore) window.SnapshotManager.saveSnapshot('playlist_grid', grid.innerHTML, null);
                } else {
                    if (!isLoadMore) { grid.innerHTML = '<div style="text-align: center; padding: 60px; color: var(--text-sub); font-size: 14px; grid-column: 1 / -1;">未找到相关歌单</div>'; }
                    else { hasMoreLxPlaylists = false; window.showToast("已经是最后一页啦"); }
                }
            }
        } catch (e) {
            if (!isLoadMore) {
                if (action === 'song' && list) list.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-sub); font-size: 14px;">网络异常，请重试</div>`;
                if (action === 'playlist' && grid) grid.innerHTML = `<div style="text-align: center; padding: 60px; color: var(--text-sub); font-size: 14px; grid-column: 1 / -1;">网络异常，请重试</div>`;
            } else {
                if (action === 'song') currentSearchPage--;
                if (action === 'playlist') currentLxPlaylistPage--;
                window.showToast("加载失败，请检查网络");
            }
        } finally {
            if (action === 'song') isFetchingOnline = false;
            if (action === 'playlist') isFetchingLxPlaylists = false;
        }
    };

    window.performPlaylistDetail = async function(id, name, source, isFromHistory = false) {
        const engine = window.PluginManager.getCurrentEngine();
        if (!engine) return;

        const oState = window.StateManager.getState();
        const searchInputEl = document.getElementById('mf-search-input');

        if (!isFromHistory) {
            window._gridScrollY = window.scrollY || document.documentElement.scrollTop;
            window.StateManager.setState({
                view: 'detail', detail_id: id, detail_name: name, detail_source: source,
                keyword: window._lastOnlineKeyword || searchInputEl?.value.trim() || oState.keyword || ''
            });
            window.HistoryManager.save('playlist', name, id, source, 'playlist');
        }

        if (searchInputEl) searchInputEl.blur();
        window.currentOnlineView = 'detail';

        const grid = document.getElementById('playlist-grid');
        const list = document.getElementById('playlist');
        if(grid) grid.style.display = 'none';
        if(list) { list.style.display = 'block'; list.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-sub); font-size: 14px;">正在获取详情...</div>'; }

        document.getElementById('mf-search-main-btns').style.display = 'none';
        document.querySelector('.search-text-group').style.borderLeft = '';

        const shortDivider = document.querySelector('#global-menu-1-wrapper .divider-v');
        const backBtn = document.getElementById('mf-search-back-btn');
        if (isFromHistory) {
            if (backBtn) backBtn.style.display = 'none';
            if (shortDivider) shortDivider.style.display = 'none';
        } else {
            if (backBtn) backBtn.style.display = 'block';
            if (shortDivider) shortDivider.style.display = '';
        }

        const oldIcon = document.getElementById('mf-search-pl-icon');
        if (oldIcon) oldIcon.remove();
        const iconSpan = document.createElement('span');
        iconSpan.id = 'mf-search-pl-icon';
        iconSpan.style.display = 'inline-flex';       // 🌟 保证容器对齐机制
        iconSpan.style.transform = 'translateY(2px)';
        iconSpan.innerHTML = window.SVG_ICONS?.lx_plugin_line || '';

        if (searchInputEl) {
            if (!isFromHistory) window._lastOnlineKeyword = searchInputEl.value || oState.keyword || '';
            searchInputEl.parentNode.insertBefore(iconSpan, searchInputEl);
            searchInputEl.value = name;
            searchInputEl.placeholder = '';
            searchInputEl.dataset.isTitleMode = "true";
            searchInputEl.dataset.hasBackBtn = isFromHistory ? "false" : "true";
        }

        if (!isFromHistory) window.scrollTo({ top: 0, behavior: 'smooth' });

        try {
            const songs = await engine.getPlaylistDetail(id, source, 1);
            if (songs && songs.length > 0) {
                window.songList = songs; window.allPlaylists['在线资源'] = window.songList; window.renderPlaylist();
                const plVal = document.getElementById('playlist-val');
                if (plVal) {
                    if (typeof window.formatPlaylistTextWithTags === 'function') plVal.innerHTML = window.formatPlaylistTextWithTags('在线资源', window.songList.length);
                    else plVal.innerHTML = `在线资源 (${window.songList.length})`;
                }
            } else { list.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-sub); font-size: 14px;">该歌单为空或获取失败</div>`; }
        } catch(e) { list.innerHTML = window.NO_PLUGIN_HTML || '加载失败'; }
    };

    window.doOnlineSearch = (isLoadMore = false) => window.performSearch('song', isLoadMore);
    window.doLxPlaylistSearch = (isLoadMore = false) => window.performSearch('playlist', isLoadMore);
    window.triggerPlaylistDetail = (id, name, source, isFromHistory = false) => window.performPlaylistDetail(id, name, source, isFromHistory);

    // ==========================================
    // 7. 滚动翻页事件接管
    // ==========================================
    window.addEventListener('scroll', () => {
        if (window.currentPlaylist !== '在线资源') return;
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        const clientHeight = window.innerHeight || document.documentElement.clientHeight;
        const scrollHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);

        if (scrollTop + clientHeight > scrollHeight - 100) {
            const list = document.getElementById('playlist');
            const grid = document.getElementById('playlist-grid');
            if (list && list.style.display !== 'none' && window.currentOnlineView === 'song') {
                if (!isFetchingOnline && hasMoreOnlineSearch) window.doOnlineSearch(true);
            } else if (grid && grid.style.display !== 'none') {
                if (!isFetchingLxPlaylists && hasMoreLxPlaylists) window.doLxPlaylistSearch(true);
            }
        }
    }, { passive: true });

    // ==========================================
    // 8. 全局点击与交互拦截引擎
    // ==========================================
    document.addEventListener('click', async (e) => {
        // 🎯 拦截 0：大一统事件委托中枢 (接管全站所有海报卡片的点击)
        const plCard = e.target.closest('.pl-card-b[data-action="open_playlist"]');
        if (plCard) {
            e.stopPropagation(); e.preventDefault();
            const engine = plCard.dataset.plEngine;
            const name = plCard.dataset.plName;

            if (engine === 'WebDAV') {
                window.renderWebDavFolder(name, window.getMergedSongList(name));
            } else if (engine === 'LXMusic') {
                const id = plCard.dataset.plId;
                const source = plCard.dataset.plSource;
                window.triggerPlaylistDetail(id, name, source);
            } else if (engine === 'Local') {
                window._gridScrollY = window.scrollY || document.documentElement.scrollTop;
                window._isGridClick = true;
                const targetOpt = Array.from(document.querySelectorAll('#playlist-opts .select-option')).find(el => el.dataset.key === name);
                if (targetOpt) targetOpt.click();
                window._isGridClick = false;
            }
            // 💡 未来加 MusicFree，只需在这里加个 else if (engine === 'MusicFree') 即可！
            return;
        }

        // 🎯 拦截 1：引擎切换 (沙盒完全隔离版)
        const engineLi = e.target.closest('#engine-opts .select-option');
        if (engineLi) {
            e.stopPropagation();
            const engine = engineLi.dataset.value;
            const grid = document.getElementById('playlist-grid');
            const list = document.getElementById('playlist');

            // 1. 无情备份当前引擎的全部状态（海报墙 + 歌曲列表 + 数据池）
            if (window.isWebDAVMode) {
                window.webdavOnlineBackup = window.allPlaylists['在线资源'] || [];
                window.webdavGridBackup = grid ? grid.innerHTML : '';
                window.webdavListBackup = list ? list.innerHTML : '';
            } else {
                window.lxOnlineBackup = window.allPlaylists['在线资源'] || [];
                window.lxGridBackup = grid ? grid.innerHTML : '';
                window.lxListBackup = list ? list.innerHTML : '';
            }

            // 2. 切换核心引擎标志
            window.PluginManager.switchEngine(engine);

            const engineOpts = document.getElementById('engine-opts');
            const engineVal = document.getElementById('engine-val');
            if (engineOpts) {
                engineOpts.querySelectorAll('.select-option').forEach(el => el.classList.remove('active'));
                engineLi.classList.add('active');
                engineOpts.classList.remove('show');
            }
            if (engineVal) { engineVal.innerText = engineLi.innerText; engineVal.dataset.value = engine; }

            // 3. 提取目标引擎的记忆账本
            const oState = window.StateManager.getState();
            window.currentOnlineView = oState.view;

            const mfSearchInput = document.getElementById('mf-search-input');
            const mfSearchMainBtns = document.getElementById('mf-search-main-btns');
            const mfSearchBackBtn = document.getElementById('mf-search-back-btn');
            const shortDivider = document.querySelector('#global-menu-1-wrapper .divider-v');
            const oldIcon = document.getElementById('mf-search-pl-icon');

            // 4. 精准复原目标引擎的最后现场
            if (window.isWebDAVMode) {
                window.allPlaylists['在线资源'] = window.webdavOnlineBackup || [];
                window.songList = window.allPlaylists['在线资源'];
                if (grid && window.webdavGridBackup !== undefined) grid.innerHTML = window.webdavGridBackup;
                if (list && window.webdavListBackup !== undefined) list.innerHTML = window.webdavListBackup;

                if (mfSearchMainBtns) mfSearchMainBtns.style.display = 'none';
                if (shortDivider) shortDivider.style.display = 'none';

                if (mfSearchInput) {
                    mfSearchInput.placeholder = '在当前网盘中极速过滤...';
                    if (oState.view === 'playlist') {
                        mfSearchInput.value = '';
                        mfSearchInput.dataset.isTitleMode = "false";
                        if (mfSearchBackBtn) mfSearchBackBtn.style.display = 'none';
                        if (oldIcon) oldIcon.remove();
                    } else if (oState.view === 'detail') {
                        mfSearchInput.value = oState.detail_name || '';
                        mfSearchInput.dataset.isTitleMode = "true";
                        if (mfSearchBackBtn) mfSearchBackBtn.style.display = 'block';
                        if (!oldIcon) {
                            const iconSpan = document.createElement('span');
                            iconSpan.id = 'mf-search-pl-icon';
                            iconSpan.style.display = 'inline-flex';
                            iconSpan.style.transform = 'translateY(2px)';
                            iconSpan.innerHTML = window.SVG_ICONS.webdav.replace('width="15"', 'width="16"').replace('height="15"', 'height="16"');
                            mfSearchInput.parentNode.insertBefore(iconSpan, mfSearchInput);
                        }
                    } else if (oState.view === 'dav_search') {
                        mfSearchInput.value = oState.keyword || '';
                        mfSearchInput.dataset.isTitleMode = "false";
                        if (mfSearchBackBtn) mfSearchBackBtn.style.display = mfSearchInput.value ? 'block' : 'none';
                        if (oldIcon) oldIcon.remove();
                    }
                }

                if (oState.view === 'playlist') { if(grid) grid.style.display = 'grid'; if(list) list.style.display = 'none'; }
                else { if(grid) grid.style.display = 'none'; if(list) list.style.display = 'block'; }

                // 极端兜底：如果完全没渲染过网盘，才去拉取
                if (window.loadWebDavServers) window.loadWebDavServers();

            } else {
                window.allPlaylists['在线资源'] = window.lxOnlineBackup || [];
                window.songList = window.allPlaylists['在线资源'];
                if (grid && window.lxGridBackup !== undefined) grid.innerHTML = window.lxGridBackup;
                if (list && window.lxListBackup !== undefined) list.innerHTML = window.lxListBackup;

                document.getElementById('mf-search-btn').innerText = '搜歌';
                document.getElementById('mf-search-playlist-btn').innerText = '搜单';

                if (mfSearchInput) {
                    mfSearchInput.placeholder = '搜全网资源...';
                    if (oState.view === 'detail') {
                        mfSearchInput.value = oState.detail_name || '';
                        mfSearchInput.dataset.isTitleMode = "true";
                        if (mfSearchBackBtn) mfSearchBackBtn.style.display = 'block';
                        if (mfSearchMainBtns) mfSearchMainBtns.style.display = 'none';
                        if (shortDivider) shortDivider.style.display = 'none';
                        if (!oldIcon) {
                            const iconSpan = document.createElement('span');
                            iconSpan.id = 'mf-search-pl-icon';
                            iconSpan.style.display = 'inline-flex';
                            iconSpan.style.transform = 'translateY(2px)';
                            iconSpan.innerHTML = window.SVG_ICONS?.lx_plugin_line || '';
                            mfSearchInput.parentNode.insertBefore(iconSpan, mfSearchInput);
                        }
                    } else {
                        mfSearchInput.value = oState.keyword || '';
                        mfSearchInput.dataset.isTitleMode = "false";
                        if (mfSearchBackBtn) mfSearchBackBtn.style.display = 'none';
                        if (mfSearchMainBtns) mfSearchMainBtns.style.display = 'flex';
                        if (shortDivider) shortDivider.style.display = '';
                        if (oldIcon) oldIcon.remove();
                    }
                }

                if (oState.view === 'playlist') { if(grid) grid.style.display = 'grid'; if(list) list.style.display = 'none'; }
                else { if(grid) grid.style.display = 'none'; if(list) list.style.display = 'block'; }

                if (window.renderMainPlatformDropdown) window.renderMainPlatformDropdown();

                // 极端兜底：如果完全没渲染过 LX，才走正常初始化
                if ((!window.lxGridBackup && oState.view === 'playlist') || (!window.lxListBackup && oState.view === 'song')) {
                    if (window.currentPlaylist === '在线资源' && window.restoreOnlineView) window.restoreOnlineView();
                }
            }
            return;
        }

        // 🎯 拦截 2：全局快照返回引擎
        const backBtn = e.target.closest('#mf-search-back-btn');
        if (backBtn) {
            e.stopPropagation(); e.preventDefault();
            const success = window.SnapshotManager.restoreSnapshot();

            if (success) {
                const oState = window.StateManager.getState();
                let prevState = (oState.keyword && oState.view !== 'playlist') ? 'song' : 'playlist';

                // 🌟 核心修复法则 1：WebDAV 返回必定是海报墙，强制清空底层记忆
                if (window.PluginManager.currentEngineName === 'WebDAV') {
                    prevState = 'playlist';
                    window.StateManager.setState({ view: 'playlist', keyword: '' });
                } else {
                    window.StateManager.setState({ view: prevState });
                }

                window.currentOnlineView = prevState;

                // 🌟 核心修复：LX 和 WebDAV 区别对待！LX 返回后必须恢复“搜歌/搜单”按钮
                document.getElementById('mf-search-main-btns').style.display = window.PluginManager.currentEngineName === 'WebDAV' ? 'none' : 'flex';
                backBtn.style.display = 'none';

                const shortDivider = document.querySelector('#global-menu-1-wrapper .divider-v');
                if (shortDivider) shortDivider.style.display = window.PluginManager.currentEngineName === 'WebDAV' ? 'none' : '';

                const mfSearchInput = document.getElementById('mf-search-input');
                if (mfSearchInput) {
                    // 🌟 核心修复法则 2：只要是 WebDAV 模式，输入框必须是干干净净的
                    if (window.PluginManager.currentEngineName === 'WebDAV') {
                        mfSearchInput.value = '';
                    } else {
                        mfSearchInput.value = window._lastOnlineKeyword || oState.keyword || '';
                    }
                    mfSearchInput.placeholder = window.PluginManager.currentEngineName === 'WebDAV' ? '在当前网盘中极速过滤...' : '搜全网资源...';
                    mfSearchInput.dataset.isTitleMode = "false";
                }
                const oldIcon = document.getElementById('mf-search-pl-icon');
                if (oldIcon) oldIcon.remove();

                setTimeout(() => { window.scrollTo({ top: window._gridScrollY || 0, behavior: 'auto' }); }, 10);
            } else {
                if (window.PluginManager.currentEngineName === 'WebDAV') {
                    window.StateManager.setState({ view: 'playlist', keyword: '' });
                } else {
                    window.StateManager.setState({ view: 'playlist' });
                }
                window.restoreOnlineView();
            }
            return;
        }

        // 🎯 拦截 3：WebDAV 节点切换
        const srvLi = e.target.closest('#mf-plugin-opts .select-option');
        if (window.isWebDAVMode && srvLi && !srvLi.classList.contains('disabled-text')) {
            e.stopPropagation();
            const optsEl = document.getElementById('mf-plugin-opts');
            const valEl = document.getElementById('mf-plugin-val');
            optsEl.querySelectorAll('.select-option').forEach(el => el.classList.remove('active'));
            srvLi.classList.add('active');
            valEl.innerText = srvLi.innerText; valEl.dataset.value = srvLi.dataset.value;
            window.webdavData.currentServer = srvLi.dataset.value;
            optsEl.classList.remove('show');
            if (window.fetchWebDavLibrary) window.fetchWebDavLibrary();
            return;
        }

        // 🎯 拦截 4：弹窗扫库按钮
        const scanBtn = e.target.closest('#btn-webdav-scan');
        if (scanBtn) { e.stopPropagation(); if(window.triggerWebDavScan) window.triggerWebDavScan(); return; }

    }, true);

    // ==========================================
    // 9. WebDAV 基础拉取引擎保持不变
    // ==========================================
    window.loadWebDavRootPath = async function(serverName) {
        if (!serverName) return;
        const wdDirPath = document.getElementById('wd-dir-path');
        try {
            const res = await fetch(`/api/v1/jsplugin/iwebplayer/store?key=webdav_root_${encodeURIComponent(serverName)}`);
            const data = await res.json();
            const savedPath = data.data || '/';
            if (wdDirPath) wdDirPath.innerText = savedPath;
            window.currentBrowserPath = savedPath;
        } catch(e) {
            if (wdDirPath) wdDirPath.innerText = '/';
            window.currentBrowserPath = '/';
        }
    };

    window.fetchWebDavLibrary = async function(forceRefresh = false) {
        const grid = document.getElementById('playlist-grid');
        const list = document.getElementById('playlist');
        if(!grid || !list) return;

        const serverName = window.webdavData.currentServer;
        if(!serverName) return;

        if (!forceRefresh && window.webdavData.cachePool[serverName]) {
            window.webdavData.library = window.webdavData.cachePool[serverName];
            window.webdavPlaylistMeta = Object.keys(window.webdavData.library).map(folderName => ({
                name: folderName, song_count: window.webdavData.library[folderName].length, cover_url: ''
            }));
            if (window.currentPlaylist === '在线资源') {
                const oState = window.getOnlineState();
                if (oState.view === 'detail' && oState.detail_name && window.webdavData.library[oState.detail_name]) {
                    window.renderWebDavFolder(oState.detail_name, window.webdavData.library[oState.detail_name], false, true);
                } else if (oState.view === 'playlist') {
                    window.currentOnlineView = 'playlist'; list.style.display = 'none'; grid.style.display = 'grid'; window.renderPlaylist();
                } else { window.currentOnlineView = 'song'; window.renderPlaylist(); }
            }
            return;
        }

        if (window.currentPlaylist === '在线资源') {
            list.style.display = 'none'; grid.style.display = 'grid';
            grid.innerHTML = '<div style="text-align: center; padding: 60px; color: var(--text-sub); grid-column: 1 / -1;">正在拉取网盘索引...</div>';
        }

        try {
            const res = await fetch(`/api/v1/jsplugin/iwebplayer/dav/library?davId=${encodeURIComponent(serverName)}`);
            const data = await res.json();

            if (!data || Object.keys(data).length === 0) {
                if (window.currentPlaylist === '在线资源') {
                    grid.innerHTML = '<div style="text-align: center; padding: 60px; color: var(--text-sub); grid-column: 1 / -1;">曲库为空，请点击右上角【刷新】进行扫库</div>';
                }
                return;
            }

            window.webdavData.cachePool[serverName] = data;
            window.webdavData.library = data;
            window.webdavPlaylistMeta = Object.keys(data).map(folderName => ({
                name: folderName, song_count: data[folderName].length, cover_url: ''
            }));

            if (window.currentPlaylist === '在线资源') {
                const oState = window.getOnlineState();
                if (oState.view === 'detail' && oState.detail_name && data[oState.detail_name]) {
                    window.renderWebDavFolder(oState.detail_name, data[oState.detail_name], false, true);
                } else if (oState.view === 'playlist') {
                    window.currentOnlineView = 'playlist'; list.style.display = 'none'; grid.style.display = 'grid'; window.renderPlaylist();
                } else { window.currentOnlineView = 'song'; window.renderPlaylist(); }
            }
            if (window.updateWebDavDirectLinkUI) window.updateWebDavDirectLinkUI();
        } catch(e) {
            if (window.currentPlaylist === '在线资源') {
                grid.innerHTML = '<div style="text-align: center; padding: 60px; color: var(--text-sub); grid-column: 1 / -1;">加载曲库失败</div>';
            }
        }
    };

    window.renderWebDavFolder = function(folderName, songs, isSearch = false, isHistory = false) {
        window.currentOnlineView = 'detail';
        window.setOnlineState({ view: 'detail', detail_name: folderName });

        const grid = document.getElementById('playlist-grid');
        const list = document.getElementById('playlist');

        if(grid) grid.style.display = 'none';
        if(list) list.style.display = 'block';

        window.songList = songs;
        window.allPlaylists['在线资源'] = songs;

        if (!isSearch && !isHistory && typeof window.saveSearchHistory === 'function') {
            window.saveSearchHistory({ type: 'playlist', id: folderName, name: folderName, engine: 'WebDAV', platform: window.webdavData.currentServer || '' });
        }

        const btns = document.getElementById('mf-search-main-btns');
        const backBtn = document.getElementById('mf-search-back-btn');
        const divider = document.querySelector('#global-menu-1-wrapper .divider-v');
        if(btns) btns.style.display = 'none';
        if(backBtn) backBtn.style.display = 'block';
        if(divider) divider.style.display = '';

        const searchInput = document.getElementById('mf-search-input');
        if (searchInput) {
            searchInput.value = folderName; searchInput.dataset.isTitleMode = "true"; searchInput.dataset.hasBackBtn = "true";
            const oldIcon = document.getElementById('mf-search-pl-icon');
            if (oldIcon) oldIcon.remove();

            if (!isSearch) {
                const iconSpan = document.createElement('span');
                iconSpan.id = 'mf-search-pl-icon';
                iconSpan.style.display = 'inline-flex';       // 🌟 保证容器对齐机制
                iconSpan.style.transform = 'translateY(2px)';
                iconSpan.innerHTML = window.SVG_ICONS.webdav.replace('width="15"', 'width="16"').replace('height="15"', 'height="16"');
                searchInput.parentNode.insertBefore(iconSpan, searchInput);
            }
        }

        if(window.renderPlaylist) window.renderPlaylist();
    };

    window.triggerWebDavScan = async function() {
        const davId = window.webdavData.currentServer;
        const rootPath = document.getElementById('wd-dir-path')?.innerText || '/';
        if(!davId) { if(window.showToast) window.showToast("⚠️ 请先在配置中添加网盘服务器"); return; }

        if(window.showToast) window.showToast("⏳ 启动网盘扫库...", true);
        try {
            await fetch('/api/v1/jsplugin/iwebplayer/dav/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ davId, rootPath }) });
            window.pollWebDavStatus();
        } catch(e) { if(window.showToast) window.showToast("❌ 指令发送失败"); }
    };

    window.pollWebDavStatus = function() {
        fetch('/api/v1/jsplugin/iwebplayer/dav/status')
            .then(r => r.json())
            .then(res => {
                if (res.status === 'scanning') {
                    if(window.showToast) window.showToast(`⏳ 网盘扫库中... 已提取 ${res.scanned_folders} 个目录`, true);
                    setTimeout(window.pollWebDavStatus, 3000);
                } else if (res.status === 'completed') {
                    if(window.showToast) window.showToast("✅ 扫库完成！界面已更新");
                    window.fetchWebDavLibrary(true);
                } else { if(window.showToast) window.showToast("❌ 扫描任务异常中止"); }
            })
            .catch(()=>{ if(window.showToast) window.showToast("⚠️ 轮询进度异常，请稍后刷新重试"); });
    };
    // 🌟 新增：提取 WebDAV 第一首歌直链并更新至 UI
    window.updateWebDavDirectLinkUI = function() {
        const wrap = document.getElementById('wd-direct-test-wrap');
        const authBtn = document.getElementById('wd-btn-direct-auth');
        const hiddenUrl = document.getElementById('wd-direct-url-hidden');
        const currentMode = localStorage.getItem('iwebplayer.webdav_mode') || 'proxy';

        if (wrap && authBtn && hiddenUrl) {
            if (currentMode === 'direct') {
                wrap.style.display = 'block';
                let firstUrl = '';

                // 遍历内存，无情提取第一首有链接的歌
                if (window.webdavData && window.webdavData.library) {
                    for (const folder in window.webdavData.library) {
                        const songs = window.webdavData.library[folder];
                        if (songs && songs.length > 0) {
                            const found = songs.find(s => s.streamUrl);
                            if (found) { firstUrl = found.streamUrl; break; }
                        }
                    }
                }

                if (firstUrl) {
                    hiddenUrl.innerText = firstUrl;
                    authBtn.style.opacity = '1';
                    authBtn.style.pointerEvents = 'auto';
                    authBtn.innerHTML = '⚡ 一键激活授权通道';
                } else {
                    hiddenUrl.innerText = '';
                    authBtn.style.opacity = '0.5';
                    authBtn.style.pointerEvents = 'none';
                    authBtn.innerHTML = '❌ 暂无歌曲链接';
                }
            } else {
                wrap.style.display = 'none';
            }
        }
    };

    // ==========================================
    // 10. WebDAV 节点可视化管理界面逻辑 (内存缓存极速版)
    // ==========================================
    let currentDavServers = [];
    let webdavDefaultServerName = "";

    window.loadWebDavServers = async function(force = false) {
        const valEl = document.getElementById('wd-server-val');
        const optsEl = document.getElementById('wd-server-opts');
        const btnDefault = document.getElementById('wd-btn-default');
        const mainValEl = document.getElementById('mf-plugin-val');
        const mainOptsEl = document.getElementById('mf-plugin-opts');

        if (!optsEl || !valEl) return;

        // 🌟 核心优化 1：内存缓存命中判断（非强刷 且 内存已有节点数据）
        if (!force && currentDavServers && currentDavServers.length > 0) {
            renderDavUI();
            // fetchWebDavLibrary 内部本身也自带 cachePool 内存缓存，双重秒开！
            if (window.fetchWebDavLibrary) window.fetchWebDavLibrary();
            return;
        }

        // 🌟 2. 内存无数据或触发了强刷：才走网络请求拉取
        optsEl.innerHTML = '<li class="select-option">正在拉取节点...</li>';
        if (mainOptsEl && window.isWebDAVMode) mainOptsEl.innerHTML = '<li class="select-option">拉取中...</li>';

        try {
            const defRes = await fetch('/api/v1/jsplugin/iwebplayer/store?key=webdav_default_server');
            const defJson = await defRes.json();
            webdavDefaultServerName = defJson.data || "";

            const res = await fetch('/api/v1/jsplugin/dav/lists');

            if (!res.ok) {
                const list = document.getElementById('playlist');
                const grid = document.getElementById('playlist-grid');
                if (list) {
                    list.style.display = 'block';
                    const noPluginStr = window.NO_PLUGIN_HTML || '<div style="text-align: center; padding: 40px; color: var(--text-sub); font-size: 14px;">⚠️ 未检测到 WebDAV 插件，请先在主程序中安装并启用。</div>';
                    list.innerHTML = noPluginStr.replace(/LXMusic/gi, 'WebDAV');
                }
                if (grid) grid.style.display = 'none';

                optsEl.innerHTML = '<li class="select-option disabled-text">未启用插件</li>';
                valEl.innerText = "未启用插件";
                if (mainOptsEl && window.isWebDAVMode) {
                    mainOptsEl.innerHTML = '<li class="select-option disabled-text">未启用插件</li>';
                    if (mainValEl) mainValEl.innerText = "未启用插件";
                }
                return;
            }

            currentDavServers = await res.json() || [];
            renderDavUI();
            if (window.fetchWebDavLibrary) window.fetchWebDavLibrary();
        } catch(e) {
            valEl.innerText = "获取失败";
            if (mainValEl && window.isWebDAVMode) mainValEl.innerText = "获取失败";
        }

        // 🌟 核心优化 2：抽离出纯粹的 UI 渲染函数，解耦网络请求
        function renderDavUI() {
            optsEl.innerHTML = '';
            if (mainOptsEl && window.isWebDAVMode) mainOptsEl.innerHTML = '';

            if (currentDavServers.length === 0) {
                optsEl.innerHTML = '<li class="select-option disabled-text">未配置网盘</li>';
                valEl.innerText = "请添加节点"; valEl.dataset.value = "";
                if(btnDefault) { btnDefault.style.background = '#6b7280'; btnDefault.style.color = '#fff'; }
                if (mainOptsEl && window.isWebDAVMode) { mainOptsEl.innerHTML = '<li class="select-option disabled-text">无节点</li>'; if (mainValEl) { mainValEl.innerText = "无节点"; mainValEl.dataset.value = ""; } }
                return;
            }

            if (webdavDefaultServerName) {
                const defIdx = currentDavServers.findIndex(s => s.name === webdavDefaultServerName);
                if (defIdx > 0) { const [defItem] = currentDavServers.splice(defIdx, 1); currentDavServers.unshift(defItem); }
            }

            // 保持当前选中的节点名称，若未选则默认第 1 个
            const activeServerName = window.webdavData.currentServer || (currentDavServers[0] ? currentDavServers[0].name : '');

            currentDavServers.forEach((srv) => {
                const isDefault = (srv.name === webdavDefaultServerName);
                const displayName = isDefault ? `${srv.name} (默认)` : srv.name;
                const isActive = (srv.name === activeServerName);

                const li = document.createElement('li');
                li.className = `select-option ${isActive ? 'active' : ''}`;
                li.dataset.value = srv.name; li.innerText = displayName;

                li.addEventListener('click', (e) => {
                    e.stopPropagation();
                    optsEl.querySelectorAll('.select-option').forEach(el => el.classList.remove('active'));
                    li.classList.add('active');
                    valEl.dataset.value = srv.name; valEl.innerText = displayName; optsEl.classList.remove('show');
                    window.webdavData.currentServer = srv.name; window.updateDefaultBtnUI(srv.name); window.loadWebDavRootPath(srv.name); window.fetchWebDavLibrary();
                    if (mainOptsEl && mainValEl && window.isWebDAVMode) {
                        mainOptsEl.querySelectorAll('.select-option').forEach(el => el.classList.remove('active'));
                        const targetMainLi = mainOptsEl.querySelector(`[data-value="${srv.name}"]`);
                        if (targetMainLi) targetMainLi.classList.add('active');
                        mainValEl.innerText = srv.name; mainValEl.dataset.value = srv.name;
                    }
                });
                optsEl.appendChild(li);

                if (mainOptsEl && window.isWebDAVMode) {
                    const mainLi = document.createElement('li');
                    mainLi.className = `select-option ${isActive ? 'active' : ''}`;
                    mainLi.dataset.value = srv.name; mainLi.innerText = srv.name;

                    mainLi.addEventListener('click', (e) => {
                        e.stopPropagation();
                        mainOptsEl.querySelectorAll('.select-option').forEach(el => el.classList.remove('active'));
                        mainLi.classList.add('active');
                        if (mainValEl) { mainValEl.dataset.value = srv.name; mainValEl.innerText = srv.name; }
                        mainOptsEl.classList.remove('show');
                        window.webdavData.currentServer = srv.name; window.fetchWebDavLibrary();
                        optsEl.querySelectorAll('.select-option').forEach(el => el.classList.remove('active'));
                        const targetModalLi = optsEl.querySelector(`[data-value="${srv.name}"]`);
                        if (targetModalLi) targetModalLi.classList.add('active');
                        valEl.innerText = displayName; valEl.dataset.value = srv.name;
                        window.updateDefaultBtnUI(srv.name); window.loadWebDavRootPath(srv.name);
                    });
                    mainOptsEl.appendChild(mainLi);
                }

                if (isActive) {
                    valEl.dataset.value = srv.name; valEl.innerText = displayName;
                    if (mainValEl && window.isWebDAVMode) { mainValEl.dataset.value = srv.name; mainValEl.innerText = srv.name; }
                    window.webdavData.currentServer = srv.name; window.updateDefaultBtnUI(srv.name); window.loadWebDavRootPath(srv.name);
                }
            });
        }
    };

    window.updateDefaultBtnUI = function(serverName) {
        const btnDefault = document.getElementById('wd-btn-default');
        if (!btnDefault) return;
        if (serverName && serverName === webdavDefaultServerName) {
            btnDefault.style.background = 'var(--primary)'; btnDefault.style.color = '#fff'; btnDefault.title = "当前节点已是默认节点";
        } else {
            btnDefault.style.background = '#6b7280'; btnDefault.style.color = '#fff'; btnDefault.title = "设为默认节点";
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('setting-plugin')?.addEventListener('click', () => { if (typeof window.loadWebDavServers === 'function') window.loadWebDavServers(); });

        const savedEngine = localStorage.getItem('iwebplayer.search_engine');
        if (savedEngine === 'WebDAV') {
            window.isWebDAVMode = true;
            const engineOpts = document.getElementById('engine-opts');
            const engineVal = document.getElementById('engine-val');
            if (engineOpts && engineVal) {
                engineOpts.querySelectorAll('.select-option').forEach(el => el.classList.remove('active'));
                const targetLi = engineOpts.querySelector('[data-value="WebDAV"]');
                if (targetLi) targetLi.classList.add('active');
                engineVal.innerText = 'WebDAV'; engineVal.dataset.value = 'WebDAV';
            }
            document.getElementById('mf-search-main-btns').style.display = 'none';
            document.getElementById('mf-search-input').placeholder = '在当前网盘中极速过滤...';

            // 🌟 修复：首屏直接是 WebDAV 启动时，直接把短线给毙掉
            const shortDivider = document.querySelector('#global-menu-1-wrapper .divider-v');
            if (shortDivider) shortDivider.style.display = 'none';
        }

        const wdServerView = document.getElementById('wd-server-view');
        const wdServerEdit = document.getElementById('wd-server-edit');
        const wdServerDelView = document.getElementById('wd-server-delete-view');
        const wdDirView = document.getElementById('wd-dir-view');
        const wdDirBrowser = document.getElementById('wd-dir-browser');
        const wdServerVal = document.getElementById('wd-server-val');
        const wdDirPath = document.getElementById('wd-dir-path');

        document.addEventListener('click', (e) => { if (!e.target.closest('#wd-server-container')) document.getElementById('wd-server-opts')?.classList.remove('show'); });
        wdServerVal?.addEventListener('click', (e) => { e.stopPropagation(); document.getElementById('wd-server-opts')?.classList.toggle('show'); });

        document.getElementById('wd-btn-add')?.addEventListener('click', () => {
            document.getElementById('wd-edit-name').value = ''; document.getElementById('wd-edit-url').value = ''; document.getElementById('wd-edit-user').value = ''; document.getElementById('wd-edit-pass').value = '';
            wdServerView.style.display = 'none'; wdServerEdit.style.display = 'flex';
        });

        document.getElementById('wd-btn-cancel')?.addEventListener('click', () => { wdServerEdit.style.display = 'none'; wdServerView.style.display = 'flex'; });

        document.getElementById('wd-btn-default')?.addEventListener('click', async (e) => {
            e.stopPropagation(); const curName = wdServerVal.dataset.value; if (!curName || curName === webdavDefaultServerName) return;
            window.showToast("⏳ 正在设定默认节点...");
            await fetch('/api/v1/jsplugin/iwebplayer/store', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'webdav_default_server', value: curName }) });
            window.showToast("✅ 已成功设为默认"); window.loadWebDavServers(true);
        });

        const animWrap = document.getElementById('wd-server-anim-wrap');
        document.getElementById('wd-btn-del')?.addEventListener('click', () => {
            if (!wdServerVal.dataset.value) return;
            if (animWrap) animWrap.style.overflow = 'hidden';
            wdServerDelView.style.display = 'flex'; void wdServerDelView.offsetWidth;
            wdServerView.style.transform = 'translateX(-100%)'; wdServerDelView.style.transform = 'translateX(0)';
            document.getElementById('wd-server-view').parentElement.parentElement.style.background = '#FEF5F5';
        });

        document.getElementById('wd-btn-del-cancel')?.addEventListener('click', () => {
            wdServerView.style.transform = 'translateX(0)'; wdServerDelView.style.transform = 'translateX(100%)';
            document.getElementById('wd-server-view').parentElement.parentElement.style.background = 'var(--card-bg)';
            setTimeout(() => { wdServerDelView.style.display = 'none'; if (animWrap) animWrap.style.overflow = 'visible'; }, 200);
        });

        document.getElementById('wd-btn-del-confirm')?.addEventListener('click', async () => {
            const curName = wdServerVal.dataset.value; if (!curName) return;
            window.showToast("⏳ 彻底移出节点...");
            if (curName === webdavDefaultServerName) {
                await fetch('/api/v1/jsplugin/iwebplayer/store', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'webdav_default_server', value: '' }) });
            }
            await fetch(`/api/v1/jsplugin/dav/lists/${encodeURIComponent(curName)}`, { method: 'DELETE' });
            window.showToast("✅ 已移出");
            wdServerView.style.transform = 'translateX(0)'; wdServerDelView.style.transform = 'translateX(100%)';
            document.getElementById('wd-server-view').parentElement.parentElement.style.background = 'var(--card-bg)';
            setTimeout(() => { wdServerDelView.style.display = 'none'; if (animWrap) animWrap.style.overflow = 'visible'; }, 200);
            window.loadWebDavServers(true);
        });

        document.getElementById('wd-btn-test')?.addEventListener('click', async () => {
            const payload = {
                name: document.getElementById('wd-edit-name').value.trim() || 'test_temp',
                url: document.getElementById('wd-edit-url').value.trim(),
                username: document.getElementById('wd-edit-user').value.trim(),
                password: document.getElementById('wd-edit-pass').value.trim()
            };
            if (!payload.url) { window.showToast("URL 地址不可为空"); return; }
            window.showToast("⏳ 测试通道联通性...");
            try {
                await fetch('/api/v1/jsplugin/dav/lists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                const res = await fetch(`/api/v1/jsplugin/dav/lists/${encodeURIComponent(payload.name)}/items?path=/`);
                if (res.ok) window.showToast("✅ 测试成功，节点联通正常！"); else window.showToast("❌ 握手失败，请重新检查网盘信息");
                if (payload.name === 'test_temp') await fetch(`/api/v1/jsplugin/dav/lists/test_temp`, { method: 'DELETE' });
            } catch(e) { window.showToast("❌ 网络连接异常"); }
        });

        document.getElementById('wd-btn-save')?.addEventListener('click', async () => {
            const payload = {
                name: document.getElementById('wd-edit-name').value.trim(), url: document.getElementById('wd-edit-url').value.trim(),
                username: document.getElementById('wd-edit-user').value.trim(), password: document.getElementById('wd-edit-pass').value.trim()
            };
            if (!payload.name || !payload.url) { window.showToast("别名和 WebDAV 地址为必填项"); return; }
            window.showToast("⏳ 同步至服务器...");
            try {
                await fetch('/api/v1/jsplugin/dav/lists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                window.showToast("🎉 保存成功"); wdServerEdit.style.display = 'none'; wdServerView.style.display = 'flex'; window.loadWebDavServers(true); // 🌟 改为 true 强制刷新
            } catch(e) { window.showToast("❌ 节点数据保存失败"); }
        });

        const renderDirBrowser = async (path) => {
            const curSrv = wdServerVal.dataset.value;
            if (!curSrv) { window.showToast("当前未选中任何活跃网盘"); return; }
            const listEl = document.getElementById('wd-dir-list');
            const breadEl = document.getElementById('wd-dir-breadcrumbs');
            listEl.innerHTML = '<li style="padding: 10px; text-align: center; color: var(--text-sub);">正在拉取网盘目录...</li>';

            if (path === '/') { breadEl.innerHTML = `<span style="cursor:pointer; padding: 2px 4px;" onclick="window._navigateDav('/')">🏠 根目录</span>`; }
            else {
                let parts = path.split('/').filter(Boolean);
                let breadHtml = `<span style="cursor:pointer; padding: 2px 4px;" onclick="window._navigateDav('/')">🏠 根目录</span>`;
                let buildPath = '';
                parts.forEach((p) => { buildPath += '/' + p; breadHtml += `<span style="color: var(--text-sub); margin: 0 4px;">/</span><span style="cursor:pointer; padding: 2px 4px;" onclick="window._navigateDav('${buildPath}')">${p}</span>`; });
                breadEl.innerHTML = breadHtml; setTimeout(() => breadEl.scrollLeft = breadEl.scrollWidth, 50);
            }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            try {
                const res = await fetch(`/api/v1/jsplugin/dav/lists/${encodeURIComponent(curSrv)}/items?path=${encodeURIComponent(path)}`, { signal: controller.signal });
                clearTimeout(timeoutId);
                const items = await res.json();
                listEl.innerHTML = '';
                const dirs = items.filter(i => i.type === 'directory');
                if (dirs.length === 0) { listEl.innerHTML = '<li style="padding: 10px; text-align: center; color: var(--text-sub); font-size: 13px;">该目录下无文件夹子集</li>'; }
                else {
                    dirs.forEach(d => {
                        const li = document.createElement('li');
                        li.style.cssText = 'padding: 10px 14px; border-bottom: 1px solid var(--border); font-size: 14px; color: var(--text-main); cursor: pointer; display: flex; align-items: center; gap: 8px; transition: background 0.2s;';
                        li.onmousedown = () => li.style.background = 'var(--bg-color)'; li.onmouseup = () => li.style.background = 'transparent';
                        li.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="#FACC15"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg><span style="flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${d.name}</span>`;
                        li.addEventListener('click', () => { const nextPath = path === '/' ? '/' + d.name : path + '/' + d.name; currentBrowserPath = nextPath; renderDirBrowser(nextPath); });
                        listEl.appendChild(li);
                    });
                }
            } catch (e) {
                clearTimeout(timeoutId);
                let errMsg = e.name === 'AbortError' ? '拉取网盘目录超时 (15秒)' : '目录树加载失败，请检查网络连接';
                listEl.innerHTML = `<li style="padding: 20px; text-align: center; flex-direction: column; gap: 10px; display: flex; align-items: center; justify-content: center; width: 100%;"><span style="color: #ef4444; font-size: 13px;">${errMsg}</span><button id="wd-btn-dir-retry" class="edit-pl-text-btn" style="background: var(--card-bg); color: var(--primary); border: 1px solid var(--primary); height: 26px; padding: 0 12px; font-size: 12px;">重试刷新</button></li>`;
                document.getElementById('wd-btn-dir-retry')?.addEventListener('click', (e) => { e.stopPropagation(); renderDirBrowser(path); });
            }
        };

        window._navigateDav = function(targetPath) { currentBrowserPath = targetPath; renderDirBrowser(targetPath); };

        document.getElementById('wd-btn-browse')?.addEventListener('click', () => {
            if(!wdServerVal.dataset.value) { window.showToast("请先选择活跃网盘"); return; }
            wdDirView.style.display = 'none'; wdServerView.style.opacity = '0.3'; wdServerView.style.pointerEvents = 'none';
            wdDirBrowser.style.display = 'flex'; currentBrowserPath = wdDirPath.innerText; renderDirBrowser(currentBrowserPath);
        });

        document.getElementById('wd-btn-dir-cancel')?.addEventListener('click', () => {
            wdDirBrowser.style.display = 'none'; wdDirView.style.display = 'flex'; wdServerView.style.opacity = '1'; wdServerView.style.pointerEvents = 'auto';
        });

        document.getElementById('wd-btn-dir-confirm')?.addEventListener('click', async () => {
            const curSrv = wdServerVal.dataset.value;
            if (curSrv) {
                window.showToast("⏳ 正在存盘账本...");
                await fetch('/api/v1/jsplugin/iwebplayer/store', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: `webdav_root_${curSrv}`, value: currentBrowserPath }) });
            }
            wdDirPath.innerText = currentBrowserPath; wdDirBrowser.style.display = 'none'; wdDirView.style.display = 'flex'; wdServerView.style.opacity = '1'; wdServerView.style.pointerEvents = 'auto';
        });

        document.getElementById('btn-webdav-scan')?.addEventListener('click', () => {
            window._tempScanRootPath = wdDirPath.innerText; window.triggerWebDavScan();
        });

        const webdavRadios = document.querySelectorAll('input[name="webdav-mode-radio"]');
        if (webdavRadios.length > 0) {
            const currentMode = localStorage.getItem('iwebplayer.webdav_mode') || 'proxy';
            webdavRadios.forEach(radio => {
                if (radio.value === currentMode) radio.checked = true;
                radio.addEventListener('change', (e) => {
                    if (e.target.checked) {
                        localStorage.setItem('iwebplayer.webdav_mode', e.target.value);
                        if (window.showToast) window.showToast(`✅ 模式已切换为: ${e.target.value === 'proxy' ? '服务端代理' : '直连'}`);
                        // 🌟 用户切换单选框时，实时展现或隐藏链接框
                        if (window.updateWebDavDirectLinkUI) window.updateWebDavDirectLinkUI();
                    }
                });
            });
            // 🌟 首次打开弹窗，初始化渲染一次
            if (window.updateWebDavDirectLinkUI) window.updateWebDavDirectLinkUI();
        }

        const pluginTabs = document.querySelectorAll('.plugin-tab');
        pluginTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                pluginTabs.forEach(t => { t.classList.remove('active'); t.style.fontWeight = '500'; t.style.color = 'var(--text-sub)'; t.style.borderBottomColor = 'transparent'; });
                tab.classList.add('active'); tab.style.fontWeight = 'bold'; tab.style.color = 'var(--primary)'; tab.style.borderBottomColor = 'var(--primary)';
                document.querySelectorAll('.plugin-pane').forEach(p => p.style.display = 'none');
                const targetPane = document.getElementById(tab.dataset.target); if (targetPane) targetPane.style.display = 'block';
            });
        });
        // 🌟 新增：直连一键授权的“弹开与自动关闭”逻辑
        document.getElementById('wd-btn-direct-auth')?.addEventListener('click', (e) => {
            e.preventDefault();
            const hiddenUrlEl = document.getElementById('wd-direct-url-hidden');
            const url = hiddenUrlEl ? hiddenUrlEl.innerText.trim() : '';
            if (!url) return;

            window.showToast("⏳ 正在注入凭证，请勿操作...");
            // 打开一个隐形/极小的新窗口（iPhone上 Safari 可能会开新标签页）
            const authWin = window.open(url, 'WebDAVAuth', 'width=100,height=100,left=-2000,top=-2000');

            // 倒计时 2.5 秒后强行刺杀该窗口
            setTimeout(() => {
                if (authWin && !authWin.closed) {
                    try { authWin.close(); } catch(err) { console.log(err); }
                }
                window.showToast("✅ 直连凭证注入成功！现在可以流畅播放了");
            }, 2500);
        });
    });

})(window);