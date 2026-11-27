// static/sort.js
(function(window) {
    'use strict';

    window.SortEngine = {
        isActive: false,
        dragEl: null,
        placeholder: null,
        touchStartY: 0,
        elStartY: 0,
        listRect: null,
        scrollRaf: null,
        isPaused: false,

        // ==========================================
        // 🛠️ 1. 核心控制器：初始化所有排序相关的 UI 绑定
        // ==========================================
        init: function() {
            const menuSortPlaylist = document.getElementById('menu-sort-playlist');
            const sortToolbar = document.getElementById('playlist-sort-toolbar');
            const sortBtns = document.querySelectorAll('#playlist-sort-toolbar .sort-btn');

            if (!menuSortPlaylist || !sortToolbar || !sortBtns.length) return;

            // 🌟 修复 Bug 1：防止首屏加载不触发
            setTimeout(() => {
                if (window.currentPlaylist) {
                    this.resetStateOnPlaylistChange(window.currentPlaylist);
                }
            }, 800);

            if (!window._sortEngineRenderHooked && typeof window.renderPlaylist === 'function') {
                const originalRender = window.renderPlaylist;
                window.renderPlaylist = function() {
                    originalRender.apply(this, arguments);
                    if (window.currentPlaylist === '在线资源') {
                        setTimeout(() => {
                            // 🌟 核心护盾：如果排序工具栏正开着（说明用户正在连续点按钮），绝对不能洗白！
                            const sortToolbar = document.getElementById('playlist-sort-toolbar');
                            if (sortToolbar && sortToolbar.style.display === 'flex') return;

                            if (window.SortEngine) window.SortEngine.resetStateOnPlaylistChange('在线资源');
                        }, 50);
                    }
                };
                window._sortEngineRenderHooked = true;
            }

            // 1. 绑定下拉菜单开关
            menuSortPlaylist.addEventListener('click', (e) => {
                e.stopPropagation();
                document.getElementById('global-menu-1-opts')?.classList.remove('show');

                const isShown = sortToolbar.style.display === 'flex';

                // 🌟 动态拦截：严格审查当前是否为虚拟歌单，强行隐藏特殊按钮
                const isVirtual = ['所有歌曲', '在线资源', '曲库搜索'].includes(window.currentPlaylist);
                const manualBtn = document.querySelector('.sort-btn[data-type="manual"]');
                const numberBtn = document.querySelector('.sort-btn[data-type="number"]');
                if (manualBtn) manualBtn.style.display = isVirtual ? 'none' : 'flex';
                if (numberBtn) numberBtn.style.display = isVirtual ? 'none' : 'flex';

                // 🌟 动态拦截 2：LXMusic 干掉“名称”和“最近”；WebDAV 干掉“最近”
                const isLxOnline = (window.currentPlaylist === '在线资源' && window.PluginManager?.currentEngineName === 'LXMusic');
                const isDavOnline = (window.currentPlaylist === '在线资源' && window.PluginManager?.currentEngineName === 'WebDAV');
                const nameBtn = document.querySelector('.sort-btn[data-type="name"]');
                const recentBtn = document.querySelector('.sort-btn[data-type="recent"]');
                if (nameBtn) nameBtn.style.display = isLxOnline ? 'none' : 'flex';
                if (recentBtn) recentBtn.style.display = (isLxOnline || isDavOnline) ? 'none' : 'flex';

                if (isShown) {
                    sortToolbar.style.display = 'none';
                    menuSortPlaylist.style.color = '';
                    menuSortPlaylist.style.fontWeight = 'normal';

                    if (this.isActive) {
                        this.isPaused = false;
                        this.isActive = false;
                        document.body.classList.remove('manual-sort-mode');
                        if (typeof this.unbindEvents === 'function') this.unbindEvents();

                        if (manualBtn) manualBtn.classList.remove('active');
                    }
                } else {
                    sortToolbar.style.display = 'flex';
                    menuSortPlaylist.style.color = 'var(--primary)';
                    menuSortPlaylist.style.fontWeight = 'bold';

                    // 🌟 满足需求：每次新开排序，强行洗白所有按钮，不留任何标红！
                    sortBtns.forEach(btn => {
                        if (btn.dataset.type === 'manual') return;
                        delete btn.dataset.order;
                        btn.classList.remove('active');
                        const arrowEl = btn.querySelector('.sort-arrow');
                        if (arrowEl) arrowEl.textContent = '';
                    });
                }
            });

            // 2. 绑定排序按钮点击事件
            sortBtns.forEach(btn => {
                btn.addEventListener('click', async () => {
                    const type = btn.dataset.type;
                    const isManual = (type === 'manual');
                    const isClientSide = (type === 'song' || type === 'artist' || type === 'recent');
                    const isServerSide = (type === 'name' || type === 'number' || type === 'random');

                    if (isManual) {
                        this.toggleManualMode();
                        if (this.isActive) {
                            btn.classList.add('active');
                            sortBtns.forEach(el => {
                                if (el.dataset.type !== 'manual') {
                                    el.classList.remove('active');
                                    delete el.dataset.order;
                                    const arrowEl = el.querySelector('.sort-arrow');
                                    if (arrowEl) arrowEl.textContent = '';
                                }
                            });
                        } else {
                            btn.classList.remove('active');
                        }
                        return;
                    }

                    if (this.isActive) {
                        this.toggleManualMode();
                        const manualBtn = document.querySelector('.sort-btn[data-type="manual"]');
                        if (manualBtn) manualBtn.classList.remove('active');
                    }

                    // 🌟 1. 核心判断：在清空所有高亮之前，先记住当前点击的按钮，原本是不是已经被点亮了？
                    const wasActive = btn.classList.contains('active');

                    sortBtns.forEach(el => {
                        if (el.dataset.type !== 'manual') el.classList.remove('active');
                    });
                    btn.classList.add('active');
                    sortBtns.forEach(el => {
                        const arrow = el.querySelector('.sort-arrow');
                        if (arrow) arrow.innerHTML = '';
                    });

                    const isVirtual = ['所有歌曲', '在线资源', '曲库搜索'].includes(window.currentPlaylist);
                    const pl = window.playlistMeta?.find(p => p.name === window.currentPlaylist);
                    if (!isVirtual && (!pl || !pl.id)) { btn.classList.remove('active'); return; }

                    let finalAction = '';
                    if (type === 'name' || type === 'song' || type === 'artist' || type === 'recent') {

                        // 🌟 2. 智能升降序逻辑：如果是“陌生点击”（切过来的），强制给升序 asc
                        // 如果是连续点击同一个按钮，才执行翻转！
                        let newOrder = 'asc';
                        if (wasActive) {
                            const currentOrder = btn.dataset.order || 'asc';
                            newOrder = (currentOrder === 'asc') ? 'desc' : 'asc';
                        }

                        btn.dataset.order = newOrder;
                        const arrowEl = btn.querySelector('.sort-arrow');
                        if (arrowEl) arrowEl.textContent = newOrder === 'asc' ? '↑' : '↓';

                        finalAction = type === 'name' ? `name_${newOrder}` :
                                      type === 'song' ? `song_${newOrder}` :
                                      type === 'artist' ? `artist_${newOrder}` : `recent_${newOrder}`;
                    } else if (type === 'number') {
                        finalAction = 'number_prefix';
                    } else if (type === 'random') {
                        finalAction = 'shuffle';
                    }

                    // 🌟 拦截 1：虚拟歌单的纯内存排序处理
                    if (isVirtual) {
                        this.executeVirtualPlaylistSort(window.currentPlaylist, type, btn);
                        return;
                    }

                    // 拦截 2：真实歌单的纯前端排序
                    if (isClientSide) {
                        this.executeClientSideSort(pl, type, btn);
                        return;
                    }

                    // 拦截 3：真实歌单的后端排序
                    if (isServerSide) {
                        this.executeServerSideSort(pl, finalAction, btn);
                    }
                });
            });
        },

        // ==========================================
        // 🛠️ 2. 状态重置引擎 (供外部切换歌单时调用)
        // ==========================================
        resetStateOnPlaylistChange: function(playlistName) {
            if (!playlistName) return;

            const menuSortPlaylist = document.getElementById('menu-sort-playlist');
            const sortToolbar = document.getElementById('playlist-sort-toolbar');
            const sortBtns = document.querySelectorAll('#playlist-sort-toolbar .sort-btn');

            const systemBasics = ['我的歌单', '下载', '最近新增', '所有电台', '曲库搜索', 'cache_songs', '电台收藏'];
            let disableSort = systemBasics.includes(playlistName);

            // 🌟 动态拦截：在线资源显示海报墙歌单时，强制当做不支持排序处理（收起且隐藏工具栏）
            if (playlistName === '在线资源' && window.currentOnlineView === 'playlist') {
                disableSort = true;
            }
            if (disableSort) {
                if (menuSortPlaylist) menuSortPlaylist.style.display = 'none';
                if (sortToolbar) sortToolbar.style.display = 'none';

                if (this.isActive) {
                    this.isPaused = true;
                    this.isActive = false;
                    document.body.classList.remove('manual-sort-mode');
                    if (typeof this.unbindEvents === 'function') this.unbindEvents();

                    const manualBtn = document.querySelector('.sort-btn[data-type="manual"]');
                    if (manualBtn) manualBtn.classList.remove('active');
                }
            } else {
                if (menuSortPlaylist) {
                    menuSortPlaylist.style.display = 'flex';
                    if (menuSortPlaylist.style.fontWeight === 'bold') {
                        if (sortToolbar) sortToolbar.style.display = 'flex';
                    }
                }

                if (this.isPaused) {
                    this.isPaused = false;
                    if (!this.isActive) {
                        this.isActive = true;
                        document.body.classList.add('manual-sort-mode');
                        if (typeof this.bindEvents === 'function') this.bindEvents();

                        const manualBtn = document.querySelector('.sort-btn[data-type="manual"]');
                        if (manualBtn) manualBtn.classList.add('active');
                    }
                }
            }

            const isVirtual = ['所有歌曲', '在线资源', '曲库搜索'].includes(playlistName);
            const manualBtn = document.querySelector('.sort-btn[data-type="manual"]');
            const numberBtn = document.querySelector('.sort-btn[data-type="number"]');
            const nameBtn = document.querySelector('.sort-btn[data-type="name"]');
            const recentBtn = document.querySelector('.sort-btn[data-type="recent"]');
            if (manualBtn) manualBtn.style.display = isVirtual ? 'none' : 'flex';
            if (numberBtn) numberBtn.style.display = isVirtual ? 'none' : 'flex';

            // 🌟 针对 LXMusic 隐藏名称与最近；针对 WebDAV 隐藏最近
            const isLxOnline = (playlistName === '在线资源' && window.PluginManager?.currentEngineName === 'LXMusic');
            const isDavOnline = (playlistName === '在线资源' && window.PluginManager?.currentEngineName === 'WebDAV');
            if (nameBtn) nameBtn.style.display = isLxOnline ? 'none' : 'flex';
            if (recentBtn) recentBtn.style.display = (isLxOnline || isDavOnline) ? 'none' : 'flex';

            sortBtns.forEach(btn => {
                if (btn.dataset.type === 'manual') return;

                // 直接无脑洗白，不再读取 localStorage，也不再恢复 active 状态
                delete btn.dataset.order;
                btn.classList.remove('active');
                const arrowEl = btn.querySelector('.sort-arrow');
                if (arrowEl) arrowEl.textContent = '';
            });

            setTimeout(() => {
                if (this.isActive) {
                    this.injectHandles();
                }
            }, 100);
        },

        // ==========================================
        // 🚀 3. 排序策略分发中心
        // ==========================================

        // 🌟 纯静默 DOM 过滤补偿 (绝不触碰任何外层UI动画)
        applySilentFilter: function() {
            const isOnline = ['在线资源'].includes(window.currentPlaylist);
            const inputId = isOnline ? 'online-filter-input' : 'local-filter-input';
            const inputEl = document.getElementById(inputId);
            if (!inputEl) return;
            const keyword = inputEl.value.trim().toLowerCase();
            if (keyword) {
                document.querySelectorAll('#playlist .song-item').forEach(li => {
                    const text = li.innerText.toLowerCase();
                    li.style.display = text.includes(keyword) ? 'flex' : 'none';
                });
            }
        },

        // 🌟 3.1 虚拟歌单专属：全内存排序与本地偏好保存
        executeVirtualPlaylistSort: function(plName, type, btn) {
            window.showToast(`⏳ 正在排序...`, true);
            const sortToolbar = document.getElementById('playlist-sort-toolbar');
            if (sortToolbar) sortToolbar.style.pointerEvents = 'none';

            // 🌟 排序前，先将列表瞬间透明，掩盖全量渲染导致的“过滤失效闪烁”
            const playlistEl = document.getElementById('playlist');
            if (playlistEl) {
                playlistEl.style.transition = 'none';
                playlistEl.style.opacity = '0';
            }

            requestAnimationFrame(() => {
                setTimeout(() => {
                    const order = btn.dataset.order || 'desc';
                    const currentSongs = window.allPlaylists[plName] || [];
                    const isDavOnline = (plName === '在线资源' && window.PluginManager?.currentEngineName === 'WebDAV');
                    let missingCount = 0;
                    let missingType = '';

                    const cleanArtist = (v) => {
                        const s = v ? String(v).trim() : '';
                        return (s === '未知歌手' || s === '未知') ? '' : s;
                    };
                    const getTargetFileName = (s) => {
                        if (isDavOnline) {
                            const rawId = s?.id ? String(s.id).trim() : '';
                            if (!rawId || rawId.startsWith('dav_temp_')) return '';
                            return rawId.split('/').pop() || '';
                        }
                        return s?.file_path ? String(s.file_path).split('/').pop() : '';
                    };

                    if (type === 'random') {
                        // 纯粹打乱
                        for (let i = currentSongs.length - 1; i > 0; i--) {
                            const j = Math.floor(Math.random() * (i + 1));
                            [currentSongs[i], currentSongs[j]] = [currentSongs[j], currentSongs[i]];
                        }
                    } else {
                        currentSongs.sort((a, b) => {
                            let valA, valB;
                            if (type === 'name') {
                                valA = getTargetFileName(a);
                                valB = getTargetFileName(b);
                                if (!valA && valB) return 1;
                                if (valA && !valB) return -1;
                                if (!valA && !valB) return 0;
                            } else if (type === 'song') {
                                valA = a.title ? String(a.title).trim() : "";
                                valB = b.title ? String(b.title).trim() : "";
                                if (!valA && valB) return 1;
                                if (valA && !valB) return -1;
                                if (!valA && !valB) return 0;
                            } else if (type === 'artist') {
                                valA = cleanArtist(a.artist);
                                valB = cleanArtist(b.artist);
                                // 缺失歌手（含“未知歌手”）统一沉底
                                if (!valA && valB) return 1;
                                if (valA && !valB) return -1;
                                if (!valA && !valB) return 0;
                            } else if (type === 'recent') {
                                valA = a.updated_at ? new Date(a.updated_at).getTime() : 0;
                                valB = b.updated_at ? new Date(b.updated_at).getTime() : 0;
                            }

                            if (type === 'recent') {
                                return order === 'asc' ? valA - valB : valB - valA;
                            } else {
                                return order === 'asc'
                                    ? String(valA).localeCompare(String(valB), 'zh-CN')
                                    : String(valB).localeCompare(String(valA), 'zh-CN');
                            }
                        });
                    }

                    // 统计缺失信息
                    if (type === 'name') {
                        missingCount = currentSongs.filter(s => !getTargetFileName(s)).length;
                        missingType = isDavOnline ? '文件名称' : '本地文件路径';
                    } else if (type === 'song') {
                        missingCount = currentSongs.filter(s => !s.title || String(s.title).trim() === '').length;
                        missingType = '歌曲名称';
                    } else if (type === 'artist') {
                        missingCount = currentSongs.filter(s => !cleanArtist(s.artist)).length;
                        missingType = '歌手';
                    }

                    // 🌟 保存偏好分流
                    if (plName === '所有歌曲') {
                        let prefs = {};
                        try { prefs = JSON.parse(localStorage.getItem('iwebplayer.virtual_sort_prefs') || '{}'); } catch(e){}
                        prefs['所有歌曲'] = { type: type, order: order };
                        localStorage.setItem('iwebplayer.virtual_sort_prefs', JSON.stringify(prefs));
                    } else if (plName === '在线资源' && window.PluginManager?.currentEngineName === 'LXMusic' && window.currentOnlineView === 'detail') {
                        // 🌟 针对 LXMusic 歌单，将排序结果挂在对应的搜索历史记录里
                        try {
                            const state = window.StateManager.getState();
                            let history = JSON.parse(localStorage.getItem('iwebplayer.search_history') || '[]');
                            const idx = history.findIndex(h => h.type === 'playlist' && (h.id === state.detail_id || h.name === state.detail_name));
                            if (idx !== -1) {
                                history[idx].sort = { type: type, order: order };
                                localStorage.setItem('iwebplayer.search_history', JSON.stringify(history));
                            }
                        } catch(e) {}
                    } else if (isDavOnline && window.currentOnlineView === 'detail' && type !== 'random') {
                        // 🌟 针对 WebDAV 文件夹详情页（非随机、非搜索页）：更新内存曲库并通知后端落盘记录
                        const davId = window.webdavData?.currentServer;
                        const folder = window.StateManager?.getState()?.detail_name;
                        if (davId && folder) {
                            if (window.webdavData.library) window.webdavData.library[folder] = [...currentSongs];
                            if (window.webdavData.cachePool?.[davId]) window.webdavData.cachePool[davId][folder] = [...currentSongs];

                            fetch('/api/v1/jsplugin/iwebplayer/dav/sort', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    davId: davId,
                                    folder: folder,
                                    type: type,
                                    order: order,
                                    sortedIds: currentSongs.map(s => s.id)
                                })
                            }).catch(() => {});
                        }
                    }

                    window.songList = currentSongs;
                    if (typeof window.renderPlaylist === 'function') window.renderPlaylist();

                    // 🌟 纯静默 DOM 过滤补偿
                    setTimeout(() => this.applySilentFilter(), 400);

                    window.scrollTo({ top: 0, behavior: 'smooth' });
                    document.getElementById('scroll-wrapper')?.scrollTo({ top: 0, behavior: 'smooth' });

                    let successMsg = "✅ 排序完成";
                    if (missingCount > 0) {
                        successMsg += `<br><span style="font-size: 12px; opacity: 0.85; font-weight: normal;">有 ${missingCount} 首歌曲缺少${missingType}信息</span>`;
                    }
                    window.showToast(successMsg);

                    if (sortToolbar) sortToolbar.style.pointerEvents = 'auto';
                    if (type === 'random') btn.classList.remove('active');

                    // 🌟 过滤完成后，平滑地淡入显示
                    setTimeout(() => {
                        if (playlistEl) {
                            playlistEl.style.transition = 'opacity 0.25s ease-in';
                            playlistEl.style.opacity = '1';
                        }
                    }, 450);
                }, 150);
            });
        },

        // 🌟 3.2 常规歌单：纯前端排序
        executeClientSideSort: function(pl, type, btn) {
            const plName = window.currentPlaylist;
            if (!plName || !window.allPlaylists[plName]) return;

            const typeName = type === 'song' ? '歌曲' : type === 'artist' ? '歌手' : '最近添加';
            window.showToast(`⏳ 正在按${typeName}排序...`, true);

            const sortToolbar = document.getElementById('playlist-sort-toolbar');
            if (sortToolbar) sortToolbar.style.pointerEvents = 'none';

            const playlistEl = document.getElementById('playlist');
            if (playlistEl) {
                playlistEl.style.transition = 'none';
                playlistEl.style.opacity = '0';
            }

            requestAnimationFrame(() => {
                setTimeout(() => {
                    const order = btn.dataset.order;
                    const currentSongs = window.allPlaylists[plName];

                    currentSongs.sort((a, b) => {
                        let valA, valB;
                        if (type === 'song') {
                            valA = a.title || "";
                            valB = b.title || "";
                        } else if (type === 'artist') {
                            valA = a.artist || "";
                            valB = b.artist || "";
                        } else if (type === 'recent') {
                            valA = a.updated_at ? new Date(a.updated_at).getTime() : 0;
                            valB = b.updated_at ? new Date(b.updated_at).getTime() : 0;
                        }

                        if (type === 'recent') {
                            return order === 'asc' ? valA - valB : valB - valA;
                        } else {
                            return order === 'asc'
                                ? String(valA).localeCompare(String(valB), 'zh-CN')
                                : String(valB).localeCompare(String(valA), 'zh-CN');
                        }
                    });

                    if (typeof window.renderPlaylist === 'function') window.renderPlaylist();

                    // 🌟 纯静默 DOM 过滤补偿
                    setTimeout(() => this.applySilentFilter(), 400);

                    window.scrollTo({ top: 0, behavior: 'smooth' });
                    document.getElementById('scroll-wrapper')?.scrollTo({ top: 0, behavior: 'smooth' });

                    let missingCount = 0;
                    let missingType = '';
                    if (type === 'song') {
                        missingCount = currentSongs.filter(s => !s.title || String(s.title).trim() === '').length;
                        missingType = '歌曲名称';
                    } else if (type === 'artist') {
                        missingCount = currentSongs.filter(s => !s.artist || String(s.artist).trim() === '').length;
                        missingType = '歌手';
                    }

                    let successMsg = "✅ 排序完成";
                    if (missingCount > 0) {
                        successMsg += `<br><span style="font-size: 12px; opacity: 0.85; font-weight: normal;">有 ${missingCount} 首歌曲缺少${missingType}信息</span>`;
                    }
                    window.showToast(successMsg);

                    const sortedIds = currentSongs.map(s => s.id);
                    fetch(`/api/v1/playlists/${pl.id}/songs/reorder`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ song_ids: sortedIds })
                    }).then(res => {
                        if (!res.ok) window.showToast("⚠️ 排序结果云端保存失败");
                    }).catch(err => console.error("批量排序提交异常:", err));

                    if (sortToolbar) sortToolbar.style.pointerEvents = 'auto';

                    setTimeout(() => {
                        if (playlistEl) {
                            playlistEl.style.transition = 'opacity 0.25s ease-in';
                            playlistEl.style.opacity = '1';
                        }
                    }, 450);

                }, 150);
            });
        },

        // 🌟 3.3 常规歌单：后端排序
        executeServerSideSort: async function(pl, finalAction, btn) {
            window.showToast("⏳ 正在重新排序...", true);
            const sortToolbar = document.getElementById('playlist-sort-toolbar');
            if (sortToolbar) sortToolbar.style.pointerEvents = 'none';

            const playlistEl = document.getElementById('playlist');
            if (playlistEl) {
                playlistEl.style.transition = 'none';
                playlistEl.style.opacity = '0';
            }

            try {
                const res = await fetch(`/api/v1/playlists/${pl.id}/songs/sort`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: finalAction })
                });

                if (res.ok) {
                    window.showToast("✅ 排序成功，正在刷新列表！");
                    try {
                        const metaRes = await fetch('/api/v1/jsplugin/iwebplayer/musiclist?action=meta_bulk');
                        const metaData = await metaRes.json();
                        if (metaData && metaData.structure && metaData.structure[pl.name]) {
                            const newOrderIds = metaData.structure[pl.name];
                            const currentSongs = window.allPlaylists[pl.name] || [];
                            const newSortedSongs = [];
                            newOrderIds.forEach(id => {
                                const songObj = currentSongs.find(s => s.id === id);
                                if (songObj) newSortedSongs.push(songObj);
                            });
                            window.allPlaylists[pl.name] = newSortedSongs;
                            window.songList = newSortedSongs;
                        }
                    } catch (err) {
                        if (typeof window.reloadGlobalData === 'function') await window.reloadGlobalData();
                    }
                    if (typeof window.renderPlaylist === 'function') window.renderPlaylist();

                    // 🌟 纯静默 DOM 过滤补偿
                    setTimeout(() => this.applySilentFilter(), 400);

                    window.scrollTo({ top: 0, behavior: 'smooth' });
                    document.getElementById('scroll-wrapper')?.scrollTo({ top: 0, behavior: 'smooth' });
                } else {
                    window.showToast("❌ 排序指令执行失败");
                }
            } catch (e) {
                window.showToast("❌ 网络请求异常");
            } finally {
                if (sortToolbar) sortToolbar.style.pointerEvents = 'auto';

                setTimeout(() => {
                    if (playlistEl) {
                        playlistEl.style.transition = 'opacity 0.25s ease-in';
                        playlistEl.style.opacity = '1';
                    }
                }, 450);
            }
        },

        // ==========================================
        // 🖐️ 4. 手动拖拽引擎 (DOM操作与事件监听)
        // ==========================================
        toggleManualMode: function() {
            if (window.currentPlaylist === '我的歌单' || window.currentPlaylist === '所有歌曲' || window.currentPlaylist === '在线资源' || window.currentPlaylist === '曲库搜索') {
                window.showToast("💡 仅支持自定义本地歌单进行手动排序");
                this.isActive = false;
                return;
            }

            this.isActive = !this.isActive;

            if (this.isActive) {
                document.body.classList.add('manual-sort-mode');
                window.showToast("🖐️ 已开启排版模式：拖动左侧 ≡ 进行排序");
                this.injectHandles();
                this.bindEvents();
            } else {
                document.body.classList.remove('manual-sort-mode');
                window.showToast("✅ 已退出排版模式");
                this.unbindEvents();
            }
        },

        injectHandles: function() {
            const list = document.getElementById('playlist');
            if (!list) return;
            const items = list.querySelectorAll('.song-item');
            items.forEach(li => {
                if (!li.querySelector('.drag-handle')) {
                    const handle = document.createElement('div');
                    handle.className = 'drag-handle';
                    handle.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><line x1="4" y1="8" x2="20" y2="8"></line><line x1="4" y1="16" x2="20" y2="16"></line></svg>`;

                    handle.addEventListener('click', (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                    });

                    li.appendChild(handle);
                }
            });
        },

        bindEvents: function() {
            const list = document.getElementById('playlist');
            if (!list) return;

            this.handleStart = this.onStart.bind(this);
            this.handleMove = this.onMove.bind(this);
            this.handleEnd = this.onEnd.bind(this);

            list.addEventListener('touchstart', this.handleStart, { passive: false });
            list.addEventListener('mousedown', this.handleStart);
            document.addEventListener('touchmove', this.handleMove, { passive: false });
            document.addEventListener('mousemove', this.handleMove, { passive: false });
            document.addEventListener('touchend', this.handleEnd);
            document.addEventListener('touchcancel', this.handleEnd);
            document.addEventListener('mouseup', this.handleEnd);
        },

        unbindEvents: function() {
            const list = document.getElementById('playlist');
            if (!list) return;

            list.removeEventListener('touchstart', this.handleStart);
            list.removeEventListener('mousedown', this.handleStart);
            document.removeEventListener('touchmove', this.handleMove);
            document.removeEventListener('mousemove', this.handleMove);
            document.removeEventListener('touchend', this.handleEnd);
            document.removeEventListener('touchcancel', this.handleEnd);
            document.removeEventListener('mouseup', this.handleEnd);
        },

        onStart: function(e) {
            if (e.type === 'mousedown' && e.button !== 0) return;
            const handle = e.target.closest('.drag-handle');
            if (!handle) return;
            e.preventDefault();
            const targetLi = handle.closest('.song-item');
            if (!targetLi) return;

            this.dragEl = targetLi;
            const rect = this.dragEl.getBoundingClientRect();
            this.touchStartY = e.touches ? e.touches[0].clientY : e.clientY;

            this.placeholder = this.dragEl.cloneNode(false);
            this.placeholder.className = 'song-item drag-placeholder';
            this.placeholder.style.height = `${rect.height}px`;
            this.placeholder.style.margin = getComputedStyle(this.dragEl).marginBottom;

            this.dragEl.parentNode.insertBefore(this.placeholder, this.dragEl);
            this.dragEl.classList.add('dragging-ghost');
            this.dragEl.style.position = 'fixed';
            this.dragEl.style.top = `${rect.top}px`;
            this.dragEl.style.left = `${rect.left}px`;
            this.dragEl.style.width = `${rect.width}px`;
            this.dragEl.style.margin = '0';

            this.elStartY = rect.top;
            this.listRect = document.getElementById('scroll-wrapper')?.getBoundingClientRect() || document.body.getBoundingClientRect();
        },

        onMove: function(e) {
            if (!this.dragEl) return;
            e.preventDefault();

            const currentY = e.touches ? e.touches[0].clientY : e.clientY;
            const deltaY = currentY - this.touchStartY;

            let newTop = this.elStartY + deltaY;
            this.dragEl.style.top = `${newTop}px`;

            this.handleAutoScroll(currentY);
            this.detectAndSwap(currentY);
        },

        handleAutoScroll: function(currentY) {
            const buffer = 50;
            const scrollContainer = document.getElementById('scroll-wrapper') || window;

            if (this.scrollRaf) cancelAnimationFrame(this.scrollRaf);

            let speed = 0;
            if (currentY < this.listRect.top + buffer) speed = -12;
            else if (currentY > this.listRect.bottom - buffer) speed = 12;

            if (speed !== 0) {
                const doScroll = () => {
                    if (!this.dragEl) return;
                    scrollContainer.scrollBy(0, speed);
                    this.detectAndSwap(currentY);
                    this.scrollRaf = requestAnimationFrame(doScroll);
                };
                this.scrollRaf = requestAnimationFrame(doScroll);
            }
        },

        detectAndSwap: function(clientY) {
            const list = document.getElementById('playlist');
            const allItems = Array.from(list.querySelectorAll('.song-item:not(.dragging-ghost)'));
            const items = allItems.filter(el => !el.classList.contains('drag-placeholder'));
            let targetSibling = null;

            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const rect = item.getBoundingClientRect();
                const midPoint = rect.top + rect.height / 2;
                if (clientY < midPoint) { targetSibling = item; break; }
            }

            if (this.placeholder.nextElementSibling !== targetSibling) {
                const oldRects = new Map();
                allItems.forEach(item => oldRects.set(item, item.getBoundingClientRect().top));

                if (targetSibling) list.insertBefore(this.placeholder, targetSibling);
                else list.appendChild(this.placeholder);

                allItems.forEach(item => {
                    const oldTop = oldRects.get(item);
                    if (oldTop !== undefined) {
                        const newTop = item.getBoundingClientRect().top;
                        const delta = oldTop - newTop;
                        if (delta !== 0) {
                            item.style.transition = 'none';
                            item.style.transform = `translateY(${delta}px)`;
                        }
                    }
                });

                list.offsetHeight;

                allItems.forEach(item => {
                    item.style.transition = 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)';
                    item.style.transform = '';
                });
            }
        },

        onEnd: async function(e) {
            if (!this.dragEl) return;

            const preventClick = (ev) => {
                ev.stopPropagation();
                ev.preventDefault();
                window.removeEventListener('click', preventClick, true);
            };
            window.addEventListener('click', preventClick, true);
            setTimeout(() => window.removeEventListener('click', preventClick, true), 100);

            if (this.scrollRaf) cancelAnimationFrame(this.scrollRaf);

            const placeholderRect = this.placeholder.getBoundingClientRect();
            this.dragEl.style.transition = 'top 0.2s, left 0.2s';
            this.dragEl.style.top = `${placeholderRect.top}px`;
            this.dragEl.style.left = `${placeholderRect.left}px`;

            const draggedIndex = parseInt(this.dragEl.dataset.index);
            const draggedSong = window.songList[draggedIndex];

            let prevSibling = this.placeholder.previousElementSibling;
            let afterSongId = null;

            if (prevSibling && prevSibling.classList.contains('song-item')) {
                const prevIndex = parseInt(prevSibling.dataset.index);
                if (!isNaN(prevIndex)) {
                    afterSongId = window.songList[prevIndex].id;
                }
            }

            setTimeout(async () => {
                this.dragEl.classList.remove('dragging-ghost');
                this.dragEl.style = '';
                this.placeholder.parentNode.replaceChild(this.dragEl, this.placeholder);
                this.dragEl = null;
                this.placeholder = null;

                await this.submitMoveData(draggedSong.id, afterSongId);
            }, 200);
        },

        submitMoveData: async function(songId, afterSongId) {
            const pl = window.playlistMeta?.find(p => p.name === window.currentPlaylist);
            if (!pl || !pl.id) return;

            window.showToast("⏳ 正在保存新位置...", true);
            try {
                const res = await fetch(`/api/v1/playlists/${pl.id}/songs/move`, {
                    method: 'PUT', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ song_id: songId, after_song_id: afterSongId })
                });

                if (res.ok) {
                    window.showToast("✅ 位置已更新");
                    const listContainer = document.getElementById('playlist');
                    if (listContainer) {
                        const items = listContainer.querySelectorAll('.song-item');
                        items.forEach((li, idx) => {
                            li.dataset.index = idx;
                            const numEl = li.querySelector('.song-num, .list-num, .index');
                            if (numEl) numEl.textContent = (idx + 1).toString().padStart(2, '0');
                        });
                    }
                } else {
                    window.showToast("❌ 位置保存失败，正在回退...");
                    if (typeof window.renderPlaylist === 'function') window.renderPlaylist();
                    if (this.isActive) this.injectHandles();
                }
            } catch (e) {
                window.showToast("❌ 网络请求异常");
                if (typeof window.renderPlaylist === 'function') window.renderPlaylist();
                if (this.isActive) this.injectHandles();
            }
        }
    };

})(window);