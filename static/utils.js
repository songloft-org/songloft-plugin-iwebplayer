// static/utils.js
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

window.updateMediaSession = function(songName, coverUrl, favoriteList, appLogo) {
    if ('mediaSession' in navigator) {
      const displayTitle = favoriteList.includes(songName) ? `${songName} ♡︎` : songName;
      navigator.mediaSession.metadata = new MediaMetadata({
        title: displayTitle,
        artist: 'iWebPlayer',
        album: '我的曲库',
        artwork: [ { src: coverUrl || appLogo || '/static/favicon.ico' } ]
      });
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