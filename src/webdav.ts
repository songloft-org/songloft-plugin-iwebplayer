// src/webdav.ts
import { jsonResponse } from '@songloft/plugin-sdk';
import type { HTTPRequest } from '@songloft/plugin-sdk';

let currentScanVersion = 0;
let scanStatus = 'idle'; // 'idle' | 'scanning' | 'completed' | 'failed'
let scannedFoldersCount = 0;
let activeDavId = '';
let daemonStarted = false; // 🌟 新增：守护进程状态标志

const AUDIO_EXTS = ['.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.ape', '.wma', '.alac'];

// 直接在这里定义发给兄弟的广播函数
const TWIN_PLUGIN_ID = 'miot-helper';

// 🌟 新增：兼容性极强的存储助手
async function safeStorageSet(key: string, val: string) {
    if (typeof songloft.storage.set === 'function') {
        await songloft.storage.set(key, val);
    } else if (typeof songloft.storage.setItem === 'function') {
        await songloft.storage.setItem(key, val);
    }
}

async function safeStorageGet(key: string) {
    if (typeof songloft.storage.get === 'function') {
        return await songloft.storage.get(key);
    } else if (typeof songloft.storage.getItem === 'function') {
        return await songloft.storage.getItem(key);
    }
    return null;
}

async function broadcastWebDavLibrary(davId: string, library: any) {
    try {
        await songloft.comm.send(TWIN_PLUGIN_ID, "sync_webdav_data", {
            type: 'library',
            davId: davId,
            library: library
        });
        songloft.log.info(`📡 已向 [${TWIN_PLUGIN_ID}] 广播扫库结果: ${davId}`);
    } catch (e) {}
}

function isAudioFile(filename: string): boolean {
    const lower = filename.toLowerCase();
    return AUDIO_EXTS.some(ext => lower.endsWith(ext));
}

