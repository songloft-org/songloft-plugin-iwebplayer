// static/utils.js
// 🌟 全局偏好设置管家
window.defaultPreferences = {
    lockLyric: true,  // 默认开启锁屏歌词
    ambientBg: false  // 默认关闭氛围背景
};

// 获取当前设置
window.getPreferences = function() {
    try {
        const stored = JSON.parse(localStorage.getItem('iwebplayer.preferences'));
        return { ...window.defaultPreferences, ...stored };
    } catch (e) {
        return window.defaultPreferences;
    }
};

// 保存并分发设置
window.savePreferences = function(newPrefs) {
    const current = window.getPreferences();
    const updated = { ...current, ...newPrefs };
    localStorage.setItem('iwebplayer.preferences', JSON.stringify(updated));

    // 触发一个自定义事件，通知其他组件设置已变
    window.dispatchEvent(new CustomEvent('preferencesUpdated', { detail: updated }));
};

// ==========================================
// 🌟 在线音质：配置获取与智能降级算法
// ==========================================
window.LX_QUALITY_ORDER = ['master', 'flac24bit', 'flac', '320k', '128k'];

window.getLxQuality = function() {
    return localStorage.getItem('iwebplayer.lx_quality') || '320k';
};

window.getBestLxQuality = function(sourceData, prefQuality) {
    if (!sourceData || !Array.isArray(sourceData.types) || sourceData.types.length === 0) return prefQuality || '320k';
    const availableTypes = sourceData.types.map(t => t.type);
    const prefIdx = window.LX_QUALITY_ORDER.indexOf(prefQuality);
    for (let i = prefIdx; i < window.LX_QUALITY_ORDER.length; i++) {
        if (availableTypes.includes(window.LX_QUALITY_ORDER[i])) return window.LX_QUALITY_ORDER[i];
    }
    return availableTypes[availableTypes.length - 1] || '128k';
};

// 🌟 新增：版本探针缓存
window._lxPluginInfoCache = null;
window.getLxPluginInfo = async function() {
    if (window._lxPluginInfoCache) return window._lxPluginInfoCache;
    try {
        const res = await fetch('/api/v1/jsplugins');
        const data = await res.json();
        const plugin = data.plugins.find(p => p.name.includes('洛雪') || p.entry_path === 'lxmusic');
        if (plugin) {
            let type = 1;
            if (plugin.version.startsWith('2026.')) type = 1;
            else if (plugin.version.startsWith('2.')) type = 2;
            else if (plugin.version.startsWith('3.')) type = 3;

            window._lxPluginInfoCache = { type, version: plugin.version };
            return window._lxPluginInfoCache;
        }
    } catch(e) {}
    return { type: 1, version: 'unknown' };
};

// 🌟 新增：终极音频直链获取中心（封装了双版本夺权逻辑）
window.fetchLxMusicUrl = async function(sd, quality) {
    const pInfo = await window.getLxPluginInfo();

    if (pInfo.type === 3) {
        // 类型 3：直接拦截（不再弹 Toast，已移至设置界面 UI 内联提示）
    } else if (pInfo.type === 2) {
        // 类型 2：先发 POST 强行改写底层全局配置
        try {
            await fetch('/api/v1/jsplugin/lxmusic/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    enableImportQuality: false, // 导入不干涉
                    importQuality: "320k",
                    enablePlayQuality: true,    // 开启播放干涉
                    playQuality: quality,       // 强写目标音质
                    enableDownloadQuality: false,
                    downloadQuality: "320k",
                    probeTimeout: 5,
                    playTimeout: 30,
                    enableHoloLog: false,
                    enableLogTruncation: false
                })
            });
        } catch (e) { console.warn("改写音质配置失败", e); }
    }
    // 类型 1 和 兜底逻辑：按原样发送 URL 获取请求
    const urlRes = await fetch('/api/v1/jsplugin/lxmusic/api/music/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            source_data: { platform: sd.source, quality: quality, songInfo: sd },
            quality: quality
        })
    });
    return await urlRes.json();
};
// ==========================================

window.showToast = function(msg, persist = false) {
    let toast = document.getElementById('global-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'global-toast';
      toast.className = 'toast-message';
      document.body.appendChild(toast);
    }
    toast.innerHTML = msg;
    toast.classList.remove('show');
    void toast.offsetWidth;
    toast.classList.add('show');
    if (toast.timer) clearTimeout(toast.timer);
    if (!persist) toast.timer = setTimeout(() => toast.classList.remove('show'), 2000);
};

window.formatTime = function(seconds) {
    if (isNaN(seconds) || !isFinite(seconds)) return "00:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
};

window.formatSpeed = function(val) {
    const num = parseFloat(val);
    if (num === 1 || num === 2 || num === 3) return num + 'x';
    return num.toFixed(1) + 'x';
};

