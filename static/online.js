// static/online.js
(function(window) {
    'use strict';

    // ==========================================
    // 1. 内部私有变量 (保护翻页状态不被外部污染)
    // ==========================================
    let currentSearchPage = 1;
    let isFetchingOnline = false;
    let hasMoreOnlineSearch = true;
    let onlineMusicItems = [];

    let currentLxPlaylistPage = 1;
    let isFetchingLxPlaylists = false;
    let hasMoreLxPlaylists = true;

    window.currentOnlineView = 'song'; // 'song'(搜歌) 或 'detail'(歌单详情) 或 'playlist'(海报墙)

    // ==========================================
    // 2. 历史记录与管家引擎
    // ==========================================
    window.saveSearchHistory = function(item) {
        let history = JSON.parse(localStorage.getItem('iwebplayer.search_history') || '[]');
        history = history.filter(h => {
            if (item.type === 'keyword' && h.type === 'keyword') return h.text !== item.text;
            if (item.type === 'playlist' && h.type === 'playlist') return h.id !== item.id;
            return true;
        });
        history.unshift(item);
        if (history.length > 10) history = history.slice(0, 10);
        localStorage.setItem('iwebplayer.search_history', JSON.stringify(history));
    };

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
        const history = JSON.parse(localStorage.getItem('iwebplayer.search_history') || '[]');
        if (history.length === 0) {
            popup.innerHTML = '<li class="select-option" style="color: var(--text-sub); justify-content: center; font-size: 13px; pointer-events: none;">暂无搜索历史</li>';
            return;
        }

        // 🌟 修改点：低调的右上角“收起”横条
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

        const listHtml = history.map((item, idx) => {
            if (item.type === 'keyword') {
                return `<li class="select-option" data-idx="${idx}" style="justify-content: space-between;"><div class="flex-y-center" style="min-width: 0;"><svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px; opacity:0.6; flex-shrink:0;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg><span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.text}</span></div></li>`;
            } else {
                const platformName = window.PLATFORM_MAP ? (window.PLATFORM_MAP[item.platform] || item.platform) : item.platform;
                return `<li class="select-option" data-idx="${idx}">
                    <div class="flex-y-center" style="min-width: 0;">
                        ${window.SVG_ICONS.lx_plugin_line}
                        <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.name} <span style="color: var(--text-sub); font-size: 13px;">(${platformName})</span></span>
                    </div>
                </li>`;
            }
        }).join('');

        popup.innerHTML = closeBarHtml + listHtml; // 🌟 拼合

        popup.querySelectorAll('.select-option').forEach(li => {
            li.addEventListener('click', (e) => {
                e.stopPropagation();
                const record = history[parseInt(li.dataset.idx)];
                popup.style.display = 'none';
                const searchInput = document.getElementById('mf-search-input');
                if (record.type === 'keyword') {
                    if (searchInput) searchInput.value = record.text;
                    const valEngine = document.getElementById('engine-val');
                    const valPlatform = document.getElementById('mf-plugin-val');
                    if (valEngine) { valEngine.dataset.value = record.engine; valEngine.innerText = record.engine; }
                    if (valPlatform && window.PLATFORM_MAP) { valPlatform.dataset.value = record.platform; valPlatform.innerText = window.PLATFORM_MAP[record.platform] || record.platform; }

                    if (record.action === 'playlist') {
                        if (typeof window.doLxPlaylistSearch === 'function') window.doLxPlaylistSearch(false);
                    } else {
                        if (typeof window.doOnlineSearch === 'function') window.doOnlineSearch(false);
                    }
                } else if (record.type === 'playlist') {
                    if (typeof window.triggerPlaylistDetail === 'function') window.triggerPlaylistDetail(record.id, record.name, record.platform, true);
                }
            });
        });
    };

    window.getOnlineState = function() {
        try { return JSON.parse(localStorage.getItem('iwebplayer.online_state') || '{"view":"song","keyword":""}'); }
        catch(e) { return {"view":"song","keyword":""}; }
    };
    window.setOnlineState = function(state) {
        let current = window.getOnlineState();
        Object.assign(current, state);
        localStorage.setItem('iwebplayer.online_state', JSON.stringify(current));
    };
    window.restoreOnlineView = async function() {
        const oState = window.getOnlineState();
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

        let isPluginActive = true;
        try { const res = await fetch('/api/v1/jsplugin/lxmusic/api/sources'); if (!res.ok) isPluginActive = false; }
        catch (err) { isPluginActive = false; }

        if (!isPluginActive) {
            if (list) list.style.display = 'block';
            if (grid) grid.style.display = 'none';
            if (list) list.innerHTML = window.NO_PLUGIN_HTML;
            return;
        }

        if (oState.view === 'song') {
            mfSearchInput.value = oState.keyword || '';
            mfSearchInput.placeholder = '搜全网资源...';
            if (mfSearchMainBtns) mfSearchMainBtns.style.display = 'flex';
            if (mfSearchBackBtn) mfSearchBackBtn.style.display = 'none';
            if (shortDivider) shortDivider.style.display = '';

            grid.style.display = 'none';
            list.style.display = 'block';

            window.songList = window.getMergedSongList('在线资源');
            if (window.songList.length === 0) {
                if (oState.keyword) {
                    window.doOnlineSearch(false);
                } else {
                    list.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-sub); font-size: 14px;">请在上方输入关键词搜索全网音乐或歌单</div>';
                }
            } else {
                window.renderPlaylist();
            }
        }
        else if (oState.view === 'playlist') {
            mfSearchInput.value = oState.keyword || '';
            mfSearchInput.placeholder = '搜全网资源...';
            if (mfSearchMainBtns) mfSearchMainBtns.style.display = 'flex';
            if (mfSearchBackBtn) mfSearchBackBtn.style.display = 'none';
            if (shortDivider) shortDivider.style.display = '';

            list.style.display = 'none';
            grid.style.display = 'grid';

            if (!grid.querySelector('.pl-card-b')) {
                if (oState.keyword) {
                    window.doLxPlaylistSearch(false);
                } else {
                    grid.innerHTML = '<div style="text-align: center; padding: 60px; color: var(--text-sub); font-size: 14px; grid-column: 1 / -1;">请在上方输入关键词搜索全网音乐或歌单</div>';
                }
            }
        }
        else if (oState.view === 'detail') {
            if (oState.detail_id && oState.detail_name && oState.detail_source) {
                window._lastOnlineKeyword = oState.keyword;
                window.triggerPlaylistDetail(oState.detail_id, oState.detail_name, oState.detail_source, false);
            } else {
                window.setOnlineState({ view: 'song' });
                window.restoreOnlineView();
            }
        }
    };

    // ==========================================
    // 3. 全网搜索请求引擎 (歌曲)
    // ==========================================
    window.doOnlineSearch = async function(isLoadMore = false) {
        const keyword = document.getElementById('mf-search-input').value.trim();
        if (!keyword) { window.showToast("请输入要搜索的歌曲关键词"); return; }

        if (!isLoadMore) {
            document.getElementById('mf-search-input').blur();
            currentSearchPage = 1;
            hasMoreOnlineSearch = true;
            window.songList = [];
            onlineMusicItems = [];
            window.currentOnlineView = 'song';

            const grid = document.getElementById('playlist-grid');
            const list = document.getElementById('playlist');
            if (grid) grid.style.display = 'none';
            if (list) {
                list.style.display = 'block';
                list.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-sub); font-size: 14px;">正在全网抓取歌曲，请稍候...</div>';
            }
        } else {
            if (isFetchingOnline || !hasMoreOnlineSearch) return;
            currentSearchPage++;
        }

        isFetchingOnline = true;
        const currentEngine = document.getElementById('engine-val').dataset.value;
        const selectedSource = document.getElementById('mf-plugin-val').dataset.value;

        try {
            if (currentEngine === 'LXMusic') {
                const lxUrl = `/api/v1/jsplugin/lxmusic/api/search`;
                const payload = {
                    keyword: keyword,
                    source_id: selectedSource,
                    type: "song",
                    page: currentSearchPage,
                    page_size: 30
                };

                const response = await fetch(lxUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const resJson = await response.json();

                if (resJson.code === 0 && resJson.data && resJson.data.list && resJson.data.list.length > 0) {
                    if (!isLoadMore && typeof window.saveSearchHistory === 'function') {
                          window.saveSearchHistory({ type: 'keyword', text: keyword, engine: currentEngine, platform: selectedSource, action: 'song' });
                          window.setOnlineState({ view: 'song', keyword: keyword });
                      }
                    const mappedItems = resJson.data.list.map(item => {
                        return {
                            id: item.songmid || item.musicId,
                            title: item.name || "未知歌曲",
                            artist: item.singer || "未知歌手",
                            album: item.album || "",
                            duration: item.duration || 0,
                            cover_url: item.img || null,
                            _scrapedCover: item.img || null,
                            _isOnlineObj: true,
                            source_data: item
                        };
                    });

                    if (isLoadMore) {
                        onlineMusicItems = [...onlineMusicItems, ...mappedItems];
                    } else {
                        onlineMusicItems = mappedItems;
                    }

                    window.songList = [...onlineMusicItems];
                    window.allPlaylists['在线资源'] = window.songList;

                    if (window.songList.length >= 500) {
                        hasMoreOnlineSearch = false;
                    }

                    window.renderPlaylist();
                    const text = window.formatPlaylistText('在线资源', window.songList.length);
                    document.getElementById('playlist-val').innerHTML = text;
                } else {
                    if (!isLoadMore) {
                        document.getElementById('playlist').innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-sub); font-size: 14px;">未找到相关歌曲，换个词或换个源试试吧</div>`;
                    } else {
                        hasMoreOnlineSearch = false;
                        window.showToast("已经是最后一页啦");
                    }
                }
            } else {
               window.showToast("MusicFree 暂未实装");
            }
        } catch (error) {
            if (!isLoadMore) {
                document.getElementById('playlist').innerHTML = window.NO_PLUGIN_HTML;
            } else {
                currentSearchPage--;
                window.showToast("加载下一页失败，请检查网络");
            }
        } finally {
            isFetchingOnline = false;
        }
    };

    // ==========================================
    // 4. 全网搜索请求引擎 (歌单海报)
    // ==========================================
    window.doLxPlaylistSearch = async function(isLoadMore = false) {
        const keyword = document.getElementById('mf-search-input').value.trim();
        if (!keyword) { window.showToast("请输入要搜索的歌单关键词"); return; }

        const grid = document.getElementById('playlist-grid');
        const list = document.getElementById('playlist');

        if (!isLoadMore) {
            document.getElementById('mf-search-input').blur();
            currentLxPlaylistPage = 1;
            hasMoreLxPlaylists = true;

            list.style.display = 'none';
            grid.style.display = 'grid';
            grid.innerHTML = `<div style="text-align: center; padding: 60px; color: var(--text-sub); font-size: 14px; grid-column: 1 / -1;">正在拉取歌单海报...</div>`;
        } else {
            if (isFetchingLxPlaylists || !hasMoreLxPlaylists) return;
            currentLxPlaylistPage++;
        }

        isFetchingLxPlaylists = true;
        const selectedSource = document.getElementById('mf-plugin-val').dataset.value;

        try {
            const reqUrl = `/api/v1/jsplugin/lxmusic/api/songlist/search?source_id=${selectedSource}&keyword=${encodeURIComponent(keyword)}&page=${currentLxPlaylistPage}&limit=30`;
            const res = await fetch(reqUrl);
            const resJson = await res.json();

            if (resJson.code === 0 && resJson.data && resJson.data.list && resJson.data.list.length > 0) {
                if (!isLoadMore && typeof window.saveSearchHistory === 'function') {
                    window.saveSearchHistory({ type: 'keyword', text: keyword, engine: 'LXMusic', platform: selectedSource, action: 'playlist' });
                    window.setOnlineState({ view: 'playlist', keyword: keyword });
                }

                const targetList = resJson.data.list;

                if (!isLoadMore) grid.innerHTML = '';

                const html = targetList.map(item => {
                    const rawName = item.name || '未知歌单';
                    const mainName = rawName.split(/\||｜/)[0];
                    const subName = item.author || '';
                    const playCount = item.play_count || '0';
                    const songCountHtml = item.total ? `<div class="pl-time">共 ${item.total} 首</div>` : '';
                    const coverImg = item.img || '';

                    return `
                    <div class="pl-card-b" onclick="window.triggerPlaylistDetail('${item.id}', '${mainName.replace(/'/g,"\\'")}', '${selectedSource}')">
                      <img src="${coverImg}" alt="cover" loading="lazy" onerror="this.src=window.defaultCover">
                      <div class="pl-overlay">
                        <div class="pl-name">${mainName}${subName ? '<br>'+subName : ''}</div>
                        ${songCountHtml}
                      </div>
                      <div class="pl-playcount">
                        <svg viewBox="0 0 24 24" width="9" height="9" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path></svg> ${playCount}
                      </div>
                    </div>`;
                }).join('');

                grid.insertAdjacentHTML('beforeend', html);

                if (targetList.length < 20) {
                    hasMoreLxPlaylists = false;
                }
            } else {
                if (!isLoadMore) {
                    grid.innerHTML = '<div style="text-align: center; padding: 60px; color: var(--text-sub); font-size: 14px; grid-column: 1 / -1;">未找到相关歌单</div>';
                } else {
                    hasMoreLxPlaylists = false;
                    window.showToast("已经是最后一页啦");
                }
            }
        } catch(e) {
            if (!isLoadMore) {
                grid.innerHTML = window.NO_PLUGIN_HTML;
            } else {
                currentLxPlaylistPage--;
                window.showToast("加载下一页失败，请检查网络");
            }
        } finally {
            isFetchingLxPlaylists = false;
        }
    };

    // ==========================================
    // 5. 歌单详情触发器
    // ==========================================
    window.triggerPlaylistDetail = async function(id, name, source, isFromHistory = false) {
        const oState = window.getOnlineState();

        if (!isFromHistory) {
            window._gridScrollY = window.scrollY || document.documentElement.scrollTop;
            window.setOnlineState({
                view: 'detail', detail_id: id, detail_name: name, detail_source: source,
                keyword: window._lastOnlineKeyword || oState.keyword || ''
            });
        }

        document.getElementById('search-input').blur();
        window.currentOnlineView = 'detail';

        if (typeof window.saveSearchHistory === 'function') {
              window.saveSearchHistory({ type: 'playlist', id: id, name: name, engine: 'LXMusic', platform: source });
        }

        const grid = document.getElementById('playlist-grid');
        const list = document.getElementById('playlist');
        grid.style.display = 'none';
        list.style.display = 'block';
        list.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-sub); font-size: 14px;">正在获取歌单详情...</div>';

        document.getElementById('mf-search-main-btns').style.display = 'none';
        document.querySelector('.search-text-group').style.borderLeft = '';

        const shortDivider = document.querySelector('#global-menu-1-wrapper .divider-v');
        if (isFromHistory) {
            document.getElementById('mf-search-back-btn').style.display = 'none';
            if (shortDivider) shortDivider.style.display = 'none';
        } else {
            document.getElementById('mf-search-back-btn').style.display = 'block';
            if (shortDivider) shortDivider.style.display = '';
        }

        const oldIcon = document.getElementById('mf-search-pl-icon');
        if (oldIcon) oldIcon.remove();
        const iconSpan = document.createElement('span');
        iconSpan.id = 'mf-search-pl-icon';
        iconSpan.innerHTML = window.SVG_ICONS.lx_plugin_line;
        const mfSearchInputEl = document.getElementById('mf-search-input');
        if (mfSearchInputEl) {
            if (!isFromHistory) {
                window._lastOnlineKeyword = mfSearchInputEl.value || oState.keyword || '';
            }
            mfSearchInputEl.parentNode.insertBefore(iconSpan, mfSearchInputEl);
            mfSearchInputEl.value = name;
            mfSearchInputEl.placeholder = '';
            mfSearchInputEl.dataset.isTitleMode = "true";
            mfSearchInputEl.dataset.hasBackBtn = isFromHistory ? "false" : "true";
        }

        if (!isFromHistory) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        try {
            const reqUrl = `/api/v1/jsplugin/lxmusic/api/songlist/detail?source_id=${source}&id=${id}&page=1`;
            const res = await fetch(reqUrl);
            const resJson = await res.json();

            if (resJson.code === 0 && resJson.data && resJson.data.list && resJson.data.list.length > 0) {
                window.songList = resJson.data.list.map(item => {
                    return {
                        id: item.songmid || item.musicId,
                        title: item.name || "未知歌曲",
                        artist: item.singer || "未知歌手",
                        album: item.album || "",
                        duration: item.duration || 0,
                        cover_url: item.img || null,
                        _scrapedCover: item.img || null,
                        _isOnlineObj: true,
                        source_data: item
                    };
                });

                window.allPlaylists['在线资源'] = window.songList;
                window.renderPlaylist();

                if (typeof window.formatPlaylistTextWithTags === 'function') {
                    document.getElementById('playlist-val').innerHTML = window.formatPlaylistTextWithTags('在线资源', window.songList.length);
                } else {
                    document.getElementById('playlist-val').innerHTML = `在线资源 (${window.songList.length})`;
                }
            } else {
                list.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-sub); font-size: 14px;">获取失败: 该歌单为空或接口异常</div>`;
            }
        } catch(e) {
            list.innerHTML = window.NO_PLUGIN_HTML;
        }
    };

    // ==========================================
    // 6. 独立接管：在线资源的滚动翻页事件
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
                if (!isFetchingOnline && hasMoreOnlineSearch) {
                    window.doOnlineSearch(true);
                }
            }
            else if (grid && grid.style.display !== 'none') {
                if (!isFetchingLxPlaylists && hasMoreLxPlaylists) {
                    window.doLxPlaylistSearch(true);
                }
            }
        }
    }, { passive: true });

})(window);