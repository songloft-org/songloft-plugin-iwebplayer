// static/playlist.js
(function(window) {
    'use strict';

    window.getCustomPlaylists = function() {
        return [...(window.customPlaylistNames || [])]
        .filter(name => name !== '电台收藏') // 过滤掉系统内置的收藏和电台收藏
        .sort((a, b) => a.localeCompare(b, 'zh-CN'));
    };

    window.getMergedSongList = function(baseName) {
        return window.allPlaylists ? (window.allPlaylists[baseName] || []) : [];
    };

    function getPlaylistIdByName(name) {
        if (!window.playlistMeta) return null;
        const pl = window.playlistMeta.find(p => p.name === name);
        return pl ? pl.id : null;
    }

    window.renderPlaylistRadioList = function(listEl) {
        if (!listEl) return;
        listEl.innerHTML = '';
        const customKeys = window.getCustomPlaylists();
        if (customKeys.length === 0) {
            listEl.innerHTML = '<li style="padding: 12px; text-align: center; color: var(--text-sub);">暂无自定义歌单</li>';
        } else {
            customKeys.forEach(k => {
                const li = document.createElement('li');
                li.style.cssText = 'padding: 12px 16px; border-bottom: 1px solid var(--border); cursor: pointer; color: var(--text-main); font-size: 14px; display: flex; align-items: center; gap: 10px; transition: background 0.2s;';
                const songCount = window.getMergedSongList(k).length;
                li.innerHTML = `<input type="radio" name="add_target_pl" style="pointer-events: none; margin: 0; width: 16px; height: 16px; accent-color: var(--primary);"> <span>${k} <span style="opacity: 0.6; font-size: 12px; margin-left: 2px;">(${songCount})</span></span>`;
                li.onmousedown = () => { li.style.backgroundColor = 'var(--border)'; };
                li.onclick = () => {
                    Array.from(listEl.children).forEach(el => {
                        el.style.backgroundColor = 'transparent'; el.style.fontWeight = 'normal';
                        const radio = el.querySelector('input[type="radio"]');
                        if (radio) radio.checked = false;
                    });
                    li.style.backgroundColor = 'var(--card-bg)'; li.style.fontWeight = 'bold';
                    const myRadio = li.querySelector('input[type="radio"]');
                    if (myRadio) myRadio.checked = true;
                    window.tempSelectedPlaylist = k;
                };
                listEl.appendChild(li);
            });
        }
    };

    window.executeRemoveSong = async function(index, songName) {
        if (window.currentPlaylist === '收藏') {
            if (window.favoriteList.includes(songName)) window.toggleFavorite(songName, index);
        } else {
            const plId = getPlaylistIdByName(window.currentPlaylist);
            const rawSong = window.songList[index];
            const songId = rawSong ? rawSong.id : null;

            window.songList.splice(index, 1);
            window.showToast(`🗑️ 已移出歌单`);
            if(window.renderPlaylist) window.renderPlaylist();

            if (plId && songId && window.customPlaylistNames && window.customPlaylistNames.includes(window.currentPlaylist)) {
                await fetch(`/api/v1/playlists/${plId}/songs/${songId}`, { method: 'DELETE' });
                if(window.reloadGlobalData) await window.reloadGlobalData();
            }
        }
    };

    // 🌟 单曲加入：双通道分流（本地歌曲 / 在线资源）
    window.executeAddSong = async function(index, songName, targetPlaylist) {
        let plId = getPlaylistIdByName(targetPlaylist);
        const rawSong = window.songList[index];
        const songId = rawSong ? rawSong.id : null;

        if (!rawSong) { window.showToast("❌ 无法获取歌曲信息"); return; }
        // 如果是本地歌没拿到 ID 就拦截（在线歌不需要验证本地ID）
        if (!songId && !rawSong._isOnlineObj) { window.showToast("❌ 缺少歌曲ID，无法添加"); return; }

        window.showToast(`⏳ 正在加入...`);

        try {
            // 1. 歌单不存在则自动创建
            if (!plId) {
                const createRes = await fetch('/api/v1/playlists', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: targetPlaylist, type: 'normal' })
                });
                if (createRes.ok) {
                    const newData = await createRes.json();
                    plId = newData.id;
                }
            }
            if (!plId) throw new Error("歌单创建失败");

            let res;
            if (rawSong._isOnlineObj) {
                // 🌐 【通道 1：在线歌曲】走 LXMusic 专属导入接口
                const songPayload = { ...rawSong.source_data };
                if (!songPayload.quality) songPayload.quality = "128k"; // 兜底音质防报错

                res = await fetch('/api/v1/jsplugin/lxmusic/api/songs/import', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        songs: [songPayload], // 直接将组装好的歌曲数据扔进数组
                        playlist_id: String(plId),
                        new_playlist_name: ""
                    })
                });
            } else {
                // 📁 【通道 2：本地歌曲】走原生加入接口
                res = await fetch(`/api/v1/playlists/${plId}/songs`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ song_ids: [songId] })
                });
            }

            if (res.ok) {
                const data = await res.json();
                // 针对在线接口的特殊错误捕获
                if (rawSong._isOnlineObj && data.code !== 0) {
                    window.showToast("❌ 添加失败: " + (data.msg || "未知错误"));
                    return;
                }

                window.showToast(`🎉 已成功加入`);

                // 只更新后台数据和下拉框数字，绝不碰当前的视图列表
                if (window.reloadGlobalData) await window.reloadGlobalData();
                if (typeof window.initPlaylistDropdown === 'function') window.initPlaylistDropdown();
            } else {
                window.showToast("❌ 添加被服务器拒绝");
            }
        } catch(e) { console.error(e); window.showToast("❌ 网络异常"); }
    };

    // 🌟 批量加入：双通道混合处理
    window.executeBulkAdd = async function(targetPlaylist) {
        if (!window.songList || window.songList.length === 0) return;

        // 区分开本地歌曲 ID 和在线歌曲对象
        const localSongIds = window.songList.filter(s => !s._isOnlineObj).map(s => s.id).filter(Boolean);
        const onlineSongs = window.songList.filter(s => s._isOnlineObj).map(s => {
            const payload = { ...s.source_data };
            if (!payload.quality) payload.quality = "128k";
            return payload;
        });

        if (localSongIds.length === 0 && onlineSongs.length === 0) { window.showToast("❌ 列表中无有效歌曲"); return; }

        window.showToast(`⏳ 批量加入 ${localSongIds.length + onlineSongs.length} 首歌...`, true);
        let plId = getPlaylistIdByName(targetPlaylist);

        try {
            // 1. 歌单不存在则自动创建
            if (!plId) {
                const createRes = await fetch('/api/v1/playlists', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: targetPlaylist, type: 'normal' })
                });
                if (createRes.ok) {
                    const newData = await createRes.json();
                    plId = newData.id;
                }
            }
            if (!plId) throw new Error("歌单创建失败");

            let successCount = 0;

            // 📁 批量加入本地歌曲
            if (localSongIds.length > 0) {
                const resLocal = await fetch(`/api/v1/playlists/${plId}/songs`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ song_ids: localSongIds })
                });
                if (resLocal.ok) successCount += localSongIds.length;
            }

            // 🌐 批量加入在线歌曲
            if (onlineSongs.length > 0) {
                const resOnline = await fetch('/api/v1/jsplugin/lxmusic/api/songs/import', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        songs: onlineSongs,
                        playlist_id: String(plId),
                        new_playlist_name: ""
                    })
                });
                if (resOnline.ok) {
                    const data = await resOnline.json();
                    if (data.code === 0 && data.data && data.data.success) {
                        successCount += data.data.success;
                    }
                }
            }

            if (successCount > 0) {
                window.showToast(`🎉 批量加入成功！`);
                if (window.reloadGlobalData) await window.reloadGlobalData();
                if (typeof window.initPlaylistDropdown === 'function') window.initPlaylistDropdown();
            } else { window.showToast("⚠️ 加入失败"); }
        } catch(e) { console.error(e); window.showToast("⚠️ 网络异常"); }
    };

    // 🌟 渲染：编辑自定义歌单列表
    window.renderEditPlaylistItems = function() {
        const editPlList = document.getElementById('edit-playlist-list');
        if (!editPlList) return;
        editPlList.innerHTML = '';

        // 💡 在编辑弹窗中，把“收藏”无情踢掉！
        const customKeys = window.getCustomPlaylists().filter(k => k !== '收藏');

        if (customKeys.length === 0) {
            editPlList.innerHTML = '<li style="padding: 30px; text-align: center; color: var(--text-sub); font-size: 15px;">暂无自定义歌单</li>';
            return;
        }
        customKeys.forEach(k => {
            const li = document.createElement('li');
            li.className = 'edit-pl-item';
            let displayName = k;
            const songCount = window.getMergedSongList ? window.getMergedSongList(k).length : 0;
            // 🌟 1. 注入正常态的 HTML（将重命名按钮背景设为紫红色 var(--primary)）
            li.innerHTML = `
              <div class="pl-normal-view" style="width: 100%; display: flex; align-items: center; justify-content: space-between; transition: opacity 0.2s;">
                <div class="edit-pl-name-wrap">
                  <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle><path d="M12 6a6 6 0 0 0-6 6"></path></svg>
                  <span class="edit-pl-name-text">${displayName} <span style="opacity: 0.6; font-size: 14px; font-weight: normal; margin-left: 2px;">(${songCount})</span></span>
                </div>
                <div class="edit-pl-actions">
                  <button class="edit-pl-icon-btn rename" style="background: var(--primary);" title="重命名"><svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>
                  <button class="edit-pl-icon-btn delete" title="删除"><svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
                </div>
              </div>
              
              <div class="pl-delete-view" style="position: absolute; inset: 0; padding: 12px 18px; background: rgba(239, 68, 68, 0.05); display: flex; align-items: center; justify-content: space-between; transform: translateX(100%); transition: transform 0.2s cubic-bezier(0.25, 0.8, 0.25, 1);">
                <div style="flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; overflow: hidden;">
                  <div style="font-size: 15px; font-weight: bold; color: var(--text-main); opacity: 0.6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${displayName}</div>
                </div>
                <div class="edit-pl-actions" style="margin-left: 12px;">
                  <button class="edit-pl-text-btn btn-cancel-del" style="background: var(--card-bg); color: var(--text-main); border: 1px solid var(--border);">取消</button>
                  <button class="edit-pl-text-btn edit-pl-confirm-delete" style="background: #6b7280; color: #fff; border: none;">确认删除</button>
                </div>
              </div>
            `;
            // 给 li 加上关键的相对定位和溢出隐藏，为了能装下这个滑出的绝对定位面板
            li.style.position = 'relative';
            li.style.overflow = 'hidden';

            // 💡 辅助：获取歌单ID
            const getPlId = (name) => {
                const pl = window.playlistMeta?.find(p => p.name === name);
                return pl ? pl.id : null;
            };

            li.querySelector('.rename').addEventListener('click', () => {
                li.style.backgroundColor = 'var(--bg-color)';
                li.innerHTML = `
                  <input type="text" class="edit-pl-inline-input" value="${displayName}">
                  <div class="edit-pl-actions">
                    <button class="edit-pl-text-btn edit-pl-cancel">取消</button>
                    <button class="edit-pl-text-btn edit-pl-confirm-rename">保存</button>
                  </div>
                `;
                const inputEl = li.querySelector('.edit-pl-inline-input');
                inputEl.focus(); inputEl.select();
                li.querySelector('.edit-pl-cancel').addEventListener('click', window.renderEditPlaylistItems);

                li.querySelector('.edit-pl-confirm-rename').addEventListener('click', async () => {
                    const newName = inputEl.value.trim();
                    if (!newName || newName === displayName) { window.renderEditPlaylistItems(); return; }

                    const plId = getPlId(k);
                    if (!plId) return;

                    window.showToast("⏳ 正在重命名...");
                    try {
                        const res = await fetch(`/api/v1/playlists/${plId}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ name: newName })
                        });

                        if (res.ok) {
                            window.showToast("🎉 重命名成功！");
                            if (window.currentPlaylist === k) window.currentPlaylist = newName;
                            if (window.reloadGlobalData) await window.reloadGlobalData();
                            if (window.initPlaylistDropdown) window.initPlaylistDropdown();
                            window.renderEditPlaylistItems();
                        } else {
                            window.showToast("❌ 重命名被拒绝"); window.renderEditPlaylistItems();
                        }
                    } catch (e) { window.showToast("❌ 网络异常"); window.renderEditPlaylistItems(); }
                });
            });

            // 🌟 提前获取两个视图容器
            const normalView = li.querySelector('.pl-normal-view');
            const deleteView = li.querySelector('.pl-delete-view');

            // 1. 点击红色垃圾桶：滑出删除确认面板
            li.querySelector('.delete').addEventListener('click', () => {
                normalView.style.opacity = '0';
                deleteView.style.transform = 'translateX(0)';
            });

            // 2. 点击取消：滑回收起面板
            li.querySelector('.btn-cancel-del').addEventListener('click', () => {
                normalView.style.opacity = '1';
                deleteView.style.transform = 'translateX(100%)';
            });

            // 3. 点击确认删除：执行实际的 API 请求逻辑
            li.querySelector('.edit-pl-confirm-delete').addEventListener('click', async () => {
                const plId = getPlId(k);
                if (!plId) return;

                window.showToast("⏳ 正在彻底删除...");
                try {
                    const res = await fetch(`/api/v1/playlists/${plId}`, { method: 'DELETE' });

                    if (res.ok) {
                        window.showToast("🗑️ 歌单已删除！");
                        if (window.currentPlaylist === k) {
                            window.currentPlaylist = "所有歌曲";
                            if (window.updateSearchUI) window.updateSearchUI(window.currentPlaylist);
                        }
                        if (window.reloadGlobalData) await window.reloadGlobalData();
                        if (window.initPlaylistDropdown) window.initPlaylistDropdown();
                        window.renderEditPlaylistItems();
                    } else {
                        window.showToast("❌ 删除被拒绝"); window.renderEditPlaylistItems();
                    }
                } catch (e) { window.showToast("❌ 删除异常"); window.renderEditPlaylistItems(); }
            });
            editPlList.appendChild(li);
        });
    };

    // 🌟 核心：触发后端刷新扫库引擎
    window.refreshMusicList = async function(isSilent = false) {
        if (!isSilent) window.showToast("🔄 正在向服务器发送扫描指令...");
        try {
            const res = await fetch('/api/v1/scan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
                body: JSON.stringify({ reimport: false })
            });

            if (res.ok || res.status === 409) {
                window.checkRefreshStatus(isSilent);
            } else {
                throw new Error("服务器拒绝启动扫描");
            }
        } catch (err) {
            if (!isSilent) window.showToast("❌ 刷新请求失败，请检查网络或后端配置");
        }
    };

    // 🌟 核心：轮询扫库进度
    window.checkRefreshStatus = function(isSilent = false) {
        fetch('/api/v1/scan/progress')
            .then(res => res.json())
            .then(data => {
                const status = data.status;
                if (status === "completed" || status === "idle") {
                    if (!isSilent) window.showToast("✅ 曲库刷新成功！正在重载...");
                    setTimeout(() => { window.location.reload(); }, 600);
                }
                else if (status === "failed" || status === "cancelled") {
                    if (!isSilent) window.showToast("❌ 扫描任务失败或被终止");
                }
                else {
                    if (!isSilent && data.total_files > 0) {
                        window.showToast(`⏳ 正在重建曲库: ${data.scanned_files} / ${data.total_files}`, true);
                    } else if (!isSilent) {
                        window.showToast(`⏳ 正在扫描文件系统中...`, true);
                    }
                    setTimeout(() => window.checkRefreshStatus(isSilent), 1500);
                }
            })
            .catch(err => {
                setTimeout(() => { window.location.reload(); }, 2000);
            });
    };

    window.switchPlaylistSilently = function(targetPlaylistName) {
        // 🌟 修改：因为全局变成了字典隔离，所以这里绝对不能再清空记录，只重置失败计数即可
        window.consecutiveFailures = 0;

        window.currentPlaylist = targetPlaylistName;

        let stateObj = window.localState || { playlist: "", songName: "" };
        stateObj.playlist = window.currentPlaylist;
        localStorage.setItem('iwebplayer.local_state', JSON.stringify(stateObj));
        if (window.localState) window.isLocalState = stateObj;

        const playlistVal = document.getElementById('playlist-val');
        if (playlistVal) {
            playlistVal.innerHTML = window.formatPlaylistTextWithTags(targetPlaylistName, window.getMergedSongList(targetPlaylistName).length);
        }

        document.querySelectorAll('#playlist-opts .select-option').forEach(el => el.classList.remove('active'));
        const targetOpt = document.querySelector(`#playlist-opts .select-option[data-key="${targetPlaylistName}"]`);
        if (targetOpt) targetOpt.classList.add('active');

        if (typeof window.updateSearchUI === 'function') window.updateSearchUI(targetPlaylistName);

        window.songList = window.getMergedSongList(targetPlaylistName);
        if (typeof window.renderPlaylist === 'function') window.renderPlaylist();
    };

    /* ==========================================
     * 🌟 终极渲染引擎与数据中心
     * ========================================== */

    window.performLocalSearch = function(keyword) {
        keyword = keyword.trim().toLowerCase();
        if (!keyword) {
            window.allPlaylists['曲库搜索'] = [];
            window.songList = [];
        } else {
            const allSongs = window.allPlaylists['所有歌曲'] || [];
            window.allPlaylists['曲库搜索'] = allSongs.filter(rawItem => {
                const songName = window.getSongNameObj(rawItem);
                return songName && songName.toLowerCase().includes(keyword);
            });
            window.songList = window.allPlaylists['曲库搜索'];
        }

        if (window.currentPlaylist === '曲库搜索') {
            window.renderPlaylist();
            const text = window.formatPlaylistTextWithTags('曲库搜索', window.songList.length);
            const playlistVal = document.getElementById('playlist-val');
            if (playlistVal) playlistVal.innerHTML = text;
            const searchOpt = document.querySelector('#playlist-opts .select-option[data-key="曲库搜索"]');
            if (searchOpt) searchOpt.innerHTML = text;
        }
    };

    window.initPlaylistDropdown = function() {
        const playlistOpts = document.getElementById('playlist-opts');
        const playlistVal = document.getElementById('playlist-val');
        const playlistContainer = document.getElementById('playlist-container');
        if (!playlistOpts || !playlistVal || !playlistContainer) return;

        playlistOpts.innerHTML = '';
        const uniqueBaseNames = new Set();
        Object.keys(window.allPlaylists).forEach(k => {
            if (k === '全部') return;
            uniqueBaseNames.add(k);
        });

        const allCleanKeys = Array.from(uniqueBaseNames);
        let defaultKey = (window.localState.playlist && allCleanKeys.includes(window.localState.playlist)) ? window.localState.playlist : '';
        if (!defaultKey) {
            defaultKey = (window.currentPlaylist && allCleanKeys.includes(window.currentPlaylist)) ? window.currentPlaylist : '';
        }
        for (const key of allCleanKeys) {
            if (!defaultKey && key === '我的歌单') defaultKey = key;
        }
        if (!defaultKey && Object.keys(window.allPlaylists).length > 0) {
            defaultKey = Object.keys(window.allPlaylists).find(k => k !== '收藏' && k !== '全部') || Object.keys(window.allPlaylists)[0];
        }

        const createOpt = (key, targetContainer) => {
            const li = document.createElement('li');
            li.className = 'select-option';
            li.dataset.key = key;

            li.innerHTML = window.formatPlaylistTextWithTags(key, window.getMergedSongList(key).length);

            li.addEventListener('click', async (e) => {
                e.stopPropagation();
                window.consecutiveFailures = 0;
                window.currentPlaylist = key;

                window.localState.playlist = window.currentPlaylist;
                localStorage.setItem('iwebplayer.local_state', JSON.stringify(window.localState));

                playlistVal.innerHTML = window.formatPlaylistTextWithTags(key, window.getMergedSongList(key).length);
                playlistOpts.classList.remove('show');

                playlistOpts.querySelectorAll('.select-option').forEach(el => el.classList.remove('active'));
                li.classList.add('active');

                if(window.updateSearchUI) window.updateSearchUI(key);

                if (window._isGridClick) {
                    window._showBackBtn = true;
                } else {
                    window._showBackBtn = false;
                }
                const backWrap = document.getElementById('back-to-grid-wrap');
                if (backWrap) {
                    if (key === '我的歌单' || key === '曲库搜索') {
                        backWrap.style.display = 'none';
                        window._showBackBtn = false;
                    } else {
                        backWrap.style.display = window._showBackBtn ? 'flex' : 'none';
                    }
                }

                let autoScrolled = false;
                if (key === '曲库搜索') {
                    const savedKeyword = localStorage.getItem('iwebplayer.local_search_keyword') || '';
                    window.performLocalSearch(savedKeyword);
                } else if (key === '在线资源') {
                    if(window.restoreOnlineView) window.restoreOnlineView();
                } else {
                    window.songList = window.getMergedSongList(key);
                    window.renderPlaylist();

                    const plTracks = JSON.parse(localStorage.getItem('iwebplayer.playlist_tracks') || '{}');
                    if (plTracks[key]) {
                        const targetName = plTracks[key].name;
                        const targetIdx = window.songList.findIndex(item => window.getSongNameObj(item) === targetName);
                        if (targetIdx !== -1) {
                            if (window.isPlaying) {
                                autoScrolled = true;
                                setTimeout(() => {
                                    const targetEl = document.getElementById('song-' + targetIdx);
                                    if (targetEl) {
                                        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                        targetEl.style.transition = 'background-color 0.4s';
                                        targetEl.style.backgroundColor = 'rgba(236, 72, 153, 0.15)';
                                        setTimeout(() => targetEl.style.backgroundColor = '', 1500);
                                    }
                                }, 100);
                            } else {
                                if(window.playSong) window.playSong(targetIdx, false, plTracks[key].time);
                                autoScrolled = true;
                            }
                        }
                    }
                }

                li.innerHTML = window.formatPlaylistTextWithTags(key, window.songList.length);
                playlistVal.innerHTML = li.innerHTML;

                if (window._isBackAction) {
                    setTimeout(() => window.scrollTo({ top: window._gridScrollY || 0, behavior: 'auto' }), 10);
                } else if (!autoScrolled) {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                }
            });

            if (targetContainer) {
                targetContainer.appendChild(li);
            } else {
                playlistOpts.appendChild(li);
            }
        };

        const predefinedOrder = window.PREDEFINED_PLAYLISTS || [];
        const hiddenPlaylists = ['全部', '_local_iwebplayer_search', 'cache_songs', '电台收藏'];

        if (window.getMergedSongList('下载').length === 0) hiddenPlaylists.push('下载');

        const systemKeys = predefinedOrder.filter(k => allCleanKeys.includes(k) && !hiddenPlaylists.includes(k));
        const customKeys = [];
        const localFolderKeys = [];

        allCleanKeys.forEach(k => {
            if (predefinedOrder.includes(k) || hiddenPlaylists.includes(k)) return;
            if (window.customPlaylistNames && window.customPlaylistNames.includes(k)) {
                customKeys.push(k);
            } else {
                localFolderKeys.push(k);
            }
        });

        customKeys.sort((a, b) => a.localeCompare(b, 'zh-CN'));
        localFolderKeys.sort((a, b) => a.localeCompare(b, 'zh-CN'));

        const stickyGroup = document.createElement('li');
        stickyGroup.style.cssText = 'position: sticky; top: 0; z-index: 10; padding: 0; margin: 0; border-bottom: 1px solid var(--border); list-style: none; box-shadow: 0 4px 10px rgba(0,0,0,0.05); border-radius: 8px 8px 0 0; overflow: hidden;';
        const stickyUl = document.createElement('ul');
        stickyUl.style.cssText = 'padding: 0; margin: 0; list-style: none; background: var(--card-bg);';
        stickyGroup.appendChild(stickyUl);
        playlistOpts.appendChild(stickyGroup);

        systemKeys.forEach(key => {
            if (key === '在线资源' || key === '曲库搜索') {
                createOpt(key, stickyUl);
            } else {
                createOpt(key);
            }
        });

        if (stickyUl.children.length === 0) stickyGroup.style.display = 'none';

        if (customKeys.length > 0) {
            if (systemKeys.length > 0) {
                if (playlistOpts.lastElementChild) playlistOpts.lastElementChild.style.borderBottom = 'none';
                const sep = document.createElement('li');
                sep.style.cssText = 'height: 1px; background: var(--border); margin: 6px 16px; cursor: default; box-sizing: content-box;';
                playlistOpts.appendChild(sep);
            }
            customKeys.forEach(key => createOpt(key));
        }

        if (localFolderKeys.length > 0) {
            if (systemKeys.length > 0 || customKeys.length > 0) {
                if (playlistOpts.lastElementChild) playlistOpts.lastElementChild.style.borderBottom = 'none';
                const sep = document.createElement('li');
                sep.style.cssText = 'height: 1px; background: var(--border); margin: 6px 16px; cursor: default; box-sizing: content-box;';
                playlistOpts.appendChild(sep);
            }
            localFolderKeys.forEach(key => createOpt(key));
        }

        if (allCleanKeys.includes('cache_songs')) {
            if (playlistOpts.lastElementChild) playlistOpts.lastElementChild.style.borderBottom = 'none';
            const sep = document.createElement('li');
            sep.style.cssText = 'height: 1px; background: var(--border); margin: 6px 16px; cursor: default; box-sizing: content-box;';
            playlistOpts.appendChild(sep);
            createOpt('cache_songs');
        }

        if (defaultKey) {
            window.currentPlaylist = defaultKey;
            playlistVal.innerHTML = window.formatPlaylistTextWithTags(defaultKey, window.getMergedSongList(defaultKey).length);
            const firstOpt = Array.from(playlistOpts.querySelectorAll('.select-option')).find(li => li.dataset.key === defaultKey);
            if(firstOpt) firstOpt.classList.add('active');
            window.songList = window.getMergedSongList(defaultKey);
            playlistContainer.style.display = 'block';
        }
    };

    window.renderPlaylist = function() {
        const grid = document.getElementById('playlist-grid');
        const list = document.getElementById('playlist');
        const playlistEl = document.getElementById('playlist');
        if (!playlistEl) return;

        if (grid) grid.style.display = 'none';
        if (list) list.style.display = 'block';

        playlistEl.innerHTML = '';
        if (window.currentPlaylist === '我的歌单' && grid) grid.innerHTML = '';

        let isCurrentSongInNewList = false;
        if(window.closeAllSongMenus) window.closeAllSongMenus();

        if (window.playlistObserver) {
            window.playlistObserver.disconnect();
        }

        const authData = JSON.parse(localStorage.getItem('songloft-auth') || "{}");
        const globalToken = authData.accessToken || "";

        // 1. 渲染我的网格 (海报墙)
        if (window.currentPlaylist === '我的歌单') {
            if (list) list.style.display = 'none';
            if (grid) grid.style.display = 'grid';

            const metas = [...(window.playlistMeta || [])]
                .filter(pl => pl.name !== '所有电台' && pl.name !== '电台收藏')
                .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

            window.playlistObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    const card = entry.target;
                    const img = card.querySelector('.pl-cover-img');
                    if (!img) return;

                    if (entry.isIntersecting) {
                        card._inView = true;
                        const plName = card.dataset.plName;
                        const coverUrl = card.dataset.coverUrl;

                        if (coverUrl && coverUrl !== 'null' && coverUrl !== 'undefined' && coverUrl.trim() !== '') {
                            img.src = `${coverUrl}?access_token=${globalToken}`;
                            window.playlistObserver.unobserve(card);
                        } else {
                            const playlistSongs = window.getMergedSongList(plName);
                            if (playlistSongs && playlistSongs.length > 0) {
                                const firstSong = playlistSongs[0];
                                if (firstSong._scrapedCover) {
                                    img.src = firstSong._scrapedCover;
                                    window.playlistObserver.unobserve(card);
                                } else if (firstSong.cover_url) {
                                    img.src = `${firstSong.cover_url}?access_token=${globalToken}`;
                                    window.playlistObserver.unobserve(card);
                                } else {
                                    if (card._scrapeTimer) clearTimeout(card._scrapeTimer);
                                    card._scrapeTimer = setTimeout(async () => {
                                        if (!card._inView) return;
                                        window.playlistObserver.unobserve(card);
                                        const hdCover = await window.fetchScrape(firstSong, 'cover');
                                        if (!card._inView) return;
                                        if (hdCover) {
                                            img.src = hdCover;
                                            if (typeof firstSong === 'object') firstSong._scrapedCover = hdCover;
                                        } else {
                                            if (typeof firstSong === 'object') firstSong._scrapedCover = window.defaultCover;
                                        }
                                    }, 500);
                                }
                            } else {
                                img.src = window.defaultCover;
                                window.playlistObserver.unobserve(card);
                            }
                        }
                    } else {
                        card._inView = false;
                        if (card._scrapeTimer) {
                            clearTimeout(card._scrapeTimer);
                            card._scrapeTimer = null;
                        }
                    }
                });
            }, { root: null, rootMargin: '100px 0px', threshold: 0.1 });

            metas.forEach(pl => {
                const card = document.createElement('div');
                card.className = 'pl-card-b';
                card.dataset.plName = pl.name;
                card.dataset.coverUrl = pl.cover_url || '';

                const isCustom = window.customPlaylistNames && window.customPlaylistNames.includes(pl.name);
                const rawSvg = isCustom ? window.SVG_ICONS.disc : window.SVG_ICONS.folder;
                const nameIconHtml = rawSvg.replace('width="15" height="15"', 'width="12" height="12" style="margin-right: 4px; vertical-align: -2px; opacity: 0.9;"');

                const conf = window.getPlaylistConfig(pl.name);
                let subText = `共 ${pl.song_count || 0} 首`;
                if (conf.speedLocal !== 1.0) subText += ` · ${window.formatSpeed(conf.speedLocal)}`;
                if (conf.resumeLocal !== 'off') subText += ` · 续播`;

                card.innerHTML = `
                  <img class="pl-cover-img" src="${window.defaultCover}" alt="cover">
                  <div class="pl-overlay">
                    <div class="pl-name" style="display: flex; align-items: center;">${nameIconHtml}${pl.name}</div>
                    <div class="pl-time">${subText}</div> </div>
                  <div class="pl-playcount">
                    <svg viewBox="0 0 24 24" width="10" height="10" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path></svg>
                  </div>
                `;

                card.onclick = () => {
                    window._gridScrollY = window.scrollY || document.documentElement.scrollTop;
                    window._isGridClick = true;
                    const targetOpt = Array.from(document.querySelectorAll('#playlist-opts .select-option')).find(el => el.dataset.key === pl.name);
                    if (targetOpt) targetOpt.click();
                    window._isGridClick = false;
                };

                grid.appendChild(card);
                window.playlistObserver.observe(card);
            });
            window.currentIndex = -1;
            return;
        }

        // 2. 渲染歌曲列表
        if (window.songList.length === 0) {
            playlistEl.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-sub); font-size: 14px;">列表为空</div>';
            window.currentIndex = -1;
            return;
        }

        window.playlistObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const li = entry.target;
                const img = li.querySelector('.song-cover-img');
                if (!img) return;
                const index = li.dataset.index;

                if (entry.isIntersecting) {
                    li._inView = true;
                    if (img.dataset.src) {
                        img.src = img.dataset.src;
                        img.removeAttribute('data-src');
                    } else if (img.dataset.scrape === "true") {
                        if (li._scrapeTimer) clearTimeout(li._scrapeTimer);
                        li._scrapeTimer = setTimeout(async () => {
                            if (!li._inView) return;
                            img.removeAttribute('data-scrape');
                            const rawItem = window.songList[index];
                            const hdCover = await window.fetchScrape(rawItem, 'cover');
                            if (!li._inView) return;
                            if (hdCover) {
                                img.src = hdCover;
                                if (typeof window.songList[index] === 'object') window.songList[index]._scrapedCover = hdCover;
                            } else {
                                if (typeof window.songList[index] === 'object') window.songList[index]._scrapedCover = window.defaultCover;
                            }
                        }, 500);
                    }
                } else {
                    li._inView = false;
                    if (li._scrapeTimer) {
                        clearTimeout(li._scrapeTimer);
                        li._scrapeTimer = null;
                    }
                }
            });
        }, { root: null, rootMargin: '100px 0px', threshold: 0.1 });

        const MENU_ICONS = {
            '移出': `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>`,
            '加入': `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle><path d="M12 6a6 6 0 0 0-6 6"></path></svg>`
        };

        // ======= 🚀 性能优化：在渲染前预先计算当前播放歌曲的索引 =======
        window.currentIndex = window.songList.findIndex(item => window.getSongNameObj(item) === window.currentSongName);

        // ======= 🚀 性能优化：分片渲染 (Time Slicing) + DocumentFragment =======
        const CHUNK_SIZE = 150; // 每次渲染 150 首，保证首屏极速，不卡死主线程
        let renderIndex = 0;
        const totalSongs = window.songList.length;

        // 防止快速切换歌单时，上一个歌单的渲染任务还在继续
        if (window._renderTimer) clearTimeout(window._renderTimer);

        const renderChunk = () => {
            const fragment = document.createDocumentFragment(); // 使用内存碎片，减少页面重绘
            const end = Math.min(renderIndex + CHUNK_SIZE, totalSongs);

            for (; renderIndex < end; renderIndex++) {
                const index = renderIndex;
                const rawItem = window.songList[index];
                const songName = window.getSongNameObj(rawItem);
                let coverUrl = null;
                let needsScrape = false;

                if (rawItem._scrapedCover) {
                    coverUrl = rawItem._scrapedCover;
                } else if (rawItem.cover_url) {
                    coverUrl = `${rawItem.cover_url}?access_token=${globalToken}`;
                } else {
                    needsScrape = true;
                }

                const imgId = `list-cover-${index}`;
                const coverHtml = `<img id="${imgId}" class="song-cover-img" src="${window.defaultCover}" ${coverUrl ? `data-src="${coverUrl}"` : ''} ${needsScrape ? `data-scrape="true"` : ''} onerror="this.src='${window.defaultCover}'" alt="cover">`;

                const li = document.createElement('li');
                li.className = 'song-item';
                li.id = 'song-' + index;
                li.style.position = 'relative';
                li.dataset.index = index;

                // 使用预计算的 index 匹配
                if (index === window.currentIndex) {
                    li.classList.add('playing');
                }

                let menuItems = ['加入', '移出'];
                let menuHtml = `<ul class="song-more-menu" id="song-menu-${index}">`;
                menuItems.forEach(item => {
                    menuHtml += `<li class="song-more-menu-item" data-action="${item}" onclick="void(0)">${MENU_ICONS[item] || ''}${item}</li>`;
                });
                menuHtml += `</ul>`;

                const moreBtnHtml = `
                  <div class="song-more-btn" id="more-btn-${index}" title="更多操作">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" stroke="none"><circle cx="12" cy="5" r="2"></circle><circle cx="12" cy="12" r="2"></circle><circle cx="12" cy="19" r="2"></circle></svg>
                  </div>
                `;

                let sourceTagHtml = '';
                if (window.currentPlaylist === '曲库搜索') {
                    let foundPl = '';
                    const skipPls = ['全部', '所有歌曲', '最近新增', '曲库搜索', '收藏', '下载', '所有电台'];
                    for (const [plName, plSongs] of Object.entries(window.allPlaylists)) {
                        if (skipPls.includes(plName)) continue;
                        if (plSongs.some(item => item.id === rawItem.id)) {
                            foundPl = plName === 'cache_songs' ? '缓存歌曲' : plName;
                            break;
                        }
                    }
                    if (foundPl) {
                        sourceTagHtml = `<div class="song-playlist-tag">${foundPl}</div>`;
                    }
                }

                let timeTagHtml = '';
                const plConf = window.getPlaylistConfig(window.currentPlaylist);
                const currentDeadList = window.deadSongIndexes[window.currentPlaylist] || [];

                if (currentDeadList.includes(index)) {
                    timeTagHtml = `<div class="song-dead-tag">失效</div>`;
                } else {
                    if (plConf.resumeLocal !== 'off') {
                        const targetSvg = plConf.resumeLocal === 'global' ? window.SVG_ICONS.cloud_clock : window.SVG_ICONS.stopwatch;
                        const history = JSON.parse(localStorage.getItem('iwebplayer.resume_history') || '{}');
                        const list = history[window.currentPlaylist] || [];
                        const found = list.find(item => item.name === songName);
                        if (found && found.time > 0) {
                            timeTagHtml = `<div style="display: flex; align-items: center; font-size: 11px; color: var(--primary); font-variant-numeric: tabular-nums; margin-left: 8px; flex-shrink: 0; font-weight: 500;">${targetSvg}${window.formatTime(found.time)}</div>`;
                        }
                    } else {
                        const plTracks = JSON.parse(localStorage.getItem('iwebplayer.playlist_tracks') || '{}');
                        if (plTracks[window.currentPlaylist] && plTracks[window.currentPlaylist].name === songName && plTracks[window.currentPlaylist].time > 0) {
                            timeTagHtml = `<div style="display: flex; align-items: center; font-size: 11px; color: var(--primary); font-variant-numeric: tabular-nums; margin-left: 8px; flex-shrink: 0; font-weight: 500;">${window.SVG_ICONS.stopwatch}${window.formatTime(plTracks[window.currentPlaylist].time)}</div>`;
                        }
                    }
                }

                li.innerHTML = `
                  ${coverHtml}
                  <div class="song-info"><div class="song-name">${songName}</div></div>
                  ${sourceTagHtml}
                  <div id="time-wrap-${index}" style="display: flex; align-items: center;">${timeTagHtml}</div>
                  <div class="song-fav-icon" id="fav-${index}" style="display: ${window.favoriteList.includes(songName) ? 'block' : 'none'};">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="var(--primary)" color="var(--primary)"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
                  </div>
                  ${moreBtnHtml}
                  ${menuHtml}
                `;

                li.addEventListener('click', (e) => {
                    if (e.target.closest('.song-more-btn') || e.target.closest('.song-more-menu')) return;
                    if (window.activeSongMenuIndex !== -1) { e.preventDefault(); e.stopPropagation(); window.closeAllSongMenus(); return; }
                    window.consecutiveFailures = 0;

                    if (window.deadSongIndexes[window.currentPlaylist]) {
                        window.deadSongIndexes[window.currentPlaylist] = window.deadSongIndexes[window.currentPlaylist].filter(i => i !== index);
                    }
                    if(window.playSong) window.playSong(index);
                });

                const moreBtn = li.querySelector(`#more-btn-${index}`);
                const currentMenu = li.querySelector(`#song-menu-${index}`);
                moreBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (window.activeSongMenuIndex === index) {
                        window.closeAllSongMenus();
                    } else {
                        window.closeAllSongMenus();
                        window.activeSongMenuIndex = index;
                        li.classList.add('menu-open');
                        const rect = moreBtn.getBoundingClientRect();
                        const spaceBelow = window.innerHeight - rect.bottom;
                        if (spaceBelow < 200) {
                            currentMenu.style.top = 'auto'; currentMenu.style.bottom = '40px'; currentMenu.style.boxShadow = '0 -6px 20px rgba(0,0,0,0.12)';
                        } else {
                            currentMenu.style.top = '36px'; currentMenu.style.bottom = 'auto'; currentMenu.style.boxShadow = '0 6px 20px rgba(0,0,0,0.12)';
                        }
                        currentMenu.classList.add('show');
                    }
                });

                const menuEls = li.querySelectorAll(`#song-menu-${index} .song-more-menu-item`);
                menuEls.forEach(menuEl => {
                    menuEl.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const action = menuEl.dataset.action;
                        window.closeAllSongMenus();

                        if (action === '移出') {
                            if (window.skipRemoveConfirm) {
                                window.executeRemoveSong(index, songName);
                            } else {
                                window.pendingRemoveIndex = index;
                                window.pendingRemoveSongName = songName;
                                document.getElementById('remove-song-name').textContent = songName;
                                const removeSongModal = document.getElementById('remove-song-modal-backdrop');
                                if(removeSongModal) {
                                    removeSongModal.classList.add('show');
                                    removeSongModal.setAttribute('aria-hidden', 'false');
                                    document.body.style.overflow = 'hidden';
                                }
                            }
                        } else if (action === '加入') {
                            window.pendingAddIndex = index;
                            window.pendingAddSongName = songName;
                            window.pendingBulkAdd = false;

                            if (window.skipAddConfirm && window.lastAddedPlaylist) {
                                window.executeAddSong(index, songName, window.lastAddedPlaylist);
                            } else {
                                document.getElementById('add-song-name').textContent = songName;
                                if (window.renderPlaylistRadioList) window.renderPlaylistRadioList(document.getElementById('add-song-playlist-list'));
                                const addSongModal = document.getElementById('add-song-modal-backdrop');
                                if(addSongModal) {
                                    addSongModal.classList.add('show');
                                    addSongModal.setAttribute('aria-hidden', 'false');
                                    document.body.style.overflow = 'hidden';
                                }
                            }
                        }
                    });
                });

                fragment.appendChild(li);
                window.playlistObserver.observe(li);
            }

            playlistEl.appendChild(fragment);

            if (renderIndex < totalSongs) {
                // 核心：让出主线程给浏览器，5毫秒后继续渲染下一批
                window._renderTimer = setTimeout(renderChunk, 5);
            }
        };

        // 启动第一批渲染
        renderChunk();
        // =========================================================================
        const listPlConf = window.getPlaylistConfig(window.currentPlaylist);
        if (listPlConf.resumeLocal === 'global') {
            fetch(`./sync?playlist=${encodeURIComponent(window.currentPlaylist)}`)
                .then(r => r.json())
                .then(res => {
                    if (res && res.data && res.data.songName && res.data.time > 0) {
                        const cSong = res.data.songName;
                        const cTime = res.data.time;
                        const targetIdx = window.songList.findIndex(item => window.getSongNameObj(item) === cSong);

                        if (targetIdx !== -1) {
                            const timeWrap = document.getElementById(`time-wrap-${targetIdx}`);
                            if (timeWrap) {
                                timeWrap.innerHTML = `<div style="display: flex; align-items: center; font-size: 11px; color: var(--primary); font-variant-numeric: tabular-nums; margin-left: 8px; flex-shrink: 0; font-weight: 500;">${window.SVG_ICONS.cloud_clock}${window.formatTime(cTime)}</div>`;
                            }
                            let history = JSON.parse(localStorage.getItem('iwebplayer.resume_history') || '{}');
                            let list = history[window.currentPlaylist] || [];
                            list = list.filter(item => item.name !== cSong);
                            list.unshift({ name: cSong, time: cTime });
                            history[window.currentPlaylist] = list;
                            localStorage.setItem('iwebplayer.resume_history', JSON.stringify(history));
                        }
                    }
                }).catch(() => {});
        }
    };

    // =========================================================================
    // 🌟 终极预存分流引擎 V3.1：首屏秒开 + 智能双擎 + 401权限击杀修复
    // =========================================================================
    window.reloadGlobalData = async function() {
        try {
            const prefs = typeof window.getPreferences === 'function' ? window.getPreferences() : {};
            const isHighPerf = prefs.highPerf !== false;

            // 1. 🔍 尝试读取 V2 版极简压缩缓存
            const cachedDataStr = localStorage.getItem('iwebplayer.global_cache');
            let hasCache = false;

            if (cachedDataStr) {
                try {
                    const cache = JSON.parse(cachedDataStr);
                    window.customPlaylistNames = cache.customPlaylistNames || [];
                    window.playlistMeta = cache.playlistMeta || [];

                    const poolMap = new Map((cache.songsPool || []).map(s => [s.id, s]));
                    window.allPlaylists = {};

                    for (const [plName, idArray] of Object.entries(cache.playlistsMap || {})) {
                        window.allPlaylists[plName] = idArray.map(id => poolMap.get(id)).filter(Boolean);
                    }

                    window.allPlaylists["我的歌单"] = [];
                    if (!window.allPlaylists["收藏"]) window.allPlaylists["收藏"] = [];
                    window.allPlaylists["曲库搜索"] = [];
                    window.allPlaylists["在线资源"] = [];
                    window.favoriteList = window.allPlaylists["收藏"].map(item => window.getSongNameObj(item));

                    hasCache = true;
                } catch (e) {
                    console.error("缓存解析失败，准备重建:", e);
                }
            }

            // 2. 🐜/🚀 后台静默同步核心进程
            const doBackgroundSync = async () => {
                try {
                    const syncSongsMap = new Map();
                    const syncReconstructed = {};
                    const loadingEl = document.getElementById('loading');

                    if (isHighPerf) {
                        // =======================================
                        // 🚀 引擎 B：高性能模式 (Bulk)
                        // =======================================
                        if (!hasCache) {
                            if (loadingEl && loadingEl.style.display !== 'none') loadingEl.innerHTML = "🚀 正在使用高性能模式全量拉取...";
                            else if (typeof window.showToast === 'function') window.showToast("🚀 正在使用高性能模式同步...", false);
                        }

                        const metaRes = await fetch(`${window.API.list}?action=meta_bulk`);
                        if (metaRes.status === 401) throw new Error("AUTH_FAILED");
                        if (!metaRes.ok) throw new Error("NETWORK_ERROR");
                        const metaData = await metaRes.json();

                        window.customPlaylistNames = metaData._custom_playlists || [];
                        window.playlistMeta = metaData._playlist_meta || [];

                        let page = 1;
                        while (true) {
                            if (!hasCache && page > 1) {
                                if (loadingEl && loadingEl.style.display !== 'none') loadingEl.innerHTML = `🚀 高性能拉取中 (第 ${page} 批)...`;
                                else if (typeof window.showToast === 'function') window.showToast(`🚀 同步全库曲目 (第 ${page} 批)...`, false);
                            }

                            const chunkRes = await fetch(`${window.API.list}?action=chunk&page=${page}`);
                            if (!chunkRes.ok) break;
                            const songsChunk = await chunkRes.json();
                            if (!Array.isArray(songsChunk) || songsChunk.length === 0) break;

                            for (const song of songsChunk) { if (song && song.id) syncSongsMap.set(song.id, song); }
                            if (songsChunk.length < 1000) break;
                            page++;
                        }

                        fetch(`${window.API.list}?action=destroy`).catch(() => {});

                        for (const [plName, idArray] of Object.entries(metaData.structure)) {
                            syncReconstructed[plName] = Array.isArray(idArray) ? idArray.map(id => syncSongsMap.get(id)).filter(Boolean) : idArray;
                        }

                    } else {
                        // =======================================
                        // 🐜 引擎 A：兼容模式 (Light 蚂蚁搬家)
                        // =======================================
                        const metaRes = await fetch(`${window.API.list}?action=meta_light`);
                        // 🌟 修复：精准拦截 401，抛出致命鉴权错误
                        if (metaRes.status === 401) throw new Error("AUTH_FAILED");
                        if (!metaRes.ok) throw new Error("NETWORK_ERROR");
                        const metaData = await metaRes.json();
                        if (metaData.error || metaData.ret === "FAIL") throw new Error("AUTH_FAILED");

                        window.customPlaylistNames = metaData._custom_playlists || [];
                        window.playlistMeta = metaData._playlist_meta || [];

                        for (let i = 0; i < window.playlistMeta.length; i++) {
                            const pl = window.playlistMeta[i];

                            if (!hasCache) {
                                const msgText = `⏳ 正在同步曲库: ${pl.name} <br><span style="font-size:12px; opacity:0.6;">(${i + 1}/${window.playlistMeta.length})</span>`;
                                if (loadingEl && loadingEl.style.display !== 'none') loadingEl.innerHTML = msgText;
                                else if (typeof window.showToast === 'function') window.showToast(`⏳ 同步中: ${pl.name} (${i + 1}/${window.playlistMeta.length})`, true);
                            }

                            try {
                                const res = await fetch(`${window.API.list}?action=playlist_songs&id=${pl.id}`);
                                if (!res.ok) continue;
                                const cleanedSongs = await res.json();

                                if (pl.name !== 'music') syncReconstructed[pl.name] = cleanedSongs;

                                const isBuiltIn = pl.labels && pl.labels.includes("built_in");
                                if (!isBuiltIn) {
                                    for (const s of cleanedSongs) { if (s && s.id) syncSongsMap.set(s.id, s); }
                                }
                            } catch (err) { console.error(`拉取 [${pl.name}] 失败:`, err); }
                        }
                        syncReconstructed["所有歌曲"] = Array.from(syncSongsMap.values());
                    }

                    // 3. 💾 统一极限压缩存盘 (骨肉分离)
                    const playlistsMap = {};
                    for (const [plName, songsObjArray] of Object.entries(syncReconstructed)) {
                        playlistsMap[plName] = songsObjArray.map(s => s.id);
                    }

                    try {
                        localStorage.removeItem('iwebplayer.global_cache');
                        localStorage.setItem('iwebplayer.global_cache', JSON.stringify({
                            customPlaylistNames: window.customPlaylistNames,
                            playlistMeta: window.playlistMeta,
                            songsPool: Array.from(syncSongsMap.values()),
                            playlistsMap: playlistsMap
                        }));
                    } catch (quotaError) { console.error("存盘失败:", quotaError); }

                    // 4. 🔄 覆写内存，激活界面
                    const tempOnline = window.allPlaylists["在线资源"] || [];
                    const tempSearch = window.allPlaylists["曲库搜索"] || [];

                    window.allPlaylists = syncReconstructed;
                    window.allPlaylists["我的歌单"] = [];
                    if (!window.allPlaylists["收藏"]) window.allPlaylists["收藏"] = [];
                    window.allPlaylists["曲库搜索"] = tempSearch;
                    window.allPlaylists["在线资源"] = tempOnline;

                    window.favoriteList = window.allPlaylists["收藏"].map(item => window.getSongNameObj(item));

                    if (typeof window.initPlaylistDropdown === 'function') window.initPlaylistDropdown();
                    if (window.currentPlaylist && window.currentPlaylist !== '在线资源' && window.currentPlaylist !== '曲库搜索') {
                        window.songList = window.getMergedSongList(window.currentPlaylist);
                        if (typeof window.renderPlaylist === 'function') window.renderPlaylist();
                    }

                    if (typeof window.showToast === 'function') {
                        window.showToast(hasCache ? "⚡ 曲库后台静默更新完成" : "✅ 全量曲库同步完成", false);
                    }

                } catch (syncErr) {
                    console.error("同步进程异常:", syncErr);

                    // 🌟 核心升级：丢掉霸道的自动修改配置逻辑。
                    // 只要在“无缓存(首次加载白屏)”阶段报错，或者遇到了鉴权问题，
                    // 统统原封不动抛给外层 init()，让 index.html 里的高智商面板去接管和展现 UI！
                    if (!hasCache || syncErr.message === "AUTH_FAILED") {
                        throw syncErr;
                    }

                    // 如果已经有缓存顺利进到主界面了，后台静默同步网络波动，只弹个低调提示，不打扰用户听歌
                    if (typeof window.showToast === 'function') {
                        window.showToast("❌ 数据同步失败，请检查网络", false);
                    }
                }
            };

            // 5. 🔀 双轨分流路由
            if (hasCache) {
                // 如果是后台静默拉取时发生 401，强制清空假缓存，并瞬间刷新页面，让首页拦截器接管！
                doBackgroundSync().catch(e => {
                    if (e.message === "AUTH_FAILED") {
                        localStorage.removeItem('iwebplayer.global_cache');
                        window.location.reload();
                    }
                });
                return;
            } else {
                await doBackgroundSync();
            }

        } catch (e) {
            console.error("重载全局数据致命崩溃:", e);
            throw e;
        }
    };

})(window);