window.setupMediaSession = function(audioEl, btnPrev, btnNext) {
    if ('mediaSession' in navigator) {
      try {
        navigator.mediaSession.setActionHandler('seekbackward', null);
        navigator.mediaSession.setActionHandler('seekforward', null);
      } catch (e) {}
      navigator.mediaSession.setActionHandler('play', () => {
        return audioEl.play().catch(e => {});
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        audioEl.pause();
      });
      navigator.mediaSession.setActionHandler('previoustrack', () => btnPrev.click());
      navigator.mediaSession.setActionHandler('nexttrack', () => btnNext.click());
      try {
        navigator.mediaSession.setActionHandler('seekto', (details) => {
          if (audioEl.duration) {
            audioEl.currentTime = details.seekTime;
          }
        });
      } catch(e) {}
    }
};

window._lastMediaSessionParams = null; // 暂存基础参数
window._currentLockScreenLyric = null; // 暂存当前播放的歌词

window.updateMediaSession = function(songName, coverUrl, favoriteList, appLogo) {
    if ('mediaSession' in navigator) {
      // 🌟 缓存基础参数，供后面的歌词滚动复用
      window._lastMediaSessionParams = { songName, coverUrl, favoriteList, appLogo };

      let displayTitle = favoriteList.includes(songName) ? `${songName} ♡︎` : songName;
      let displayArtist = 'iWebPlayer';

      // 🌟 核心魔术：如果当前有歌词，将歌名降级为副标题（歌手位），将歌词提升为大标题（歌名位）
      if (window._currentLockScreenLyric) {
          displayArtist = displayTitle;
          displayTitle = window._currentLockScreenLyric;
      }

      navigator.mediaSession.metadata = new MediaMetadata({
        title: displayTitle,
        artist: displayArtist,
        album: '我的曲库',
        artwork: [ { src: coverUrl || appLogo || '/static/favicon.ico' } ]
      });
    }
};

// 🌟 由歌词引擎专门呼叫的动态注入函数
window.updateMediaSessionLyric = function(lyricText) {
    // 💡 核心：如果用户关闭了锁屏歌词，强行拦截，并强制清空锁屏歌词缓存
    const prefs = window.getPreferences();
    if (!prefs.lockLyric) {
        window._currentLockScreenLyric = null;
    } else {
        window._currentLockScreenLyric = lyricText;
    }

    // 唤醒主函数重新渲染锁屏
    if (window._lastMediaSessionParams) {
        const { songName, coverUrl, favoriteList, appLogo } = window._lastMediaSessionParams;
        window.updateMediaSession(songName, coverUrl, favoriteList, appLogo);
    }
};

window.initStandalonePatch = function(audioEl, updatePlayButtonUICb) {
    const isStandaloneMode = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
    if (isStandaloneMode && audioEl) {
        audioEl.addEventListener('pause', () => {
            if (window.isPageBtnPause) return;
            if (audioEl.src && !audioEl.ended) {
                const currentTime = audioEl.currentTime;
                audioEl.src = "";
                audioEl.load();
                if (typeof updatePlayButtonUICb === 'function') updatePlayButtonUICb(false);
                localStorage.setItem('iwebplayer.standalone_resume_time', currentTime);
            }
        });
    }
};

// === 以下是新抽离的 UI 工具和配置常量 ===

window.defaultCover = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Cdefs%3E%3ClinearGradient id='grad' x1='0%25' y1='0%25' x2='100%25' y2='100%25'%3E%3Cstop offset='0%25' stop-color='%23ec4899' /%3E%3Cstop offset='100%25' stop-color='%238b5cf6' /%3E%3C/linearGradient%3E%3C/defs%3E%3Ccircle cx='50' cy='50' r='50' fill='%231f2937' /%3E%3Ccircle cx='50' cy='50' r='40' fill='none' stroke='%23374151' stroke-width='1' /%3E%3Ccircle cx='50' cy='50' r='30' fill='none' stroke='%23374151' stroke-width='1' /%3E%3Ccircle cx='50' cy='50' r='20' fill='url(%23grad)' /%3E%3Ccircle cx='50' cy='50' r='5' fill='%23111827' /%3E%3Cpath d='M50 15 A35 35 0 0 1 85 50' fill='none' stroke='%23ffffff' stroke-width='2' stroke-linecap='round' opacity='0.3' /%3E%3C/svg%3E";
window.modeNames = ["跨单顺播", "本单循环", "本单随机", "单曲循环"];

window.setHeadIcon = function(rel, href, extra = {}) {
  let link = document.querySelector(`link[rel="${rel}"]`);
  if (!link) {
    link = document.createElement('link');
    link.rel = rel;
    document.head.appendChild(link);
  }
  if (href) link.href = href;
  Object.assign(link, extra);
};

