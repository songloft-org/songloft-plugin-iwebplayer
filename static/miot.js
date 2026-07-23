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

        // 🌟 虚拟时钟引擎参数
        virtualClockId: null,
        lastWsPos: 0,
        lastWsDuration: 0,
        lastWsTime: 0,
        isWsPlaying: false,
        _stateLockTime: 0,

        // 初始化入口
        init: async function() {
            await this.loadDevices();
            this.renderDeviceList();
            this.bindEvents();

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
                            this.devices.push({ ...dev, account_id: account.account_id });
                        });
                    }
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

            // 🌟 核心修改：如果没有插件，或者设备数为 0，渲染友好的置灰提示项
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
                // 原有的设备渲染逻辑
                this.devices.forEach(dev => {
                    const isOnline = dev.presence === 'online';
                    const dotColor = isOnline ? '#10b981' : 'var(--text-sub)';
                    const isActive = this.currentDevice.id === dev.deviceID;

                    if (isActive) this.currentDevice.name = dev.name;

                    html += `
                    <li class="select-option ${isActive ? 'active' : ''}" data-value="${dev.deviceID}" data-account="${dev.account_id}" data-type="miot" data-name="${dev.name}" ${!isOnline ? 'style="opacity: 0.6;"' : ''}>
                        <div style="display: flex; align-items: center; width: 100%;">
                            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px; flex-shrink: 0;">
                                <rect x="4" y="2" width="16" height="20" rx="4" ry="4"></rect>
                                <circle cx="12" cy="14" r="3" fill="${dotColor}" stroke="none"></circle>
                                <line x1="12" y1="6" x2="12" y2="6.01" stroke-width="3"></line>
                            </svg>
                            <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${dev.name}</span>
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

            // 🌟 新增：动态切换 body 的隐身披风
            if (type === 'miot') {
                document.body.classList.add('miot-mode');
            } else {
                document.body.classList.remove('miot-mode');
            }

            if (type === 'miot') {
                this.connectStatusWs(accountId, id);
                // ... 下面保持原样 ...
                this.startVirtualClock();
            } else {
                this.disconnectStatusWs();
                this.stopVirtualClock();

                // 恢复本机的独立音量数值
                const localVol = localStorage.getItem('iwebplayer.player_volume') || 100;
                const volSlider = document.getElementById('volume-slider');
                const volText = document.getElementById('volume-text');
                const audioEl = document.getElementById('audio');

                if (volSlider) volSlider.value = localVol;
                if (volText) volText.innerText = localVol + '%';
                if (window.updateVolumeIcon) window.updateVolumeIcon(localVol);
                if (audioEl) audioEl.volume = localVol / 100;

                // 🌟 核心新增：切回本机时，强行把本机的独立播放顺序从缓存里恢复回来！
                const storedMode = parseInt(localStorage.getItem('iwebplayer.local_play_mode'));
                window.playMode = isNaN(storedMode) ? 1 : storedMode;
                if (window.updatePlayModeUI) window.updatePlayModeUI();
            }

            // 强行刷新一次底部按钮，防止切回来后图标错乱
            if (window.updatePlayButtonUI) window.updatePlayButtonUI(window.isPlaying);
            if (window.updateVolumeBtnUI) window.updateVolumeBtnUI(); // 🌟 新增：切设备时刷新音量图标
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
            this.lastWsPos = 0;       // 🌟 强行清空上一首歌的进度缓存
            this.lastWsDuration = 0;  // 🌟 归零总时长，挂起虚拟时钟，静静等待 WebSocket 的真实推送唤醒！

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

            // 🌟 1. 明确我们期望的目标状态 (想播放设为 true，想暂停设为 false)
            const targetState = !window.isPlaying;

            // 🌟 2. 乐观更新：立刻翻转图标，并加锁 4000 毫秒（拒绝听信滞后的 WebSocket 推送）
            this._stateLockTime = Date.now() + 4000;
            this.isWsPlaying = targetState;
            if (window.updatePlayButtonUI) window.updatePlayButtonUI(targetState);

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

                // 5. 静默重载全局数据，让前端的内存状态和后端一致 (不加 await！绝不阻塞播放)
                if (typeof window.reloadGlobalData === 'function') {
                    window.reloadGlobalData().catch(e => console.warn(e));
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

        // 🌟 新增：向小爱音箱下发设置播放模式指令
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
                this.wsStatus.close();
                this.wsStatus = null;
            }
            if (this.pingTimer) {
                clearInterval(this.pingTimer);
                this.pingTimer = null;
            }
        },

        // 连接播放状态 WebSocket
        connectStatusWs: function(accountId, deviceId) {
            this.disconnectStatusWs();

            const token = typeof window.getAccessToken === 'function' ? window.getAccessToken() : '';
            if (!token) return;

            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}/api/v1/jsplugin/miot/status/ws?account_id=${accountId}&device_id=${deviceId}&access_token=${token}`;

            try {
                this.wsStatus = new WebSocket(wsUrl);

                this.wsStatus.onopen = () => {
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

                this.wsStatus.onclose = () => {
                    if (this.pingTimer) clearInterval(this.pingTimer);
                };

            } catch (e) {}
        },

        // 🌟 3. 神级虚拟时钟：推演真实秒数，实现 60FPS 丝滑滚动
        startVirtualClock: function() {
            if (this.virtualClockId) return;
            const tick = () => {
                // 只有在小爱播放模式、且确实在播放、且获取到了总时长的情况下，才自己推算进度
                if (this.currentDevice.type === 'miot' && this.isWsPlaying && this.lastWsDuration > 0) {
                    const now = performance.now();
                    // 推算：上次传来的秒数 + (现在距离上次收到推送的时间差)
                    let estPos = this.lastWsPos + (now - this.lastWsTime) / 1000;
                    if (estPos > this.lastWsDuration) estPos = this.lastWsDuration;

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
        syncUIWithMiotStatus: function(data) {
            if (this.currentDevice.type !== 'miot') return;

            const position = parseFloat(data.position) || 0;
            const duration = parseFloat(data.duration) || 0;
            const isPlaying = data.state === 'playing';

            // 🌟 2. 不马上粗暴刷新时间！只把数据喂给虚拟时钟
            this.lastWsPos = position;
            this.lastWsDuration = duration;
            this.lastWsTime = performance.now(); // 记录此刻的物理时间锚点
            this.isWsPlaying = isPlaying;

            // ① 更新不会高频变动的总时长
            const timeDurationEl = document.getElementById('time-duration');
            if (timeDurationEl && duration > 0) {
                const durText = window.formatTime(duration);
                if (timeDurationEl.innerText !== durText) timeDurationEl.innerText = durText;
            }

            // ② 状态兜底与纠偏（如果乐观更新出错，WS推来的真实状态会纠正图标）
            if (window.isPlaying !== isPlaying) {
                if (window.updatePlayButtonUI) window.updatePlayButtonUI(isPlaying);
            }

            // ③ 如果是暂停状态，直接定格界面
            if (!isPlaying) {
                const timeCurrentEl = document.getElementById('time-current');
                if (timeCurrentEl) timeCurrentEl.innerText = window.formatTime(position);
                const progressBar = document.getElementById('progress-bar');
                if (progressBar && duration > 0) progressBar.style.width = (position / duration * 100) + '%';
            }

            // ④ 🤖 自动感知切歌（利用前端原生逻辑更新 UI 并抓取封面歌词）
            if (data.current_song && data.current_song.title) {
                const newSongName = data.current_song.artist ? `${data.current_song.title} - ${data.current_song.artist}` : data.current_song.title;

                if (window.currentSongName !== newSongName && window.songList) {
                    const targetIdx = window.songList.findIndex(item => window.getSongNameObj(item) === newSongName);
                    if (targetIdx !== -1) {
                        // 发现音箱切歌了，通知前端假装“点”了这首歌，但不发送 play 指令
                        if (typeof window.playSong === 'function') {
                            window.playSong(targetIdx, false);
                        }
                    }
                }
            }
            // ⑥ 🤖 同步音量 (避免拖拽时冲突，只判断数值)
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
                    // 🌟 彻底掐断这里的本地缓存写入，防止音箱的状态污染本机的档案！
                    if (window.updatePlayModeUI) window.updatePlayModeUI();
                }
            }
        }
    }; // MiotManager 结束

    document.addEventListener('DOMContentLoaded', () => {
        if (window.MiotManager) window.MiotManager.init();
    });

})(window);