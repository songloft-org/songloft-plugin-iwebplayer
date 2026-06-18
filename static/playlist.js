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
        window.currentPlaylist = targetPlaylistName;

        let stateObj = window.localState || { playlist: "", songName: "" };
        stateObj.playlist = window.currentPlaylist;
        localStorage.setItem('iwebplayer.local_state', JSON.stringify(stateObj));
        if (window.localState) window.localState = stateObj;

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

})(window);