window.formatPlaylistText = function(name, count) {
  let icon = window.SVG_ICONS?.folder || '';
  let displayName = name;

  if (name === '我的歌单') icon = window.SVG_ICONS?.list || '', count = window.playlistMeta ? window.playlistMeta.filter(pl => pl.name !== '电台收藏').length : 0;
  else if (name === '所有歌曲') icon = window.SVG_ICONS?.music || '';
  else if (name === '所有电台') icon = window.SVG_ICONS?.radio || '';
  else if (name === '在线资源') icon = `<svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`;
  else if (name === '收藏') icon = window.SVG_ICONS?.heart || '';
  else if (name === '曲库搜索') icon = window.SVG_ICONS?.search || '';
  else if (window.customPlaylistNames && window.customPlaylistNames.includes(name)) {
      icon = window.SVG_ICONS?.disc || '';
      displayName = name;
  }
  else if (name === 'cache_songs') {
      icon = `<svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg>`;
      displayName = '缓存歌曲';
  }

  return `
    <span style="display:inline-flex; align-items:center; margin-right:6px; opacity:0.8; flex-shrink: 0;">${icon}</span>
    <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 1; min-width: 0;">${displayName}</span>
    <span style="flex-shrink: 0; margin-left: 4px; opacity: 0.7; font-size: 14px;">(${count})</span>
  `;
};

window.formatPlaylistTextWithTags = function(name, count) {
    let baseHtml = window.formatPlaylistText(name, count);
    const conf = window.getPlaylistConfig(name);
    let tagsHtml = '';

    if (conf.speedLocal !== 1.0) tagsHtml += `<span class="pl-status-tag" style="color:var(--primary);">${window.formatSpeed(conf.speedLocal)}</span>`;
    if (conf.resumeLocal !== 'off') tagsHtml += `<span class="pl-status-tag" style="color:var(--primary);">续播</span>`;

    return `
      <div style="display: flex; align-items: center; justify-content: flex-start; width: 100%; min-width: 0;">
        ${baseHtml}
        ${tagsHtml ? `<div style="display: flex; align-items: center; flex-shrink: 0; ">${tagsHtml}</div>` : ''}
      </div>
    `;
};

window.updatePlayModeUI = function() {
  for (let i = 0; i <= 3; i++) {
      const icon = document.getElementById('icon-mode-' + i);
      if (icon) icon.style.display = window.playMode === i ? 'block' : 'none';
  }
  const btnMode = document.getElementById('btn-mode');
  if (btnMode) btnMode.title = window.modeNames[window.playMode];

  const modePopup = document.getElementById('mode-popup');
  if (modePopup) {
      modePopup.querySelectorAll('.mode-item').forEach(item => {
          item.classList.remove('active');
          if (parseInt(item.dataset.mode) === window.playMode) item.classList.add('active');
      });
  }
};

window.updateVolumeIcon = function(vol) {
  const iconVolNormal = document.getElementById('icon-vol-normal');
  const iconVolMute = document.getElementById('icon-vol-mute');
  if (!iconVolNormal || !iconVolMute) return;
  if (parseInt(vol) === 0) {
    iconVolNormal.style.display = 'none';
    iconVolMute.style.display = 'block';
  } else {
    iconVolNormal.style.display = 'block';
    iconVolMute.style.display = 'none';
  }
};

// 🌟 新增：动态控制音量按钮变灰
window.updateVolumeBtnUI = function() {
    const btnVolume = document.getElementById('btn-volume');
    if (!btnVolume) return;
    const isMiot = window.MiotManager && window.MiotManager.currentDevice.type === 'miot';
    if (window.isIOS && !isMiot) {
        btnVolume.style.opacity = '0.3';
        btnVolume.style.color = 'var(--text-sub)';
    } else {
        btnVolume.style.opacity = '';
        btnVolume.style.color = '';
    }
};

window.updatePlayButtonUI = function(playing) {
      window.isPlaying = playing;
      const miniCover = document.getElementById('mini-cover');

      // 获取 4 个图标 DOM
      const iconPlay = document.getElementById('icon-play');
      const iconPause = document.getElementById('icon-pause');
      const iconMiotPlay = document.getElementById('icon-miot-play');
      const iconMiotPause = document.getElementById('icon-miot-pause');

      // 判断当前是否处于小爱音箱推送状态
      const isMiot = window.MiotManager && window.MiotManager.currentDevice.type === 'miot';

      // 先把所有图标无情隐藏
      if (iconPlay) iconPlay.style.display = 'none';
      if (iconPause) iconPause.style.display = 'none';
      if (iconMiotPlay) iconMiotPlay.style.display = 'none';
      if (iconMiotPause) iconMiotPause.style.display = 'none';

      // 根据 播放状态 和 设备状态，精准点亮唯一一个图标
      if (playing) {
        if (isMiot && iconMiotPause) iconMiotPause.style.display = 'block';
        else if (iconPause) iconPause.style.display = 'block';
        if (miniCover) miniCover.classList.add('spinning');
      } else {
        if (isMiot && iconMiotPlay) iconMiotPlay.style.display = 'block';
        else if (iconPlay) iconPlay.style.display = 'block';
        if (miniCover) miniCover.classList.remove('spinning');
      }
};

