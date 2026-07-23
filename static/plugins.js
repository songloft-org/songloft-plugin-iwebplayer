// static/plugins.js
(function(window) {
    'use strict';

    /* ==========================================
     * 1. 变量与常量挂载
     * ========================================== */
    window.PLATFORM_MAP = {
        wy: "网易云", tx: "QQ音乐", kw: "酷我",
        kg: "酷狗", mg: "咪咕"
    };

    // 默认平台排序 (后续会在 index.html 的 init() 中被云端配置覆盖)
    window.currentPlatformSort = ['wy', 'tx', 'kw', 'kg', 'mg'];

    window.NO_PLUGIN_HTML = `
      <div style="padding: 20px; text-align: center; grid-column: 1 / -1;">
        <div style="font-size: 14px; font-weight: bold; color: var(--text-main); margin-bottom: 6px;">未检测到 LXMusic 插件</div>
        <div style="font-size: 12px; color: var(--text-sub); line-height: 1.5;">需要在主程序安装相应插件，才能搜索和播放在线音乐。</div>
      </div>
    `;

    /* ==========================================
     * 2. 界面与列表渲染引擎
     * ========================================== */
    // 动态渲染主界面的下拉框 (第一行在线搜索用)
    window.renderMainPlatformDropdown = function() {
        const container = document.getElementById('mf-plugin-opts');
        const valEl = document.getElementById('mf-plugin-val');
        if (!container || !valEl) return;

        container.innerHTML = '';

        // 🌟 核心防御：剔除掉老用户云端配置里可能残留的失效平台（如汽水）
        window.currentPlatformSort = window.currentPlatformSort.filter(key => window.PLATFORM_MAP[key]);

        window.currentPlatformSort.forEach((key, index) => {
            const li = document.createElement('li');
            li.className = `select-option ${index === 0 ? 'active' : ''}`;
            li.dataset.value = key;
            li.innerText = window.PLATFORM_MAP[key] || key;
            container.appendChild(li);

            if (index === 0) {
                valEl.dataset.value = key;
                valEl.innerText = window.PLATFORM_MAP[key] || key;
            }
        });

        // 重新绑定下拉框点击事件
        container.querySelectorAll('.select-option').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                container.querySelectorAll('.select-option').forEach(el => el.classList.remove('active'));
                item.classList.add('active');
                valEl.dataset.value = item.dataset.value;
                valEl.innerText = item.innerText;
                container.classList.remove('show');
            });
        });
    };

    // 渲染平台排序展示列表 (弹窗内)
    window.renderPlatformSortList = function() {
        const ul = document.getElementById('platform-sort-ul');
        if (!ul) return;
        ul.innerHTML = '';

        // 🌟 同样加一道保险
        window.currentPlatformSort = window.currentPlatformSort.filter(key => window.PLATFORM_MAP[key]);

        window.currentPlatformSort.forEach((key, index) => {
            const name = window.PLATFORM_MAP[key] || key;
            const li = document.createElement('li');
            li.className = 'edit-pl-item';
            li.style.minHeight = '52px';
            li.innerHTML = `
              <div class="edit-pl-name-wrap" style="font-size: 15px;">
                <div style="width: 22px; height: 22px; border-radius: 6px; background: rgba(236, 72, 153, 0.1); color: var(--primary); display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: bold;">${index + 1}</div>
                <span class="edit-pl-name-text">${name}</span>
              </div>
              <div class="edit-pl-actions">
                <button class="edit-pl-icon-btn btn-up" style="background: var(--bg-color); color: var(--text-sub); border: 1px solid var(--border); width: 36px; ${index === 0 ? 'opacity: 0.3; pointer-events: none;' : ''}">↑</button>
                <button class="edit-pl-icon-btn btn-down" style="background: var(--bg-color); color: var(--text-sub); border: 1px solid var(--border); width: 36px; ${index === window.currentPlatformSort.length - 1 ? 'opacity: 0.3; pointer-events: none;' : ''}">↓</button>
              </div>
            `;

            // 绑定上下移按钮
            li.querySelector('.btn-up').addEventListener('click', () => window.swapPlatform(index, index - 1));
            li.querySelector('.btn-down').addEventListener('click', () => window.swapPlatform(index, index + 1));

            ul.appendChild(li);
        });
    };

    // 交换排序并静默保存到服务器
    window.swapPlatform = async function(idx1, idx2) {
        if (idx2 < 0 || idx2 >= window.currentPlatformSort.length) return;
        const temp = window.currentPlatformSort[idx1];
        window.currentPlatformSort[idx1] = window.currentPlatformSort[idx2];
        window.currentPlatformSort[idx2] = temp;

        // 立即热更新两个 UI
        window.renderPlatformSortList();
        window.renderMainPlatformDropdown();

        try {
            await fetch('./store', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: 'lxmusic_platform_sort', value: JSON.stringify(window.currentPlatformSort) })
            });
        } catch (e) {
            console.error("保存排序失败", e);
        }
    };

    /* ==========================================
     * 3. 插件网络请求与生命周期管理
     * ========================================== */
    // 获取并渲染 LXMusic 插件列表
    window.loadLxPlugins = async function() {
        const ul = document.getElementById('plugin-list-ul');
        const importBtnWrap = document.getElementById('btn-import-plugin')?.parentElement;
        if (!ul) return;

        ul.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-sub); font-size: 13px;">正在加载源脚本...</div>';
        if (importBtnWrap) importBtnWrap.style.display = 'block';

        try {
            const res = await fetch('/api/v1/jsplugin/lxmusic/api/sources');
            if (!res.ok) throw new Error("Plugin not found");

            const resJson = await res.json();
            if (resJson.code === 0 && resJson.data && resJson.data.list) {
                ul.innerHTML = '';
                const list = resJson.data.list;
                if (list.length === 0) {
                    ul.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-sub); font-size: 13px;">暂未导入任何源脚本</div>';
                    return;
                }

                list.forEach(plugin => {
                    const tagsHtml = (plugin.platforms || []).map(p => {
                        const pName = window.PLATFORM_MAP[p] || p;
                        return `<span class="pl-status-tag" style="color: var(--text-sub); border-color: var(--border); background: var(--bg-color); margin: 0;">${pName}</span>`;
                    }).join('');

                    const li = document.createElement('li');
                    li.className = 'edit-pl-item';
                    li.style.cssText = 'padding: 12px 18px; min-height: 68px; position: relative; overflow: hidden;';
                    li.innerHTML = `
                      <div class="plugin-normal-view" style="width: 100%; display: flex; align-items: center; justify-content: space-between; transition: opacity 0.2s;">
                        <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px;">
                          <div style="display: flex; align-items: center; gap: 6px; overflow: hidden;">
                            <div style="font-size: 15px; font-weight: bold; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${plugin.name}</div>
                            <div style="font-size: 11px; font-weight: 600; color: var(--primary); background: rgba(236, 72, 153, 0.1); padding: 2px 6px; border-radius: 6px; flex-shrink: 0;">${plugin.version}</div>
                          </div>
                          <div style="display: flex; align-items: center; gap: 4px; flex-wrap: wrap;">${tagsHtml}</div>
                        </div>
                        <div class="edit-pl-actions" style="margin-left: 12px;">
                          <label class="ios-switch" style="position: relative; display: inline-block; width: 44px; height: 24px;">
                            <input type="checkbox" class="toggle-plugin" ${plugin.enabled ? 'checked' : ''} style="opacity: 0; width: 0; height: 0;">
                            <span class="slider round"></span>
                          </label>
                          <button class="edit-pl-icon-btn btn-trash" style="width: 32px; height: 32px; border-radius: 8px; margin-left: 8px; background: #6b7280; color: #fff;">
                            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                          </button>
                        </div>
                      </div>

                      <div class="plugin-delete-view" style="position: absolute; inset: 0; padding: 12px 18px; background: rgba(239, 68, 68, 0.05); display: flex; align-items: center; justify-content: space-between; transform: translateX(100%); transition: transform 0.2s cubic-bezier(0.25, 0.8, 0.25, 1);">
                        <div style="flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; overflow: hidden;">
                          <div style="font-size: 15px; font-weight: bold; color: var(--text-main); opacity: 0.6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${plugin.name}</div>
                        </div>
                        <div class="edit-pl-actions" style="margin-left: 12px;">
                          <button class="edit-pl-text-btn btn-cancel-del" style="background: var(--card-bg); color: var(--text-main); border: 1px solid var(--border);">取消</button>
                          <button class="edit-pl-text-btn btn-confirm-del" style="background: #6b7280; color: #fff; border: none;">确认删除</button>
                        </div>
                      </div>
                    `;

                    li.querySelector('.toggle-plugin').addEventListener('change', async (e) => {
                        const isEnabled = e.target.checked;
                        try {
                            await fetch('/api/v1/jsplugin/lxmusic/api/sources/toggle', {
                                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ id: plugin.id, enabled: isEnabled })
                            });
                        } catch(err) { window.showToast("状态修改失败"); e.target.checked = !isEnabled; }
                    });

                    const normalView = li.querySelector('.plugin-normal-view');
                    const deleteView = li.querySelector('.plugin-delete-view');
                    li.querySelector('.btn-trash').addEventListener('click', () => {
                        normalView.style.opacity = '0'; deleteView.style.transform = 'translateX(0)';
                    });
                    li.querySelector('.btn-cancel-del').addEventListener('click', () => {
                        normalView.style.opacity = '1'; deleteView.style.transform = 'translateX(100%)';
                    });
                    li.querySelector('.btn-confirm-del').addEventListener('click', async () => {
                        window.showToast("⏳ 删除中...");
                        try {
                            const delRes = await fetch(`/api/v1/jsplugin/lxmusic/api/sources?id=${encodeURIComponent(plugin.id)}`, { method: 'DELETE' });
                            const delJson = await delRes.json();
                            if(delJson.code === 0) { window.showToast("✅ 删除成功"); window.loadLxPlugins(); }
                            else { window.showToast("❌ 删除失败: " + delJson.msg); }
                        } catch(err) { window.showToast("网络异常"); }
                    });
                    ul.appendChild(li);
                });
            } else {
                throw new Error("Data Error");
            }
        } catch (e) {
            ul.innerHTML = window.NO_PLUGIN_HTML;
            if (importBtnWrap) importBtnWrap.style.display = 'none';
        }
    };

    // ==========================================
    // 4. 事件监听器注入
    // ==========================================
    window.addEventListener('DOMContentLoaded', () => {
        const qualityRadios = document.querySelectorAll('input[name="lx-quality-radio"]');
        if (qualityRadios.length > 0) {
            const currentQ = typeof window.getLxQuality === 'function' ? window.getLxQuality() : '320k';
            qualityRadios.forEach(radio => {
                if (radio.value === currentQ) radio.checked = true;
                // 🌟 改为 async 函数以等待版本检测
                radio.addEventListener('change', async (e) => {
                    if (e.target.checked) {
                        localStorage.setItem('iwebplayer.lx_quality', e.target.value);

                        // 🌟 核心：检测插件版本，如果不支持，直接展现红底警告框
                        if (typeof window.getLxPluginInfo === 'function') {
                            const pInfo = await window.getLxPluginInfo();
                            const warningEl = document.getElementById('lx-quality-warning');

                            // 类型 3：非 2026 开头 且 非 2.x 开头
                            if (pInfo.type === 3) {
                                if (warningEl) warningEl.style.display = 'block';
                            } else {
                                if (warningEl) warningEl.style.display = 'none';
                                window.showToast(`✅ 优先音质已设为: ${e.target.nextElementSibling.innerText}`);
                            }
                        }
                    }
                });
            });
        }
        // 导入脚本本地文件
        const importBtn = document.getElementById('btn-import-plugin');
        const importInput = document.getElementById('plugin-upload-input');
        if (importBtn && importInput) {
            importBtn.addEventListener('click', () => importInput.click());
            importInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if(!file) return;
                const formData = new FormData();
                formData.append('file', file);
                window.showToast("⏳ 正在上传解析...");
                try {
                    const res = await fetch('/api/v1/jsplugin/lxmusic/api/sources/import', { method: 'POST', body: formData });
                    const data = await res.json();
                    if(data.code === 0) {
                        window.showToast("✅ 脚本导入成功！");
                        window.loadLxPlugins();
                    } else {
                        window.showToast("❌ 导入失败: " + data.msg);
                    }
                } catch(err) { window.showToast("❌ 网络异常，上传失败"); }
                importInput.value = '';
            });
        }

        // 绑定打开弹窗时，请求并刷新两个列表的数据
        document.getElementById('setting-plugin')?.addEventListener('click', () => {
            window.loadLxPlugins();
            window.renderPlatformSortList();
        });
    });

})(window);