// 辅助时间格式化函数
function formatScanTime(): string {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

// 🌐 异步递归扫描核心
async function runScanTask(version: number, hostUrl: string, token: string, davId: string, rootPath: string) {
    const queue: string[] = [rootPath];
    const resultLibrary: Record<string, any[]> = {};
    let lastWriteTime = Date.now();

    try {
        while (queue.length > 0) {
            if (currentScanVersion !== version) return;

            const currentPath = queue.shift()!;
            const apiUrl = `${hostUrl}/api/v1/jsplugin/dav/lists/${encodeURIComponent(davId)}/items?path=${encodeURIComponent(currentPath)}`;

            try {
                const res = await fetch(apiUrl, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!res.ok) continue;

                const items = await res.json();
                if (!Array.isArray(items)) continue;

                const audioItems = [];

                for (const item of items) {
                    // 🌟 智能兜底：解决某些 WebDAV 节点 name 返回空字符串的 Bug
                    const itemName = item.name || (item.id ? item.id.split('/').filter(Boolean).pop() : '') || '未知';

                    if (item.type === 'directory') {
                        const nextPath = currentPath === '/' ? '/' + itemName : `${currentPath}/${itemName}`;
                        queue.push(nextPath);
                    } else if (item.type === 'file' && isAudioFile(itemName)) {
                        audioItems.push({
                            id: item.id || `dav_temp_${Date.now()}_${Math.random()}`,
                            title: itemName.replace(/\.[^/.]+$/, ""),
                            artist: "未知歌手",
                            album: "",
                            duration: item.duration || 0,
                            cover_url: "",
                            plugin_entry_path: "dav",
                            source_data: JSON.stringify({ configName: davId, path: item.id }),
                            dedup_key: `dav_${davId}_${item.id}`,
                            streamUrl: item.streamUrl,
                            _isOnlineObj: true
                        });
                    }
                }

                if (audioItems.length > 0) {
                    let plName = currentPath === '/' ? '根目录' : currentPath.split('/').pop() || '未知文件夹';
                    resultLibrary[plName] = audioItems;
                    scannedFoldersCount++;
                }

                // ⏱️ 3秒心跳批处理写入：加上 folders, songs, time 元数据
                if (Date.now() - lastWriteTime > 3000) {
                    let totalSongs = 0;
                    for (const list of Object.values(resultLibrary)) totalSongs += list.length;

                    const libData = {
                        folders: Object.keys(resultLibrary).length,
                        songs: totalSongs,
                        time: formatScanTime(),
                        library: resultLibrary
                    };
                    await safeStorageSet(`webdav_lib_${davId}`, JSON.stringify(libData));
                    lastWriteTime = Date.now();
                }

            } catch (err) {
                songloft.logger.error(`[WebDAV] 扫描出错 ${currentPath}:`, String(err));
            }
        }

        if (currentScanVersion === version) {
            let totalSongs = 0;
            for (const list of Object.values(resultLibrary)) totalSongs += list.length;

            const libData = {
                folders: Object.keys(resultLibrary).length,
                songs: totalSongs,
                time: formatScanTime(),
                library: resultLibrary
            };
            await safeStorageSet(`webdav_lib_${davId}`, JSON.stringify(libData));
            broadcastWebDavLibrary(davId, libData);
            scanStatus = 'completed';
        }
    } catch (fatalErr) {
        if (currentScanVersion === version) scanStatus = 'failed';
    }
}

// 🤖 🌟 核心新增：静默后台定时扫描引擎 (带乐观软锁，基于大一统配置)
async function checkAutoScan() {
    if (scanStatus === 'scanning') return;

    try {
        const token = await songloft.plugin.getToken();
        const hostUrl = await songloft.plugin.getHostUrl();

        const res = await fetch(`${hostUrl}/api/v1/jsplugin/dav/lists`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) return;

        const servers = await res.json();
        if (!Array.isArray(servers)) return;

        // 1. 统一获取大一统配置
        const configStr = (await safeStorageGet('iwebplayer.webdav')) || (await safeStorageGet('webdav_config'));
        let config: any = { settings: {}, roots: {} };
        if (configStr) {
            try {
                const parsed = JSON.parse(configStr);
                if (parsed.settings) config.settings = parsed.settings;
                if (parsed.roots) config.roots = parsed.roots;
            } catch (e) {}
        }

        for (const srv of servers) {
            if (scanStatus === 'scanning') break;
            const davId = srv.name;

            const intervalStr = config.settings[`auto_scan_interval_${davId}`] || '0';
            const intervalHours = parseInt(intervalStr, 10);

            if (intervalHours > 0) {
                // 🌟 2. 核心修正：从大一统配置的 settings 中读取上次扫库时间戳
                const lastScanStr = config.settings[`last_scan_time_${davId}`];
                let lastScanMs = lastScanStr ? parseInt(lastScanStr, 10) : 0;

                const now = Date.now();
                const targetIntervalMs = intervalHours * 60 * 60 * 1000;

                if (now - lastScanMs >= targetIntervalMs) {
                    songloft.log.info(`[WebDAV] 触发自动静默扫描: [${davId}]`);

                    // 🔫 3. 拔枪占位：将新的时间戳塞入大一统配置
                    config.settings[`last_scan_time_${davId}`] = now.toString();
                    const newConfigStr = JSON.stringify(config);

                    // 💾 存入本地数据库
                    await safeStorageSet('iwebplayer.webdav', newConfigStr);

                    // 📢 4. 瞬间把完整的大一统配置广播给兄弟插件
                    try {
                        await songloft.comm.send(TWIN_PLUGIN_ID, "sync_webdav_data", {
                            type: 'config',
                            key: 'webdav_config', // 对方只认这个别名
                            value: newConfigStr
                        });
                    } catch(e) {}

                    const rootPath = config.roots[davId] || '/';
                    currentScanVersion++;
                    activeDavId = davId;
                    scanStatus = 'scanning';
                    scannedFoldersCount = 0;

                    // 异步执行，不阻塞后续轮询
                    runScanTask(currentScanVersion, hostUrl, token, davId, rootPath).catch(() => {});
                }
            }
        }
    } catch (e) {
        songloft.log.error('[WebDAV] 定时扫描守护进程异常: ' + String(e));
    }
}

// 🔌 挂载路由
export function setupWebDAVRoutes(router: any) {
    // 🌟 新增：启动守护进程 (单例锁)
    if (!daemonStarted) {
        daemonStarted = true;
        // 每 15 分钟醒来检查一次是否需要执行任务
        setInterval(() => {
            checkAutoScan().catch(() => {});
        }, 15 * 60 * 1000);

        // 插件刚启动时，延迟 1 分钟进行首次检查（错开宿主高负载启动期）
        setTimeout(() => {
            checkAutoScan().catch(() => {});
        }, 60 * 1000);

        songloft.log.info('[WebDAV] 自动定时扫描守护进程已启动');
    }

    // 1. 触发手动扫描
    router.post('/dav/scan', async (req: HTTPRequest) => {
        let data: any = {};
        if (req.body) {
            try { data = JSON.parse(typeof req.body === 'string' ? req.body : String.fromCharCode.apply(null, Array.from(req.body as Uint8Array))); } catch(e){}
        }
        const { davId, rootPath } = data;
        if (!davId || !rootPath) return jsonResponse({ error: "Missing parameters" }, 400);

        const hostUrl = await songloft.plugin.getHostUrl();
        const token = await songloft.plugin.getToken();

        currentScanVersion++;
        activeDavId = davId;
        scanStatus = 'scanning';
        scannedFoldersCount = 0;

        // ====== 🌟 手动扫库也触发拔枪占位，并写入大一统配置 ======
        const now = Date.now();

        // 1. 先读出当前最新的配置
        const configStr = (await safeStorageGet('iwebplayer.webdav')) || (await safeStorageGet('webdav_config'));
        let config: any = { settings: {}, roots: {} };
        if (configStr) {
            try {
                const parsed = JSON.parse(configStr);
                if (parsed.settings) config.settings = parsed.settings;
                if (parsed.roots) config.roots = parsed.roots;
            } catch (e) {}
        }

        // 2. 修改时间戳
        config.settings[`last_scan_time_${davId}`] = now.toString();
        const newConfigStr = JSON.stringify(config);

        // 3. 存盘并广播完整配置
        await safeStorageSet('iwebplayer.webdav', newConfigStr);
        try {
            await songloft.comm.send(TWIN_PLUGIN_ID, "sync_webdav_data", {
                type: 'config',
                key: 'webdav_config', // 对方只认这个别名
                value: newConfigStr
            });
        } catch(e) {}
        // ================================

        runScanTask(currentScanVersion, hostUrl, token, davId, rootPath).catch(() => {});
        return jsonResponse({ status: "scanning", version: currentScanVersion });
    });

    // 2. 前端 3 秒心跳轮询进度接口
    router.get('/dav/status', async (req: HTTPRequest) => {
        return jsonResponse({ status: scanStatus, scanned_folders: scannedFoldersCount, davId: activeDavId });
    });

    // 3. 前端拉取扁平化缓存曲库
    router.get('/dav/library', async (req: HTTPRequest) => {
        let davId = '';
        if (req.query) {
            const match = String(req.query).match(/(?:^|&)davId=([^&]*)/);
            if (match) davId = decodeURIComponent(match[1]);
        }
        if (!davId) return jsonResponse({ error: "Missing davId" }, 400);
        const cacheStr = await safeStorageGet(`webdav_lib_${davId}`);
        return jsonResponse(cacheStr ? JSON.parse(cacheStr) : {});
    });

}