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

    window.executeAddSong = async function(index, songName, targetPlaylist) {
        let plId = getPlaylistIdByName(targetPlaylist);
        const rawSong = window.songList[index];
        const songId = rawSong ? rawSong.id : null;

        if (!songId) { window.showToast("❌ 缺少歌曲ID，无法添加"); return; }
        window.showToast(`⏳ 正在加入...`);

        try {
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

            const res = await fetch(`/api/v1/playlists/${plId}/songs`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ song_ids: [songId] })
            });

            if (res.ok) {
                window.showToast(`🎉 已成功加入`);
                if (window.reloadGlobalData) await window.reloadGlobalData();
                if (typeof window.initPlaylistDropdown === 'function') window.initPlaylistDropdown();
                if (typeof window.renderPlaylist === 'function') window.renderPlaylist();
            } else { window.showToast("❌ 添加被服务器拒绝"); }
        } catch(e) { console.error(e); window.showToast("❌ 网络异常"); }
    };

    window.executeBulkAdd = async function(targetPlaylist) {
        if (!window.songList || window.songList.length === 0) return;
        const songIds = window.songList.map(s => s.id).filter(Boolean);
        if (songIds.length === 0) { window.showToast("❌ 列表中无有效歌曲"); return; }

        window.showToast(`⏳ 批量加入 ${songIds.length} 首歌...`, true);
        let plId = getPlaylistIdByName(targetPlaylist);

        try {
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

            const res = await fetch(`/api/v1/playlists/${plId}/songs`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ song_ids: songIds })
            });

            if (res.ok) {
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
            li.innerHTML = `
              <div class="edit-pl-name-wrap">
                <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle><path d="M12 6a6 6 0 0 0-6 6"></path></svg>
                <span class="edit-pl-name-text">${displayName} <span style="opacity: 0.6; font-size: 14px; font-weight: normal; margin-left: 2px;">(${songCount})</span></span>
              </div>
              <div class="edit-pl-actions">
                <button class="edit-pl-icon-btn rename" title="重命名"><svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>
                <button class="edit-pl-icon-btn delete" title="删除"><svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
              </div>
            `;

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

            li.querySelector('.delete').addEventListener('click', () => {
                li.style.backgroundColor = 'rgba(239,68,68,0.05)';
                li.innerHTML = `
                  <span class="edit-pl-delete-warn">确定删除该歌单？</span>
                  <div class="edit-pl-actions">
                    <button class="edit-pl-text-btn edit-pl-cancel">取消</button>
                    <button class="edit-pl-text-btn edit-pl-confirm-delete">删除</button>
                  </div>
                `;
                li.querySelector('.edit-pl-cancel').addEventListener('click', window.renderEditPlaylistItems);

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

})(window);