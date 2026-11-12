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
        isPaused: false, // 替代原本挂在 window 上的 _manualModePaused

        // ==========================================
        // 🛠️ 1. 核心控制器：初始化所有排序相关的 UI 绑定
        // ==========================================
        init: function() {
            const menuSortPlaylist = document.getElementById('menu-sort-playlist');
            const sortToolbar = document.getElementById('playlist-sort-toolbar');
            const sortBtns = document.querySelectorAll('#playlist-sort-toolbar .sort-btn');

            if (!menuSortPlaylist || !sortToolbar || !sortBtns.length) return;

            // 1. 绑定下拉菜单开关
            menuSortPlaylist.addEventListener('click', (e) => {
                e.stopPropagation();
                document.getElementById('global-menu-1-opts')?.classList.remove('show');

                const isShown = sortToolbar.style.display === 'flex';
                if (isShown) {
                    sortToolbar.style.display = 'none';
                    menuSortPlaylist.style.color = '';
                    menuSortPlaylist.style.fontWeight = 'normal';

                    if (this.isActive) {
                        this.isPaused = false;
                        this.isActive = false;
                        document.body.classList.remove('manual-sort-mode');
                        if (typeof this.unbindEvents === 'function') this.unbindEvents();

                        const manualBtn = document.querySelector('.sort-btn[data-type="manual"]');
                        if (manualBtn) manualBtn.classList.remove('active');
                    }
                } else {
                    sortToolbar.style.display = 'flex';
                    menuSortPlaylist.style.color = 'var(--primary)';
                    menuSortPlaylist.style.fontWeight = 'bold';
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
                            // 🌟 修复细节：开启手动模式时，彻底洗掉其他排序按钮的残留状态！
                            sortBtns.forEach(el => {
                                if (el.dataset.type !== 'manual') {
                                    el.classList.remove('active'); // 拔除红灯
                                    delete el.dataset.order;       // 清空上下顺序记忆
                                    const arrowEl = el.querySelector('.sort-arrow');
                                    if (arrowEl) arrowEl.textContent = ''; // 清除箭头符号
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

                    sortBtns.forEach(el => {
                        if (el.dataset.type !== 'manual') el.classList.remove('active');
                    });
                    btn.classList.add('active');
                    sortBtns.forEach(el => {
                        const arrow = el.querySelector('.sort-arrow');
                        if (arrow) arrow.innerHTML = '';
                    });

                    const pl = window.playlistMeta?.find(p => p.name === window.currentPlaylist);
                    if (!pl || !pl.id) { btn.classList.remove('active'); return; }

                    let finalAction = '';
                    if (type === 'name' || type === 'song' || type === 'artist' || type === 'recent') {
                        const currentOrder = btn.dataset.order || 'desc';
                        const newOrder = currentOrder === 'asc' ? 'desc' : 'asc';
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

                    if (isClientSide) {
                        this.executeClientSideSort(pl, type, btn);
                        return;
                    }

                    if (isServerSide) {
                        this.executeServerSideSort(pl, finalAction, btn, sortToolbar);
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

            const systemBasics = ['我的歌单', '所有歌曲', '下载', '最近新增', '所有电台', '在线资源', '曲库搜索', 'cache_songs', '电台收藏'];
            const disableSort = systemBasics.includes(playlistName);

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

            sortBtns.forEach(btn => {
                if (btn.dataset.type === 'manual') return;
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
        executeClientSideSort: function(pl, type, btn) {
            const plName = window.currentPlaylist;
            if (!plName || !window.allPlaylists[plName]) return;

            const typeName = type === 'song' ? '歌曲' : type === 'artist' ? '歌手' : '最近添加';
            window.showToast(`⏳ 正在按${typeName}排序...`, true);

            const sortToolbar = document.getElementById('playlist-sort-toolbar');
            if(sortToolbar){
                sortToolbar.style.pointerEvents = 'none';
                sortToolbar.style.opacity = '0.5';
            }

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
                            ? valA.localeCompare(valB, 'zh-CN')
                            : valB.localeCompare(valA, 'zh-CN');
                    }
                });

                if (typeof window.renderPlaylist === 'function') window.renderPlaylist();
                window.scrollTo({ top: 0, behavior: 'smooth' });if (typeof window.renderPlaylist === 'function') window.renderPlaylist();
                window.scrollTo({ top: 0, behavior: 'smooth' });
                document.getElementById('scroll-wrapper')?.scrollTo({ top: 0, behavior: 'smooth' });

                // 🌟 新增：统计缺失信息的歌曲并定制 Toast 提示
                let successMsg = "✅ 排序完成";
                if (type === 'artist') {
                    const missingCount = currentSongs.filter(s => !s.artist || s.artist.trim() === '').length;
                    if (missingCount > 0) {
                        successMsg += `<br><span style="font-size: 12px; opacity: 0.85; font-weight: normal;">有 ${missingCount} 首歌曲文件中缺少歌手信息</span>`;
                    }
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

                if(sortToolbar){
                    sortToolbar.style.pointerEvents = 'auto';
                    sortToolbar.style.opacity = '1';
                }
                btn.classList.remove('active');
            }, 50);
        },

        executeServerSideSort: async function(pl, finalAction, btn, sortToolbar) {
            window.showToast("⏳ 正在重新排序...", true);
            if(sortToolbar){
                sortToolbar.style.pointerEvents = 'none';
                sortToolbar.style.opacity = '0.5';
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
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                    document.getElementById('scroll-wrapper')?.scrollTo({ top: 0, behavior: 'smooth' });
                } else {
                    window.showToast("❌ 排序指令执行失败");
                }
            } catch (e) {
                window.showToast("❌ 网络请求异常");
            } finally {
                if(sortToolbar){
                    sortToolbar.style.pointerEvents = 'auto';
                    sortToolbar.style.opacity = '1';
                }
                btn.classList.remove('active');
            }
        },

        // ==========================================
        // 🖐️ 4. 手动拖拽引擎 (DOM操作与事件监听)
        // ==========================================
        toggleManualMode: function() {
            if (window.currentPlaylist === '我的歌单' || window.currentPlaylist === '在线资源' || window.currentPlaylist === '曲库搜索') {
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