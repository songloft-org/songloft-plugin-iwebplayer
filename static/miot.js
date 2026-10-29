// static/miot.js
(function(window) {
    'use strict';

    // 🌟 MIoT 智能音箱全局管理器
    window.MiotManager = {
        devices: [],
        hasMiotPlugin: true, // 🌟 新增：标记是否安装了插件
        currentDevice: {
            id: localStorage.getItem('iwebplayer.target_device') || 'local',
            type: localStorage.getItem('iwebplayer.target_device_type') || 'local',
            accountId: localStorage.getItem('iwebplayer.target_account') || '',
            name: '本机'
        },
        wsStatus: null,
        pingTimer: null,
        _hasAutoJumped: false, // 标记是否已经执行过自动寻回跳转

        // 🌟 虚拟时钟引擎参数
        virtualClockId: null,
        lastWsPos: 0,
        lastWsDuration: 0,
        lastWsTime: 0,
        lastWsSpeed: 1,
        isWsPlaying: false,
        _stateLockTime: 0,
        _seekLockTime: 0,

        // 初始化入口
        init: async function() {
            await this.loadDevices();

            // 🌟 新增：读取偏好设置，决定默认启动设备
            const prefs = typeof window.getPreferences === 'function' ? window.getPreferences() : {};
            const defDevSetting = prefs.defaultDevice || 'last';

            if (defDevSetting === 'local') {
                this.currentDevice = { id: 'local', type: 'local', accountId: '', name: '本机' };
            } else if (defDevSetting.startsWith('miot:')) {
                const targetDevId = defDevSetting.replace('miot:', '');
                const foundDev = this.devices.find(d => d.deviceID === targetDevId);
                if (foundDev) {
                    this.currentDevice = {
                        id: foundDev.deviceID,
                        type: 'miot',
                        accountId: foundDev.account_id,
                        name: foundDev.name
                    };
                } else {
                    // 如果设定的音箱下线或被删，回退至“本机”
                    this.currentDevice = { id: 'local', type: 'local', accountId: '', name: '本机' };
                }
            }

            this.renderDeviceList();
            this.bindEvents();
            // ...

            if (this.currentDevice && this.currentDevice.type === 'miot') {
                document.body.classList.add('miot-mode');
                this.connectStatusWs(this.currentDevice.accountId, this.currentDevice.id);
                this.startVirtualClock();
            }
        },

        // 从后端探测并拉取设备列表
        loadDevices: async function() {
            try {
                const res = await fetch('/api/v1/jsplugin/miot/mina/devices');
                // 🌟 如果报 404/403，说明没装插件或者没启用
                if (!res.ok) {
                    this.hasMiotPlugin = false;
                    return;
                }

                const resJson = await res.json();
                if (!resJson.success || !resJson.data) {
                    this.hasMiotPlugin = false;
                    return;
                }

                this.hasMiotPlugin = true;
                this.devices = [];
                resJson.data.forEach(account => {
                    if (account.devices && account.devices.length > 0) {
                        account.devices.forEach(dev => {
                            // 🌟 默认附加一个 is_playing = false 属性
                            this.devices.push({ ...dev, account_id: account.account_id, is_playing: false });
                        });
                    }
                });

                // 🌟 核心突破：不阻塞主流程，异步并发查询所有在线设备的播放状态
                const statusPromises = this.devices.map(async (dev) => {
                    if (dev.presence === 'online') {
                        try {
                            const statusRes = await fetch(`/api/v1/jsplugin/miot/player/status?account_id=${dev.account_id}&device_id=${dev.deviceID}`);
                            if (statusRes.ok) {
                                const statusJson = await statusRes.json();
                                if (statusJson.success && statusJson.data && statusJson.data.state === 'playing') {
                                    dev.is_playing = true; // 查到正在播放，打上标记！
                                }
                            }
                        } catch(e) {}
                    }
                });

                // 🌟 状态全部查完后，静默触发一次 UI 重绘（用户感知：瞬间出列表，半秒后有个图标变成了跳动波浪）
                Promise.all(statusPromises).then(() => {
                    this.renderDeviceList();
                });

            } catch (e) {
                this.hasMiotPlugin = false;
                console.warn("[MIoT] 设备拉取失败或未安装插件", e);
            }
        },

        // 渲染设备下拉框 HTML
        renderDeviceList: function() {
            const deviceOpts = document.getElementById('device-opts');
            const deviceVal = document.getElementById('device-val');
            if (!deviceOpts || !deviceVal) return;

            const isMobile = window.isIOS || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
            const localIcon = isMobile
                ? `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px; flex-shrink: 0;"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>`
                : `<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px; flex-shrink: 0;"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>`;

            let html = `
                <li class="select-option ${this.currentDevice.id === 'local' ? 'active' : ''}" data-value="local" data-type="local" data-name="本机">
                    <div style="display: flex; align-items: center; width: 100%;">
                        ${localIcon}
                        <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">本机</span>
                    </div>
                </li>
            `;

            if (!this.hasMiotPlugin || this.devices.length === 0) {
                const tipText = !this.hasMiotPlugin ? '小爱音箱 <span style="font-size: 11px; opacity: 0.6;">(未启用插件)</span>' : '小爱音箱 <span style="font-size: 11px; opacity: 0.6;">(未发现设备)</span>';
                html += `
                <li class="select-option disabled-text" data-type="disabled">
                    <div style="display: flex; align-items: center; width: 100%;">
                        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px; flex-shrink: 0;">
                            <rect x="4" y="2" width="16" height="20" rx="4" ry="4"></rect>
                            <line x1="12" y1="18" x2="12.01" y2="18" stroke-width="3"></line>
                        </svg>
                        <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${tipText}</span>
                    </div>
                </li>`;
            } else {
                this.devices.forEach(dev => {
                    const isOnline = dev.presence === 'online';
                    const dotColor = isOnline ? '#10b981' : 'var(--text-sub)';
                    const isActive = this.currentDevice.id === dev.deviceID;

                    if (isActive) this.currentDevice.name = dev.name;

                    // 🌟 动态计算 SVG：如果正在播放，显示粉红色跳动波浪！
                    let iconHtml = '';
                    if (dev.is_playing) {
                        iconHtml = `
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="var(--primary)" style="margin-right: 4px; flex-shrink: 0;">
                                <rect x="5" y="10" width="3" height="10" class="eq-bar eq-bar-1"></rect>
                                <rect x="10.5" y="5" width="3" height="15" class="eq-bar eq-bar-2"></rect>
                                <rect x="16" y="12" width="3" height="8" class="eq-bar eq-bar-3"></rect>
                            </svg>
                        `;
                    } else {
                        iconHtml = `
                            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px; flex-shrink: 0;">
                                <rect x="4" y="2" width="16" height="20" rx="4" ry="4"></rect>
                                <circle cx="12" cy="14" r="3" fill="${dotColor}" stroke="none"></circle>
                                <line x1="12" y1="6" x2="12" y2="6.01" stroke-width="3"></line>
                            </svg>
                        `;
                    }

                    // 💡 如果在播放，连带字体也会变成粉红色粗体以示高亮
                    const textStyle = dev.is_playing ? 'color: var(--primary); font-weight: bold;' : '';

                    html += `
                    <li class="select-option ${isActive ? 'active' : ''}" data-value="${dev.deviceID}" data-account="${dev.account_id}" data-type="miot" data-name="${dev.name}" ${!isOnline ? 'style="opacity: 0.6;"' : ''}>
                        <div style="display: flex; align-items: center; width: 100%;">
                            ${iconHtml}
                            <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; ${textStyle}">${dev.name}</span>
                        </div>
                    </li>`;
                });
            }

            deviceOpts.innerHTML = html;
            deviceVal.innerText = this.currentDevice.name;
            deviceVal.dataset.value = this.currentDevice.id;
        },

        // 绑定下拉框点击事件
        bindEvents: function() {
            const deviceOpts = document.getElementById('device-opts');
            if (!deviceOpts) return;

            deviceOpts.addEventListener('click', (e) => {
                const li = e.target.closest('.select-option');
                if (!li) return;
                e.stopPropagation();

                // 🌟 拦截：点击占位提示项时，弹出引导，不进行设备切换
                if (li.dataset.type === 'disabled') {
                    deviceOpts.classList.remove('show');
                    if (!this.hasMiotPlugin) {
                        if (window.showToast) window.showToast('💡 请先在 SongLoft 主程序中安装并配置 "智能音箱" 插件');
                    } else {
                        if (window.showToast) window.showToast("💡 插件已启用，但您的账号下暂未发现智能音箱");
                    }
                    return;
                }

                const id = li.dataset.value;
                const type = li.dataset.type || 'local';
                const accountId = li.dataset.account || '';
                const name = li.dataset.name || '本机';

                deviceOpts.querySelectorAll('.select-option').forEach(el => el.classList.remove('active'));
                li.classList.add('active');

                this.selectDevice(id, type, accountId, name);
                deviceOpts.classList.remove('show');
            });
        },

        // 核心切换逻辑
        selectDevice: function(id, type, accountId, name) {
            // 🌟 1. 获取切换前的状态，用于判断是 "切向小爱" 还是 "切回本机"
            const prevType = this.currentDevice.type;
            const audioEl = document.getElementById('audio');

            // 🌟 2. 切向小爱：【本机静音保护与现场备份】
            if (prevType === 'local' && type === 'miot') {
                // 备份本机的现场 (当前歌单、索引、进度、是否正在播放)
                this._savedLocalState = {
                    playlist: window.currentPlaylist,
                    index: window.currentIndex,
                    time: audioEl ? audioEl.currentTime : 0,
                    wasPlaying: audioEl && !audioEl.paused // 🌟 记录本机之前的播放状态
                };
                // 本机无条件闭嘴，交出声音控制权
                if (audioEl && !audioEl.paused) {
                    audioEl.pause();
                }
            }

            this.currentDevice = { id, type, accountId, name };
            const deviceVal = document.getElementById('device-val');
            if (deviceVal) {
                deviceVal.innerText = name;
                deviceVal.dataset.value = id;
            }
            localStorage.setItem('iwebplayer.target_device', id);
            localStorage.setItem('iwebplayer.target_device_type', type);
            localStorage.setItem('iwebplayer.target_account', accountId);

            if (window.showToast) window.showToast(`✅ 已切换至：${name}`);

            // 🌟 动态切换 body 的隐身披风
            if (type === 'miot') {
                document.body.classList.add('miot-mode');

                // 🌟 核心修复：每次切向小爱，必须重置寻回标记！让它能重新定位小爱所在的歌单
                this._hasAutoJumped = false;

                this.connectStatusWs(accountId, id);
                this.startVirtualClock();
            } else {
                document.body.classList.remove('miot-mode');
                this.disconnectStatusWs();
                this.stopVirtualClock();

                // 恢复本机的独立音量数值
                const localVol = localStorage.getItem('iwebplayer.player_volume') || 100;
                const volSlider = document.getElementById('volume-slider');
                const volText = document.getElementById('volume-text');

                if (volSlider) volSlider.value = localVol;
                if (volText) volText.innerText = localVol + '%';
                if (window.updateVolumeIcon) window.updateVolumeIcon(localVol);
                if (audioEl) audioEl.volume = localVol / 100;

                // 切回本机时，强行把本机的独立播放顺序从缓存里恢复回来！
                const storedMode = parseInt(localStorage.getItem('iwebplayer.local_play_mode'));
                window.playMode = isNaN(storedMode) ? 1 : storedMode;
                if (window.updatePlayModeUI) window.updatePlayModeUI();

                // 🌟 3. 切回本机：【还原并自动播放】
                if (this._savedLocalState && typeof window.playSong === 'function') {
                    const { playlist, index, time, wasPlaying } = this._savedLocalState;
                    if (index !== -1) {
                        // 如果在看小爱时歌单被偷偷切了（寻回逻辑），必须先静默切回来
                        if (playlist && window.currentPlaylist !== playlist && typeof window.switchPlaylistSilently === 'function') {
                            window.switchPlaylistSilently(playlist);
                        }
                        // 🌟 动态决定是否起播：如果切走前在放，切回来就放；切走前暂停，切回来也暂停
                        window.playSong(index, !!wasPlaying, time, { resumeKind: 'session' });
                    }
                    this._savedLocalState = null; // 消费完清空
                } else if (audioEl && audioEl.src && audioEl.src !== window.location.href) {
                    // 兜底逻辑：如果内存刚好被清理，但播放器还在，直接唤醒
                    audioEl.play().catch(()=>{});
                    if (window.updatePlayButtonUI) window.updatePlayButtonUI(true);
                }
            }

            // 🌟 核心修复：强行刷新一次底部播放按钮，防止双端都未播放时图标不切换！
            if (window.updatePlayButtonUI) window.updatePlayButtonUI(window.isPlaying);
            if (window.updateVolumeBtnUI) window.updateVolumeBtnUI(); // 切设备时刷新音量图标状态
        },
        // 向小爱音箱下发播放指令
        playPlaylist: async function(playlistId, startIndex) {
            // 🌟 动态映射当前播放模式
            const modeMap = { 0: 'order', 1: 'loop', 2: 'random', 3: 'single' };
            const currentModeStr = modeMap[window.playMode] || 'order';

            const payload = {
                account_id: this.currentDevice.accountId,
                device_id: this.currentDevice.id,
                playlist_id: playlistId,
                start_index: startIndex,
                play_mode: currentModeStr
            };

            if (window.showToast) window.showToast("🎵 正在呼叫音箱播放...");

            // 🌟 1. 乐观更新：立刻让图标变成“暂停(播放中)”形状，不等待网络返回
            if (window.updatePlayButtonUI) window.updatePlayButtonUI(true);
            this.isWsPlaying = true;
            this.lastWsPos = 0;
            this.lastWsDuration = 0;
            this._maxEstPos = 0;      // 🌟 新增：强制清空虚拟时钟的最高水位线

            // 🌟 同步让下拉框里的设备图标变成跳动波浪！
            const targetDev = this.devices.find(d => d.deviceID === this.currentDevice.id);
            if (targetDev && !targetDev.is_playing) {
                targetDev.is_playing = true;
                this.renderDeviceList();
            }

            try {
                const res = await fetch('/api/v1/jsplugin/miot/player/play', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const data = await res.json();
                if (!data.success) {
                    if (window.showToast) window.showToast("❌ 音箱拒绝播放: " + (data.msg || ""));
                    if (window.updatePlayButtonUI) window.updatePlayButtonUI(false);
                }
            } catch (e) {
                if (window.showToast) window.showToast("❌ 推送指令发送失败");
                if (window.updatePlayButtonUI) window.updatePlayButtonUI(false);
            }
        },

        // 向小爱音箱下发 暂停/继续 指令
        togglePlay: async function() {
            if (this.currentDevice.type !== 'miot') return;

            // ==========================================
            // 🌟 核心修复：幽灵状态下的无脑播放拦截
            // ==========================================
            // 如果刚切到一个空闲的音箱（_hasAutoJumped 为 false），
            // 此时直接发 toggle 恢复指令，音箱会唤醒它自己脑子里的上一首歌。
            // 我们必须拦截这个操作，把前端 UI 当前高亮的这首歌，强行当作一首新歌推过去！
            if (!this._hasAutoJumped && !window.isPlaying) {
                if (window.currentIndex !== -1 && typeof window.playSong === 'function') {
                    window.playSong(window.currentIndex, true);
                    return; // 拦截成功，直接退出，不发无脑的 toggle 指令
                }
            }

            // 🌟 1. 明确我们期望的目标状态 (想播放设为 true，想暂停设为 false)
            const targetState = !window.isPlaying;

            // 🌟 2. 乐观更新：立刻翻转图标，并加锁 4000 毫秒（拒绝听信滞后的 WebSocket 推送）
            this._stateLockTime = Date.now() + 4000;
            this.isWsPlaying = targetState;
            // 🌟 如果解除暂停，必须将物理时间的基准锚点拉到此刻，防止时间发生飞跃后回滚！
            if (targetState) {
                this.lastWsTime = performance.now();
            }
            if (window.updatePlayButtonUI) window.updatePlayButtonUI(targetState);

            // 🌟 同步更新下拉框里的图标
            const targetDev = this.devices.find(d => d.deviceID === this.currentDevice.id);
            if (targetDev && targetDev.is_playing !== targetState) {
                targetDev.is_playing = targetState;
                this.renderDeviceList();
            }

            try {
                // 发送无脑翻转的 toggle 指令
                const res = await fetch(`/api/v1/jsplugin/miot/player/toggle?account_id=${this.currentDevice.accountId}&device_id=${this.currentDevice.id}`, {
                    method: 'POST'
                });

                const data = await res.json();

                // 🌟 3. 终极纠偏黑科技：检查后端的翻转结果是不是我们想要的！
                if (data && data.success && data.data && data.data.state) {
                    const actualBackendState = data.data.state === 'playing';

                    // 如果后端因为缓存错乱，翻转成了相反的状态，我们毫秒级自动帮用户“再补一枪”！
                    if (actualBackendState !== targetState) {
                        console.warn(`[MIoT] 智能纠偏：后端无脑翻转导致状态(${data.data.state})与目标相反，自动补发纠正指令！`);
                        await fetch(`/api/v1/jsplugin/miot/player/toggle?account_id=${this.currentDevice.accountId}&device_id=${this.currentDevice.id}`, {
                            method: 'POST'
                        });
                    }
                }
            } catch (e) {
                // 网络异常，解锁并撤销状态
                this._stateLockTime = 0;
                this.isWsPlaying = !targetState;
                if (window.updatePlayButtonUI) window.updatePlayButtonUI(!targetState);
            }
        },

        // 🌟 新增：将前端的虚拟列表，动态打包注入到专属推送歌单中！
        syncListToPushPlaylist: async function(currentList) {
            try {
                // 1. 无情斩杀旧的推送歌单（确保数据干净，比一首首删快一万倍）
                let pushPl = window.playlistMeta ? window.playlistMeta.find(p => p.name === 'iWebPlayer推送') : null;
                if (pushPl) {
                    await fetch(`/api/v1/playlists/${pushPl.id}`, { method: 'DELETE' });
                }

                // 2. 瞬间重生一个新的同名歌单，拿到它热乎的 playlist_id
                const createRes = await fetch('/api/v1/playlists', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: 'iWebPlayer推送', type: 'normal' })
                });
                const newData = await createRes.json();
                const plId = newData.id;

                if (!plId) throw new Error("歌单创建失败，未返回 ID");

                // 3. 将前端列表精准分流
                const localSongIds = currentList.filter(s => !s._isOnlineObj).map(s => s.id).filter(Boolean);
                const davSongs = currentList.filter(s => s._isOnlineObj && s.plugin_entry_path === 'dav');
                const lxSongs = currentList.filter(s => s._isOnlineObj && s.plugin_entry_path !== 'dav').map(s => {
                    const payload = { ...s.source_data };
                    payload.quality = window.getBestLxQuality ? window.getBestLxQuality(payload, window.getLxQuality()) : '320k';
                    return payload;
                });

                // 4. 并行火力全开，分通道强行灌库
                const tasks = [];
                if (localSongIds.length > 0) {
                    tasks.push(fetch(`/api/v1/playlists/${plId}/songs`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ song_ids: localSongIds })
                    }));
                }

                if (davSongs.length > 0) {
                    tasks.push((async () => {
                        // WebDAV 必须先向主程序注册 Remote
                        const regRes = await fetch('/api/v1/songs/remote', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(davSongs)
                        });
                        const regData = await regRes.json();
                        if (regData && regData.songs && regData.songs.length > 0) {
                            const newIds = regData.songs.map(s => s.id);
                            await fetch(`/api/v1/playlists/${plId}/songs`, {
                                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ song_ids: newIds })
                            });
                        }
                    })());
                }

                if (lxSongs.length > 0) {
                    tasks.push(fetch('/api/v1/jsplugin/lxmusic/api/songs/import', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ songs: lxSongs, playlist_id: String(plId), new_playlist_name: "" })
                    }));
                }

                // 阻塞等待灌库完成（非常快，因为是批量接口）
                await Promise.all(tasks);

                // 5. 极致优化：不触发全量重载，直接在前端内存中"伪装"注入这个新歌单！
                // 这样既能让自动寻回逻辑找到它，又省去了所有的网络同步开销。
                if (window.playlistMeta) {
                    window.playlistMeta = window.playlistMeta.filter(p => p.name !== 'iWebPlayer推送');
                    window.playlistMeta.push({ id: plId, name: 'iWebPlayer推送', labels: ['auto_created'] });
                }
                if (window.allPlaylists) {
                    window.allPlaylists['iWebPlayer推送'] = [...currentList];
                }
                // 顺手重绘一下下拉框，让它立刻在菜单里出现
                if (typeof window.initPlaylistDropdown === 'function') {
                    window.initPlaylistDropdown();
                }

                return plId; // 立刻返回全新的 ID 给播放器用
            } catch (e) {
                console.error("[MIoT] 打包推送失败", e);
                return null;
            }
        },

        // 🌟 新增：向小爱音箱下发设置音量指令
        setVolume: async function(vol) {
            if (this.currentDevice.type !== 'miot') return;
            try {
                await fetch('/api/v1/jsplugin/miot/mina/volume', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        account_id: this.currentDevice.accountId,
                        device_id: this.currentDevice.id,
                        volume: parseInt(vol)
                    })
                });
            } catch (e) { console.warn("[MIoT] 音量调节失败", e); }
        },

        // 🌟 向小爱音箱下发设置播放速度指令
        setSpeed: async function(speed) {
            if (this.currentDevice.type !== 'miot') return;
            try {
                await fetch('/api/v1/jsplugin/miot/player/speed', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        account_id: this.currentDevice.accountId,
                        device_id: this.currentDevice.id,
                        speed: parseFloat(speed)
                    })
                });
            } catch (e) { console.warn("[MIoT] 速度调节失败", e); }
        },

        // 🌟 向小爱音箱下发调整进度指令
        seekTo: async function(position) {
            if (this.currentDevice.type !== 'miot') return;

            // 1. 乐观更新：立刻拨动本地虚拟时钟，并上锁 3 秒（防网络延迟弹回）
            this.lastWsPos = position;
            this.lastWsTime = performance.now();
            this._maxEstPos = position;
            this._seekLockTime = Date.now() + 3000;

            // 2. 瞬间更新 UI (时间和歌词)
            const timeCurrentEl = document.getElementById('time-current');
            if (timeCurrentEl) timeCurrentEl.innerText = window.formatTime(position);
            if (window.LyricsEngine) window.LyricsEngine.sync(position);

            try {
                await fetch('/api/v1/jsplugin/miot/player/seek', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        account_id: this.currentDevice.accountId,
                        device_id: this.currentDevice.id,
                        position: Math.floor(position) // 保险起见，给音箱传整数
                    })
                });
            } catch (e) { console.warn("[MIoT] 进度跳转失败", e); }
        },

        // 🌟 向小爱音箱下发设置播放模式指令
        setPlayMode: async function(modeIndex) {
            if (this.currentDevice.type !== 'miot') return;
            const modeMap = { 0: 'order', 1: 'loop', 2: 'random', 3: 'single' };
            const targetMode = modeMap[modeIndex] || 'order';
            try {
                await fetch(`/api/v1/jsplugin/miot/player/mode?account_id=${this.currentDevice.accountId}&device_id=${this.currentDevice.id}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ play_mode: targetMode })
                });
            } catch (e) { console.warn("[MIoT] 模式切换失败", e); }
        },

        // 断开 WebSocket
        disconnectStatusWs: function() {
            if (this.wsStatus) {
                this.wsStatus.onclose = null; // 屏蔽 onclose，防止主动断开时触发重连
                this.wsStatus.close();
                this.wsStatus = null;
            }
            if (this.pingTimer) {
                clearInterval(this.pingTimer);
                this.pingTimer = null;
            }
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
            }
            if (this.pollTimer) {
                clearInterval(this.pollTimer);
                this.pollTimer = null;
            }
        },

        // 连接播放状态 WebSocket (加入自动重连与 HTTP 轮询兜底)
        connectStatusWs: function(accountId, deviceId, retryCount = 0) {
            this.disconnectStatusWs();

            const token = typeof window.getAccessToken === 'function' ? window.getAccessToken() : '';
            if (!token) return;

            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}/api/v1/jsplugin/miot/status/ws?account_id=${accountId}&device_id=${deviceId}&access_token=${token}`;

            // 🛡️ HTTP 轮询兜底机制：WS 断线时每 2 秒拉一次状态，保证 UI 绝对不卡死
            const startFallbackPolling = () => {
                if (this.pollTimer) return;
                this.pollTimer = setInterval(async () => {
                    // 如果切回了本机或换了设备，立刻停止轮询
                    if (this.currentDevice.type !== 'miot' || this.currentDevice.id !== deviceId) {
                        clearInterval(this.pollTimer);
                        this.pollTimer = null;
                        return;
                    }
                    try {
                        const res = await fetch(`/api/v1/jsplugin/miot/player/status?account_id=${accountId}&device_id=${deviceId}`);
                        const data = await res.json();
                        if (data.success && data.data) {
                            this.syncUIWithMiotStatus(data.data);
                        }
                    } catch(e) {}
                }, 2000);
            };

            try {
                this.wsStatus = new WebSocket(wsUrl);

                this.wsStatus.onopen = () => {
                    retryCount = 0; // 连接成功，清零重连次数
                    if (this.pollTimer) {
                        clearInterval(this.pollTimer); // WS 活了，立刻停止 HTTP 兜底
                        this.pollTimer = null;
                    }
                    this.pingTimer = setInterval(() => {
                        if (this.wsStatus && this.wsStatus.readyState === WebSocket.OPEN) {
                            this.wsStatus.send(JSON.stringify({ type: 'ping' }));
                        }
                    }, 30000);
                };

                this.wsStatus.onmessage = (event) => {
                    try {
                        const msg = JSON.parse(event.data);
                        if (msg && msg.type === 'status' && msg.data) {
                            this.syncUIWithMiotStatus(msg.data);
                        }
                    } catch (e) {}
                };

                this.wsStatus.onerror = () => {
                    // onerror 触发后，浏览器会自动触发 onclose，由 onclose 统一处理重连
                };

                this.wsStatus.onclose = () => {
                    if (this.pingTimer) clearInterval(this.pingTimer);
                    this.wsStatus = null;

                    // 如果用户还在看小爱设备，开启急救模式
                    if (this.currentDevice.type === 'miot' && this.currentDevice.id === deviceId) {
                        startFallbackPolling(); // 立即启动轮询，稳住 UI

                        // 启动指数退避重连 (1s, 2s, 4s... 最多间隔 15s)
                        const delay = Math.min(1000 * Math.pow(2, retryCount), 15000);
                        this.reconnectTimer = setTimeout(() => {
                            this.connectStatusWs(accountId, deviceId, retryCount + 1);
                        }, delay);
                    }
                };

            } catch (e) {
                startFallbackPolling();
            }
        },
        // 🌟 3. 神级虚拟时钟：推演真实秒数，实现 60FPS 丝滑滚动
        startVirtualClock: function() {
            if (this.virtualClockId) return;
            const tick = () => {
                // 只有在小爱播放模式、且确实在播放、且获取到了总时长的情况下，才自己推算进度
                if (this.currentDevice.type === 'miot' && this.isWsPlaying && this.lastWsDuration > 0) {
                    const now = performance.now();
                    // 🌟 核心突破：推算时间必须乘上音箱的真实倍速！否则歌词会越跑越慢！
                    let estPos = this.lastWsPos + ((now - this.lastWsTime) / 1000) * (this.lastWsSpeed || 1);
                    if (estPos > this.lastWsDuration) estPos = this.lastWsDuration;

                    // 🌟 核心防回滚补丁：抹平网络延迟带来的进度跳变
                    if (this._maxEstPos === undefined) this._maxEstPos = 0;
                    if (estPos < this._maxEstPos) {
                        // 如果倒退误差在 2 秒以内，判定为网络推送滞后，强制稳住不动！
                        if (this._maxEstPos - estPos < 2) {
                            estPos = this._maxEstPos;
                        } else {
                            // 倒退极多（比如拖动进度条、切歌），才允许重置水位线
                            this._maxEstPos = estPos;
                        }
                    } else {
                        // 正常向前滚动，更新最高水位线
                        this._maxEstPos = estPos;
                    }

                    // 🌟 核心防冲突：如果用户正在拖拽进度条，坚决不让虚拟时钟覆写界面！
                    if (!window.isDragging) {
                        // 平滑更新时间文本
                        const timeCurrentEl = document.getElementById('time-current');
                        if (timeCurrentEl) {
                            const newText = window.formatTime(estPos);
                            if (timeCurrentEl.innerText !== newText) timeCurrentEl.innerText = newText;
                        }

                        // 平滑更新进度条
                        const progressBar = document.getElementById('progress-bar');
                        if (progressBar) {
                            progressBar.style.width = (estPos / this.lastWsDuration * 100) + '%';
                        }

                        // 平滑滚动歌词
                        if (window.LyricsEngine) window.LyricsEngine.sync(estPos);
                    }
                }
                this.virtualClockId = requestAnimationFrame(tick);
            };
            this.virtualClockId = requestAnimationFrame(tick);
        },

        stopVirtualClock: function() {
            if (this.virtualClockId) {
                cancelAnimationFrame(this.virtualClockId);
                this.virtualClockId = null;
            }
        },

        // 接收到后端的真实数据后，修正虚拟时钟的基准线
        // 接收到后端的真实数据后，修正虚拟时钟的基准线
        syncUIWithMiotStatus: function(data) {
            if (this.currentDevice.type !== 'miot') return;

            let isPlaying = data.state === 'playing';

            // 🌟 状态强制保护锁：如果处于刚点击暂停/播放的 2 秒内，拒绝听信网络传来的滞后状态！
            if (this._stateLockTime && Date.now() < this._stateLockTime) {
                isPlaying = this.isWsPlaying;
            }

            // ==========================================
            // 🌟 核心修复：幽灵状态隔离墙 & 首次跳跃标记
            // ==========================================
            let isGhostState = false;
            let isFirstActiveConnect = false; // 🌟 新增：专门标记“首次连上且正在播放”的瞬间

            if (!this._hasAutoJumped) {
                if (!isPlaying) {
                    isGhostState = true;
                } else {
                    this._hasAutoJumped = true;
                    isFirstActiveConnect = true; // 🌟 只有在这一次，才允许自动跳转歌单！
                }
            }

            let position = isGhostState ? 0 : (parseFloat(data.position) || 0);
            let duration = isGhostState ? 0 : (parseFloat(data.duration) || 0);

            // 🌟 进度保护锁：如果刚拖拽了进度条（3秒内），拒收服务器传来的落后进度！
            if (this._seekLockTime && Date.now() < this._seekLockTime) {
                position = this.lastWsPos;
            }

            // 🌟 不马上粗暴刷新时间！只把数据喂给虚拟时钟
            this.lastWsPos = position;
            this.lastWsDuration = duration;
            this.lastWsTime = performance.now(); // 记录此刻的物理时间锚点
            this.isWsPlaying = isPlaying;
            this.lastWsSpeed = data.speed || 1;  // 记录底层传来的真实倍速

            // ① 更新不会高频变动的总时长
            const timeDurationEl = document.getElementById('time-duration');
            if (timeDurationEl && duration > 0) {
                const durText = window.formatTime(duration);
                if (timeDurationEl.innerText !== durText) timeDurationEl.innerText = durText;
            } else if (isGhostState && timeDurationEl) {
                timeDurationEl.innerText = '00:00';
            }

            // ② 状态兜底与纠偏
            if (window.isPlaying !== isPlaying) {
                if (window.updatePlayButtonUI) window.updatePlayButtonUI(isPlaying);
            }

            // 🌟 监听真实物理状态，随时纠偏下拉框里的波浪图标！
            const targetDev = this.devices.find(d => d.deviceID === this.currentDevice.id);
            if (targetDev && targetDev.is_playing !== isPlaying) {
                targetDev.is_playing = isPlaying;
                this.renderDeviceList();
            }

            // ③ 如果是暂停/停止状态，直接定格界面
            if (!isPlaying && !window.isDragging) {
                const timeCurrentEl = document.getElementById('time-current');
                if (timeCurrentEl) timeCurrentEl.innerText = window.formatTime(position);
                const progressBar = document.getElementById('progress-bar');
                if (progressBar) {
                    progressBar.style.width = duration > 0 ? (position / duration * 100) + '%' : '0%';
                }
            }

            // ④ 🤖 自动感知切歌（利用前端原生逻辑更新 UI 并抓取封面歌词）
            if (data.current_song && data.current_song.title) {
                const newSongName = data.current_song.artist ? `${data.current_song.title} - ${data.current_song.artist}` : data.current_song.title;

                // 🌟 终极隔离：只要是幽灵状态，彻底屏蔽下方的歌单寻回和切歌逻辑
                if (!isGhostState) {

                    // 🌟 核心修复：把“跳歌单”的逻辑严密锁死在【首次活跃连接】这唯一的瞬间！
                    if (isFirstActiveConnect) {
                        let foundPlaylist = null;
                        const systemPls = ['我的歌单', '所有歌曲', '收藏', '下载', '最近新增', '所有电台', '在线资源', '曲库搜索', 'cache_songs', '电台收藏', 'iWebPlayer推送', '全部'];
                        const allPlKeys = Object.keys(window.allPlaylists || {});
                        const customPls = allPlKeys.filter(k => !systemPls.includes(k));
                        const searchOrder = [...customPls, '收藏', '所有歌曲', 'iWebPlayer推送'];

                        const currentSongs = window.getMergedSongList ? window.getMergedSongList(window.currentPlaylist) : [];
                        if (currentSongs.some(item => window.getSongNameObj(item) === newSongName)) {
                            foundPlaylist = window.currentPlaylist;
                        } else {
                            for (const plName of searchOrder) {
                                const plSongs = window.allPlaylists ? window.allPlaylists[plName] : [];
                                if (plSongs && plSongs.some(item => window.getSongNameObj(item) === newSongName)) {
                                    foundPlaylist = plName;
                                    break;
                                }
                            }
                        }

                        if (foundPlaylist && foundPlaylist !== window.currentPlaylist) {
                            if (typeof window.switchPlaylistSilently === 'function') {
                                if (window.showToast) window.showToast(`🎵 音箱正在播放，已自动定位至: ${foundPlaylist}`);
                                window.switchPlaylistSilently(foundPlaylist);
                            }
                        }
                    } // <--- 限制结束！以后再怎么心跳轮询，也绝对跨不过这条线！

                    // 底部的歌名跟随逻辑（不跳歌单，只更新名字和按钮），保持原样
                    if (window.currentSongName !== newSongName && window.songList) {
                        this._maxEstPos = 0;
                        const targetIdx = window.songList.findIndex(item => window.getSongNameObj(item) === newSongName);
                        if (targetIdx !== -1) {
                            if (typeof window.playSong === 'function') {
                                window.playSong(targetIdx, false);
                            }
                        }
                    }
                }
            }

            // ⑥ 🤖 同步音量
            if (data.volume !== undefined) {
                const volSlider = document.getElementById('volume-slider');
                const volText = document.getElementById('volume-text');
                if (volSlider && parseInt(volSlider.value) !== data.volume) {
                    volSlider.value = data.volume;
                    if (volText) volText.innerText = data.volume + '%';
                    if (window.updateVolumeIcon) window.updateVolumeIcon(data.volume);
                }
            }

            // ⑦ 🤖 同步播放模式
            if (data.play_mode) {
                const modeMap = { 'order': 0, 'loop': 1, 'random': 2, 'single': 3, 'single-once': 3 };
                const newMode = modeMap[data.play_mode];
                if (newMode !== undefined && window.playMode !== newMode) {
                    window.playMode = newMode;
                    if (window.updatePlayModeUI) window.updatePlayModeUI();
                }
            }

            // ⑧ 🤖 同步倍速 UI
            if (data.speed !== undefined) {
                const speedPopup = document.getElementById('fp-speed-popup');
                const configModal = document.getElementById('config-modal-backdrop');
                const isOperating = (speedPopup && speedPopup.classList.contains('show')) ||
                                    (configModal && configModal.classList.contains('show'));

                if (!isOperating) {
                    const speedSlider = document.getElementById('fp-speed-slider');
                    if (speedSlider) {
                        const currentUI = parseFloat(speedSlider.value) || 1;
                        if (currentUI !== data.speed && typeof window.updateFpSpeedUI === 'function') {
                            window.updateFpSpeedUI(data.speed);
                        }
                    }
                }
            }
        }
    }; // MiotManager 结束

})(window);