window.getPlaylistConfig = function(plName) {
    const configs = JSON.parse(localStorage.getItem('iwebplayer.pl_configs') || '{}');
    let conf = configs[plName] || {};
    if (conf.speedLocal === undefined) conf.speedLocal = 1.0;
    if (conf.speedXiaoai === undefined) conf.speedXiaoai = 1.0;
    if (conf.resumeLocal === undefined) conf.resumeLocal = 'off';
    if (conf.resumeXiaoai === undefined) conf.resumeXiaoai = 'off';
    return conf;
};

window.savePlaylistConfig = function(plName, config) {
    const configs = JSON.parse(localStorage.getItem('iwebplayer.pl_configs') || '{}');
    configs[plName] = config;
    localStorage.setItem('iwebplayer.pl_configs', JSON.stringify(configs));
};

// 🌟 核心工具：万能歌曲名称与后缀提取器 (强制统一输出格式：歌名 - 歌手)
window.getSongNameObj = function(rawItem) {
    if (!rawItem) return "未知歌曲";

    // 1. 获取基础字段
    let title = String(rawItem.title || rawItem.name || "").trim();
    let artist = String(rawItem.artist || rawItem.singer || "").trim();

    // 如果没名字但有物理路径，用文件名充当暂定歌名
    if (!title && rawItem.file_path) {
        title = String(rawItem.file_path).split('/').pop().replace(/\.[^/.]+$/, "");
    }

    // 2. 核心净化：如果 title 里混入了 artist，我们要精确地把它剥离出来！
    if (title && artist && artist !== "未知" && artist !== "未知歌手") {

        // 场景 A：命中 "歌手 - 歌名" 或 "歌手-歌名" (例如: "龚玥 - 美丽的草原")
        if (title.startsWith(artist + " - ")) {
            title = title.substring(artist.length + 3).trim(); // 砍掉前面的歌手名
        } else if (title.startsWith(artist + "-")) {
            title = title.substring(artist.length + 1).trim();
        }
        // 场景 B：命中 "歌名 - 歌手" 或 "歌名-歌手" (例如: "日不落 - 蔡依林")
        else if (title.endsWith(" - " + artist)) {
            title = title.substring(0, title.length - artist.length - 3).trim(); // 砍掉后面的歌手名
        } else if (title.endsWith("-" + artist)) {
            title = title.substring(0, title.length - artist.length - 1).trim();
        }

        // 剥离出最干净的歌名后，强制统一格式输出！
        return `${title} - ${artist}`;
    }

    // 3. 终极兜底：缺少某一项信息时，有啥显示啥
    return title || artist || "未知歌曲";
};

// 🌟 刮削桥接器：统一向后端请求封面与歌词 (V2: 纯净参数提取版)
window.fetchScrape = async function(rawItem, type, currentSongName = null) {
    if (!rawItem) return null;

    let filename = '';
    // 1. 获取经过严格清洗、绝对标准的 "歌名 - 歌手" 格式
    const nameObj = window.getSongNameObj ? window.getSongNameObj(rawItem) : (currentSongName || '');

    if (nameObj) {
        filename = nameObj.replace(/\.(mp3|flac|wav|m4a|aac|ogg|ape|wma|alac)(.*)$/i, '').replace(/#.*$/, '');
    } else if (rawItem.file_path) {
        filename = String(rawItem.file_path).split('/').pop().replace(/\.[^/.]+$/, "");
    }

    // 2. 原始脏数据兜底
    let title = rawItem.title || rawItem.name || '';
    let artist = rawItem.artist || rawItem.singer || '';

    // 3. 🌟 核心修复：直接从纯净的 filename 中拆分出完美的 title 和 artist！
    if (filename && filename.includes(' - ')) {
        const parts = filename.split(' - ');
        title = parts[0].trim(); // 拿到绝对纯净的歌名 (例如: 温柔)
        artist = parts.slice(1).join(' - ').trim(); // 拿到绝对纯净的歌手 (例如: 五月天)
    }

    const url = `/api/v1/jsplugin/iwebplayer/scrape?type=${type}&title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}&filename=${encodeURIComponent(filename)}`;

    try {
        const res = await fetch(url);
        if (res.ok) {
            const data = await res.json();
            return type === 'cover' ? data.cover : data.lyric;
        }
    } catch(e) {}
    return null;
};