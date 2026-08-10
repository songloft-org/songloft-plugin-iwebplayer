// static/playlist.js
(function(window) {
    'use strict';

    window.getCustomPlaylists = function() {
        return [...(window.customPlaylistNames || [])]
        .filter(name => name !== '电台收藏') // 过滤掉系统内置的收藏和电台收藏
        .sort((a, b) => a.localeCompare(b, 'zh-CN'));
    };

    window.getMergedSongList = function(baseName) {
        // 🌟 修复：严格隔离！只有当引擎是WebDAV，且用户身处"在线资源"时，才去沙盒里捞歌
        if (window.isWebDAVMode && window.currentPlaylist === '在线资源' && window.webdavData && window.webdavData.library && window.webdavData.library[baseName]) {
            return window.webdavData.library[baseName];
        }
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

    // 🌟 单曲加入：双通道分流（本地歌曲 / 在线资源 / WebDAV）
    window.executeAddSong = async function(index, songName, targetPlaylist) {
        let plId = getPlaylistIdByName(targetPlaylist);
        const rawSong = window.songList[index];
        const songId = rawSong ? rawSong.id : null;

        if (!rawSong) { window.showToast("❌ 无法获取歌曲信息"); return; }
        if (!songId && !rawSong._isOnlineObj) { window.showToast("❌ 缺少歌曲ID，无法添加"); return; }

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

            let res;
            if (rawSong._isOnlineObj) {
                // 🌟 新增通道：WebDAV 资源，走官方 Remote 注册逻辑
                if (rawSong.plugin_entry_path === 'dav') {
                    const regRes = await fetch('/api/v1/songs/remote', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([rawSong])
                    });
                    const regData = await regRes.json();
                    if (regData && regData.songs && regData.songs.length > 0) {
                        res = await fetch(`/api/v1/playlists/${plId}/songs`, {
                            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ song_ids: [regData.songs[0].id] })
                        });
                    } else throw new Error("向主程序注册WebDAV歌曲失败");
                }
                // 🌐 原有通道：LXMusic 在线歌曲
                else {
                    const songPayload = { ...rawSong.source_data };
                    songPayload.quality = window.getBestLxQuality(songPayload, window.getLxQuality());
                    res = await fetch('/api/v1/jsplugin/lxmusic/api/songs/import', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ songs: [songPayload], playlist_id: String(plId), new_playlist_name: "" })
                    });
                }
            } else {
                // 📁 通道：本地歌曲
                res = await fetch(`/api/v1/playlists/${plId}/songs`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ song_ids: [songId] })
                });
            }

            if (res.ok) {
                const data = await res.json();
                // 仅针对 LXMusic 接口判断 code
                if (rawSong._isOnlineObj && rawSong.plugin_entry_path !== 'dav' && data.code !== 0) {
                    window.showToast("❌ 添加失败: " + (data.msg || "未知错误"));
                    return;
                }
                window.showToast(`🎉 已成功加入`);
                if (window.reloadGlobalData) await window.reloadGlobalData();
                if (typeof window.initPlaylistDropdown === 'function') window.initPlaylistDropdown();
            } else {
                window.showToast("❌ 添加被服务器拒绝");
            }
        } catch(e) { console.error(e); window.showToast("❌ 网络异常"); }
    };

    // 🌟 批量加入：多通道混合处理
    window.executeBulkAdd = async function(targetPlaylist) {
        if (!window.songList || window.songList.length === 0) return;

        const localSongIds = window.songList.filter(s => !s._isOnlineObj).map(s => s.id).filter(Boolean);
        const davSongs = window.songList.filter(s => s._isOnlineObj && s.plugin_entry_path === 'dav');
        const lxSongs = window.songList.filter(s => s._isOnlineObj && s.plugin_entry_path !== 'dav').map(s => {
            const payload = { ...s.source_data };
            payload.quality = window.getBestLxQuality(payload, window.getLxQuality());
            return payload;
        });

        if (localSongIds.length === 0 && lxSongs.length === 0 && davSongs.length === 0) {
            window.showToast("❌ 列表中无有效歌曲"); return;
        }

        window.showToast(`⏳ 批量加入 ${localSongIds.length + lxSongs.length + davSongs.length} 首歌...`, true);
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

            let successCount = 0;

            // 📁 批量加入本地歌曲
            if (localSongIds.length > 0) {
                const resLocal = await fetch(`/api/v1/playlists/${plId}/songs`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ song_ids: localSongIds })
                });
                if (resLocal.ok) successCount += localSongIds.length;
            }

            // 🌟 批量加入 WebDAV 歌曲 (先领 ID，再加单)
            if (davSongs.length > 0) {
                const regRes = await fetch('/api/v1/songs/remote', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(davSongs)
                });
                const regData = await regRes.json();
                if (regData && regData.songs && regData.songs.length > 0) {
                    const newIds = regData.songs.map(s => s.id);
                    const davAddRes = await fetch(`/api/v1/playlists/${plId}/songs`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ song_ids: newIds })
                    });
                    if (davAddRes.ok) successCount += newIds.length;
                }
            }

            // 🌐 批量加入 LXMusic 歌曲
            if (lxSongs.length > 0) {
                const resOnline = await fetch('/api/v1/jsplugin/lxmusic/api/songs/import', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ songs: lxSongs, playlist_id: String(plId), new_playlist_name: "" })
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

                        // 🌟 极致乐观更新：直接把内存里的歌单名抹除，瞬间起效！
                        if (window.customPlaylistNames) window.customPlaylistNames = window.customPlaylistNames.filter(name => name !== k);
                        if (window.playlistMeta) window.playlistMeta = window.playlistMeta.filter(p => p.name !== k);
                        if (window.allPlaylists) delete window.allPlaylists[k];

                        if (window.currentPlaylist === k) {
                            window.currentPlaylist = "所有歌曲";
                            if (window.updateSearchUI) window.updateSearchUI(window.currentPlaylist);
                        }

                        // 🌟 瞬间重绘下拉框和编辑列表
                        if (window.initPlaylistDropdown) window.initPlaylistDropdown();
                        window.renderEditPlaylistItems();

                        // 🌟 留给后台管家自己去静默同步兜底（不再用 await 阻塞 UI）
                        if (window.reloadGlobalData) window.reloadGlobalData();
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
        window.ConfigManager.set('config', 'playback.last_active', stateObj);
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
        window.matchedLocalPlaylists = []; // 🌟 新增：重置匹配的歌单池

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

            // 🌟 新增：同步搜索本地歌单
            const skipPls = ['全部', '所有歌曲', '最近新增', '曲库搜索', '收藏', '下载', '所有电台', 'cache_songs', '_local_iwebplayer_search', '电台收藏'];
            if (window.playlistMeta) {
                window.matchedLocalPlaylists = window.playlistMeta.filter(pl => {
                    return !skipPls.includes(pl.name) && pl.name.toLowerCase().includes(keyword);
                });
            }
        }

        if (window.currentPlaylist === '曲库搜索') {
            window.renderPlaylist();
            // 🌟 修复：顶部标题的数字要显示歌曲和歌单的总和！
            const totalCount = window.songList.length + window.matchedLocalPlaylists.length;
            const text = window.formatPlaylistTextWithTags('曲库搜索', totalCount);
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
        uniqueBaseNames.add('我的歌单'); // 🌟 核心补漏：强制确保“我的歌单”海报墙入口永远存在！

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

                const systemBasics = ['我的歌单', '所有歌曲', '收藏', '下载', '最近新增', '所有电台', '在线资源', '曲库搜索', 'cache_songs'];
                if (!systemBasics.includes(key)) {
                    let recents = window.ConfigManager.get('config', 'playback.recent_playlists') || [];
                    recents = recents.filter(k => k !== key);
                    recents.unshift(key);
                    if (recents.length > 3) recents = recents.slice(0, 3);
                    window.ConfigManager.set('config', 'playback.recent_playlists', recents);

                    setTimeout(() => { if (typeof window.initPlaylistDropdown === 'function') window.initPlaylistDropdown(); }, 300);
                }

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

        // 🌟 --- 全新的顶部固定区（绝对置顶胶囊 + 3个固定项） ---
        const stickyGroup = document.createElement('li');
        // 修复问题1：给 stickyGroup 加上 background: var(--card-bg)，防止下方列表上滑时穿透重叠
        stickyGroup.style.cssText = 'position: sticky; top: 0; z-index: 10; padding: 0; margin: 0; border-bottom: 1px solid var(--border); list-style: none; box-shadow: 0 4px 10px rgba(0,0,0,0.05); border-radius: 8px 8px 0 0; background: var(--card-bg); overflow: hidden;';

        // 1. 率先插入最近播放的 3 个歌单 (置顶第一行)
        let recents = window.ConfigManager.get('config', 'playback.recent_playlists') || [];
        recents = recents.filter(k => allCleanKeys.includes(k)); // 过滤掉被删掉的歌单

        if (recents.length > 0) {
            const recentDiv = document.createElement('div');
            // 调整了 padding，让视觉更紧凑
            recentDiv.style.cssText = 'display: flex; padding: 10px 12px 6px 12px; gap: 8px; border-bottom: 1px solid var(--border); background: var(--bg-color);';
            recents.forEach(rKey => {
                const btn = document.createElement('div');
                btn.style.cssText = 'flex: 1; min-width: 0; background: var(--card-bg); border: 1px solid var(--border); border-radius: 6px; padding: 6px 4px; font-size: 12px; color: var(--text-main); text-align: center; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; user-select: none; transition: background 0.2s;';
                btn.textContent = rKey;
                btn.title = rKey;
                btn.onmousedown = () => btn.style.background = 'var(--border)';
                btn.onmouseup = () => btn.style.background = 'var(--card-bg)';
                btn.onmouseleave = () => btn.style.background = 'var(--card-bg)';
                btn.onclick = (e) => {
                    e.stopPropagation();
                    const targetOpt = Array.from(playlistOpts.querySelectorAll('.select-option')).find(li => li.dataset.key === rKey);
                    if (targetOpt) targetOpt.click();
                };
                recentDiv.appendChild(btn);
            });
            stickyGroup.appendChild(recentDiv);
        }

        // 2. 再插入固定的三个：在线资源、曲库搜索、我的歌单
        const stickyUl = document.createElement('ul');
        stickyUl.style.cssText = 'padding: 0; margin: 0; list-style: none; background: transparent;';
        stickyGroup.appendChild(stickyUl);
        playlistOpts.appendChild(stickyGroup); // 把整个置顶块放进下拉框

        const stickyKeys = ['在线资源', '曲库搜索', '我的歌单'];
        stickyKeys.forEach(key => {
            if (allCleanKeys.includes(key)) {
                createOpt(key, stickyUl);
            }
        });

        // 极端兜底情况隐藏
        if (stickyUl.children.length === 0 && recents.length === 0) stickyGroup.style.display = 'none';

        // 3. 渲染其余的系统基础歌单
        systemKeys.forEach(key => {
            if (!stickyKeys.includes(key)) {
                createOpt(key);
            }
        });

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

    // 🌟 全局挂载：列表图片 404 时的抢救器
    window.handleListCoverError = function(imgEl, index) {
        if (imgEl.src !== window.defaultCover) {
            imgEl.src = window.defaultCover;
            const rawItem = window.songList[index];
            if (rawItem && !rawItem._scrapedCover) {
                window.fetchScrape(rawItem, 'cover').then(hdCover => {
                    if (hdCover) {
                        rawItem._scrapedCover = hdCover;
                        imgEl.src = hdCover;
                        // 如果刚好是正在播放的歌，顺便把播放器里变空白的封面也更新了
                        if (window.currentIndex === index && window.updateNpTitleUI) {
                             const fpCover = document.getElementById('fp-cover');
                             if (fpCover && fpCover.src.includes('svg+xml')) fpCover.src = hdCover;
                             const miniCoverImg = document.getElementById('mini-cover-img');
                             if (miniCoverImg && miniCoverImg.src.includes('svg+xml')) miniCoverImg.src = hdCover;
                        }
                    }
                }).catch(()=>{});
            }
        }
    };

    // 🌟 全局挂载：海报墙歌单封面 404 时的抢救器
    window.handlePlaylistCoverError = function(imgEl, plName) {
        if (imgEl.src !== window.defaultCover) {
            // 先瞬间用默认图兜底，防止浏览器无限闪烁死循环
            imgEl.src = window.defaultCover;

            const playlistSongs = window.getMergedSongList(plName);
            if (playlistSongs && playlistSongs.length > 0) {
                // 开启连环刮削抢救（向后查最多 5 首歌）
                (async () => {
                    let foundCover = null;
                    const maxCheck = Math.min(playlistSongs.length, 5);
                    for (let i = 0; i < maxCheck; i++) {
                        const checkSong = playlistSongs[i];
                        if (checkSong._scrapedCover === window.defaultCover) continue;

                        const hdCover = await window.fetchScrape(checkSong, 'cover');
                        if (hdCover) {
                            foundCover = hdCover;
                            if (typeof checkSong === 'object') checkSong._scrapedCover = hdCover;
                            break; // 💡 抢救到一张高清图，立刻停止！
                        } else {
                            if (typeof checkSong === 'object') checkSong._scrapedCover = window.defaultCover;
                        }
                    }
                    if (foundCover && imgEl) {
                        imgEl.src = foundCover; // 强行贴上救回来的高清封面！
                    }
                })();
            }
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

        const globalToken = window.getAccessToken ? window.getAccessToken() : "";

        // 🌟 新增：确保在 DOM 结构里，海报墙永远稳稳压在歌曲列表的上方！
        if (grid && list && list.parentNode && grid.nextElementSibling !== list) {
            list.parentNode.insertBefore(grid, list);
        }
        if (window.listObserver) window.listObserver.disconnect(); // 清理下方列表可能的遗留

        // 1. 渲染我的网格 (海报墙)
        const isWebDavGrid = window.isWebDAVMode && window.currentPlaylist === '在线资源' && window.currentOnlineView === 'playlist';
        const isSearchGrid = window.currentPlaylist === '曲库搜索' && window.matchedLocalPlaylists && window.matchedLocalPlaylists.length > 0;
        // 🌟 新增：判定当前是否处于 WebDAV 的“混合搜索”状态！
        const isWebDavSearchGrid = window.isWebDAVMode && window.currentPlaylist === '在线资源' && window.currentOnlineView === 'song' && window.matchedWebDavPlaylists && window.matchedWebDavPlaylists.length > 0;

        const showGrid = window.currentPlaylist === '我的歌单' || isWebDavGrid || isSearchGrid || isWebDavSearchGrid;

        if (showGrid) {
            if (list && !isSearchGrid && !isWebDavSearchGrid) list.style.display = 'none'; // 🌟 搜索模式绝对不隐藏下方列表
            if (grid) grid.style.display = 'grid';

            if (grid) {
                let matchText = '';
                if (isSearchGrid) matchText = `匹配到的歌单 (${window.matchedLocalPlaylists.length})`;
                else if (isWebDavSearchGrid) matchText = `匹配到的歌单 (${window.matchedWebDavPlaylists.length})`;
                grid.innerHTML = matchText ? `<div style="grid-column: 1 / -1; font-size: 13px; font-weight: bold; color: var(--text-sub); margin-bottom: -4px; padding-left: 4px;">${matchText}</div>` : '';
            }

            const metas = isWebDavGrid ? (window.webdavPlaylistMeta || []) :
                          isWebDavSearchGrid ? window.matchedWebDavPlaylists :
                          (isSearchGrid ? window.matchedLocalPlaylists :
                          [...(window.playlistMeta || [])]
                              .filter(pl => pl.name !== '所有电台' && pl.name !== '电台收藏')
                              .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')));

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
                                // 🌟 智能寻回：向下遍历，必须排除掉默认的 window.defaultCover（防之前刮削失败的缓存干扰）
                                const validSong = playlistSongs.find(s =>
                                    (s._scrapedCover && s._scrapedCover !== 'null' && s._scrapedCover !== 'undefined' && s._scrapedCover !== window.defaultCover) ||
                                    (s.cover_url && s.cover_url !== 'null' && s.cover_url !== 'undefined' && s.cover_url.trim() !== '')
                                );

                                if (validSong) {
                                    if (validSong._scrapedCover && validSong._scrapedCover !== 'null' && validSong._scrapedCover !== 'undefined') {
                                        img.src = validSong._scrapedCover;
                                        window.playlistObserver.unobserve(card);
                                    } else {
                                        img.src = `${validSong.cover_url}&access_token=${globalToken}`;
                                        window.playlistObserver.unobserve(card);
                                    }
                                } else {
                                    // 🌟 深度连环刮削：如果没找到现成封面，依次抓前几首歌去全网请求，直到成功为止！
                                    if (card._scrapeTimer) clearTimeout(card._scrapeTimer);
                                    card._scrapeTimer = setTimeout(async () => {
                                        if (!card._inView) return;
                                        window.playlistObserver.unobserve(card);

                                        let foundCover = null;
                                        // 限制最多只往后查 5 首歌，防止无封面文件夹引起服务器 API 并发爆炸
                                        const maxCheck = Math.min(playlistSongs.length, 5);

                                        for (let i = 0; i < maxCheck; i++) {
                                            if (!card._inView) break;
                                            const checkSong = playlistSongs[i];

                                            // 如果这首歌之前已经被刮削过且确认为无封面，直接跳过，省一次网络请求
                                            if (checkSong._scrapedCover === window.defaultCover) continue;

                                            // 🚀 触发刮削器
                                            const hdCover = await window.fetchScrape(checkSong, 'cover');

                                            if (hdCover) {
                                                foundCover = hdCover;
                                                if (typeof checkSong === 'object') checkSong._scrapedCover = hdCover;
                                                break; // 💡 一旦找到有效封面，立刻终结循环！
                                            } else {
                                                // 没找到，给这首歌打上黑名单缓存，下次就算重新加载页面也不去查它了
                                                if (typeof checkSong === 'object') checkSong._scrapedCover = window.defaultCover;
                                            }
                                        }

                                        if (!card._inView) return;
                                        if (foundCover) {
                                            img.src = foundCover;
                                        } else {
                                            img.src = window.defaultCover;
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

                // 🌟 严格视图隔离：只有身处网盘页面时，卡片才用云朵 SVG！
                const isCustom = (isWebDavGrid || isWebDavSearchGrid) ? false : (window.customPlaylistNames && window.customPlaylistNames.includes(pl.name));
                let nameIconHtml = '';
                if (isWebDavGrid || isWebDavSearchGrid) {
                    // ⚡ 注入 flex-shrink: 0 确保大小绝不变小，修改 margin-top 让云朵图标完美居中对齐第一行文本
                    nameIconHtml = window.SVG_ICONS.webdav.replace('width="15"', 'width="12"').replace('height="15"', 'height="12"').replace('margin-right: 6px', 'margin-right: 4px; flex-shrink: 0; margin-top: 2px;').replace('transform: translateY(-1px)', '');
                } else {
                    const rawSvg = isCustom ? window.SVG_ICONS.disc : window.SVG_ICONS.folder;
                    // ⚡ 强行注入 flex-shrink: 0 彻底防止图标因字数过长被挤压变小，并加入 margin-top: 2px 对齐首行
                    nameIconHtml = rawSvg.replace('<svg ', '<svg style="margin-right: 4px; flex-shrink: 0; margin-top: 2px; opacity: 0.9;" ').replace('width="15"', 'width="12"').replace('height="15"', 'height="12"');
                }

                const conf = (isWebDavGrid || isWebDavSearchGrid) ? {} : window.getPlaylistConfig(pl.name);
                let subText = `共 ${pl.song_count || 0} 首`;
                if (conf.speedLocal && conf.speedLocal !== 1.0) subText += ` · ${window.formatSpeed(conf.speedLocal)}`;
                if (conf.resumeLocal && conf.resumeLocal !== 'off') subText += ` · 续播`;

                // 🌟 核心布局调整：改为 flex-start 顶部对齐...
                card.innerHTML = `
                  <img class="pl-cover-img" src="${window.defaultCover}" onerror="if(window.handlePlaylistCoverError) window.handlePlaylistCoverError(this, decodeURIComponent('${encodeURIComponent(pl.name)}'))" alt="cover">
                  <div class="pl-overlay">
                    <div class="pl-name" style="display: flex; align-items: flex-start;">${nameIconHtml}<span style="flex: 1; min-width: 0; word-break: break-all;">${pl.name}</span></div>
                    <div class="pl-time">${subText}</div> </div>
                  <div class="pl-playcount">
                    <svg viewBox="0 0 24 24" width="10" height="10" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path></svg>
                  </div>
                `;

                // 🌟 新架构：统一使用事件委托的数据标签
                card.dataset.action = 'open_playlist';
                card.dataset.plEngine = (isWebDavGrid || isWebDavSearchGrid) ? 'WebDAV' : 'Local';

                grid.appendChild(card);
                window.playlistObserver.observe(card);
            });

            // 🌟 核心突破：如果是搜歌单模式，渲染完海报墙后，绝不 return！继续往下走去渲染歌曲列表！
            if (!isSearchGrid && !isWebDavSearchGrid) {
                window.currentIndex = -1;
                return;
            }
        } else {
            if (grid) grid.style.display = 'none'; // 确保没搜到歌单时网格隐藏
        }

        // 2. 渲染歌曲列表
        if (window.songList.length === 0) {
            const hasGridMatch = (isSearchGrid && window.matchedLocalPlaylists.length > 0) || (isWebDavSearchGrid && window.matchedWebDavPlaylists.length > 0);
            playlistEl.innerHTML = hasGridMatch
                ? '<li style="list-style:none; text-align: center; padding: 40px; color: var(--text-sub); font-size: 14px;">没有匹配的歌曲</li>'
                : '<li style="list-style:none; text-align: center; padding: 40px; color: var(--text-sub); font-size: 14px;">列表为空</li>';
            window.currentIndex = -1;
            return;
        }

        // 🌟 搜歌单模式下，给歌曲列表加上一个小标题区分
        if ((isSearchGrid || isWebDavSearchGrid) && window.songList.length > 0) {
            // ⚡ 优化：去除了 Emoji，并通过 margin-top: -12px 把标题往上拉，消除多余的空隙
            playlistEl.insertAdjacentHTML('beforeend', `<li style="list-style:none; padding: 0 10px 8px 10px; margin-top: -12px; font-size: 13px; font-weight: bold; color: var(--text-sub);">匹配到的歌曲 (${window.songList.length})</li>`);
        }

        // 🌟 给歌曲列表新建一个专属的观察器，防止覆盖上面海报墙的！
        window.listObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const li = entry.target;

                // 🌟 终极优化：切回上级菜单导致列表隐藏时，立刻瞬间退出！
                if (!entry.isIntersecting) {
                    li._inView = false;
                    if (li._scrapeTimer) {
                        clearTimeout(li._scrapeTimer);
                        li._scrapeTimer = null;
                    }
                    return;
                }

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
                coverUrl = `${rawItem.cover_url}&access_token=${globalToken}`;
            } else {
                needsScrape = true;
            }

            const imgId = `list-cover-${index}`;
            const coverHtml = `<img id="${imgId}" class="song-cover-img" src="${window.defaultCover}" ${coverUrl ? `data-src="${coverUrl}"` : ''} ${needsScrape ? `data-scrape="true"` : ''} onerror="if(window.handleListCoverError) window.handleListCoverError(this, ${index})" alt="cover">`;

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
            let pluginTagHtml = '';

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
                // ✅ 2. 补上之前漏掉的赋值，让曲库搜索里的来源歌单名字正常显示
                if (foundPl) {
                    sourceTagHtml = `<div class="song-playlist-tag">${foundPl}</div>`;
                }
            }

            let pCode = '';
            let isDavSource = false;

            // 🌟 修复 1&2：动态提取网盘真实的文件夹名(歌单名)，并设立独立判定通道
            if (rawItem.plugin_entry_path === 'dav') {
                let sd = rawItem.source_data || {};
                if (typeof sd === 'string') { try { sd = JSON.parse(sd); } catch(e){} }
                try {
                    // 🌟 终极优化：优先从 sd.path 提取，如果收藏后丢失，则降级去切 dedup_key！
                    let pathStr = sd.path || rawItem.dedup_key || '';
                    let parts = pathStr.split('/').filter(Boolean);
                    if (parts.length > 1) {
                        // 完美切出倒数第二段作为文件夹名（即歌单名）
                        pCode = parts[parts.length - 2];
                    } else {
                        pCode = sd.configName || "网盘资源";
                    }
                } catch(e) { pCode = "网盘资源"; }
                isDavSource = true;

            } else if (rawItem.plugin_entry_path === 'lxmusic' && rawItem.dedup_key) {
                pCode = rawItem.dedup_key.split(':')[0];
            } else if (rawItem._isOnlineObj && rawItem.source_data && rawItem.source_data.source) {
                pCode = rawItem.source_data.source;
            }

            if (pCode) {
                let pName = (window.PLATFORM_MAP && window.PLATFORM_MAP[pCode]) ? window.PLATFORM_MAP[pCode] : pCode;
                if (pName === '网易云') pName = '网易';
                if (pName === 'QQ音乐') pName = 'QQ';

                const targetSvg = isDavSource ? window.SVG_ICONS.webdav : (window.SVG_ICONS && window.SVG_ICONS.lx_plugin_line ? window.SVG_ICONS.lx_plugin_line : '');

                if (isDavSource) {
                    // 🌟 智能截断：中文算2，英文算1。超过10宽度(5个中文字)时，截断保留8宽度(4个中文字) + ...
                    let totalLen = 0;
                    for (let i = 0; i < pName.length; i++) totalLen += pName.charCodeAt(i) > 255 ? 2 : 1;

                    let finalName = pName;
                    if (totalLen > 10) { // 超过 5 个字
                        let tempLen = 0, cutIdx = 0;
                        for (let i = 0; i < pName.length; i++) {
                            tempLen += pName.charCodeAt(i) > 255 ? 2 : 1;
                            if (tempLen > 8) { cutIdx = i; break; } // 卡在第 4 个字处
                        }
                        finalName = pName.substring(0, cutIdx) + '...';
                    }

                    pluginTagHtml = `<div class="song-plugin-tag" style="color: #3B6FE0; border-color: rgba(59, 111, 224, 0.3); background: rgba(59, 111, 224, 0.08);">${targetSvg}${finalName}</div>`;
                } else {
                    pluginTagHtml = `<div class="song-plugin-tag">${targetSvg}${pName}</div>`;
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
              ${pluginTagHtml}
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
            window.listObserver.observe(li); // 🌟 换成专属的歌曲列表观察器
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
                    let parsedStr = cachedDataStr;
                    if (window.LZString) {
                        const decompressed = window.LZString.decompressFromUTF16(cachedDataStr);
                        if (decompressed) parsedStr = decompressed;
                    }

                    // 🌟 修复：必须解析解压后的 parsedStr，而不是原始的 cachedDataStr
                    const cache = JSON.parse(parsedStr);

                    window.customPlaylistNames = cache.customPlaylistNames || [];
                    window.playlistMeta = cache.playlistMeta || [];

                    const poolMap = new Map((cache.songsPool || []).map(s => [s.id, s]));

                    // 🌟 核心修复 1：在覆盖 allPlaylists 之前，必须先将内存中现存的 WebDAV/搜索数据保护起来！
                    const tempOnlineCache = window.allPlaylists ? (window.allPlaylists["在线资源"] || []) : [];
                    const tempSearchCache = window.allPlaylists ? (window.allPlaylists["曲库搜索"] || []) : [];

                    window.allPlaylists = {};

                    for (const [plName, idArray] of Object.entries(cache.playlistsMap || {})) {
                        window.allPlaylists[plName] = idArray.map(id => poolMap.get(id)).filter(Boolean);
                    }

                    if (!window.allPlaylists["收藏"]) window.allPlaylists["收藏"] = [];
                    if (!window.allPlaylists["我的歌单"]) window.allPlaylists["我的歌单"] = []; // 🌟 补上“我的歌单”

                    // 🌟 核心修复 2：将保护好的数据原封不动还原回去，防止被无情清零！
                    window.allPlaylists["曲库搜索"] = tempSearchCache;
                    window.allPlaylists["在线资源"] = tempOnlineCache;

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
                        localStorage.removeItem('iwebplayer.global_cache_v2');
                        localStorage.removeItem('iwebplayer.global_cache');

                        const cacheObj = {
                            customPlaylistNames: window.customPlaylistNames,
                            playlistMeta: window.playlistMeta,
                            songsPool: Array.from(syncSongsMap.values()),
                            playlistsMap: playlistsMap
                        };

                        // 🌟 核心：将 JSON 字符串进行 UTF-16 极限压缩
                        const jsonStr = JSON.stringify(cacheObj);
                        const finalStorageStr = window.LZString ? window.LZString.compressToUTF16(jsonStr) : jsonStr;

                        localStorage.setItem('iwebplayer.global_cache', finalStorageStr);

                        // 可选：在控制台打印一下压缩成果，你会非常有成就感
                        //console.log(`🗜️ 压缩率: ${((finalStorageStr.length / jsonStr.length) * 100).toFixed(1)}% | 压缩后大小: ${(finalStorageStr.length / 1024).toFixed(1)} KB`);

                    } catch (quotaError) {
                        console.error("存盘失败，手机容量已满:", quotaError);
                    }

                    // 4. 🔄 覆写内存，激活界面
                    const tempOnline = window.allPlaylists["在线资源"] || [];
                    const tempSearch = window.allPlaylists["曲库搜索"] || [];

                    // 🌟 极简状态继承：把旧数据里刚才已经抓到的封面，原封不动贴到新数据上！
                    if (window.allPlaylists) {
                        for (const [plName, oldSongs] of Object.entries(window.allPlaylists)) {
                            const newSongs = syncReconstructed[plName];
                            if (oldSongs && newSongs) {
                                // 建立一个极简字典，只收集刚才屏幕上已经抓到封面的歌曲
                                const coverMap = {};
                                oldSongs.forEach(s => {
                                    const sName = window.getSongNameObj(s);
                                    if (sName && s._scrapedCover) coverMap[sName] = s._scrapedCover;
                                });
                                // 给新拉回来的歌曲贴上旧封面
                                newSongs.forEach(s => {
                                    const sName = window.getSongNameObj(s);
                                    if (sName && coverMap[sName]) s._scrapedCover = coverMap[sName];
                                });
                            }
                        }
                    }

                    window.allPlaylists = syncReconstructed;
                    // 🌟 顺手把这里可能清空首页数据的垃圾代码删除了
                    if (!window.allPlaylists["收藏"]) window.allPlaylists["收藏"] = [];
                    if (!window.allPlaylists["我的歌单"]) window.allPlaylists["我的歌单"] = []; // 🌟 补上“我的歌单”
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