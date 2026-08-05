// src/webdav.ts
import { jsonResponse } from '@songloft/plugin-sdk';
import type { HTTPRequest } from '@songloft/plugin-sdk';

let currentScanVersion = 0;
let scanStatus = 'idle'; // 'idle' | 'scanning' | 'completed' | 'failed'
let scannedFoldersCount = 0;
let activeDavId = '';

const AUDIO_EXTS = ['.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.ape', '.wma', '.alac'];

// 👇 新增：直接在这里定义发给兄弟的广播函数
const TWIN_PLUGIN_ID = 'miot-helper';
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
                    if (item.type === 'directory') {
                        const nextPath = currentPath === '/' ? '/' + item.name : `${currentPath}/${item.name}`;
                        queue.push(nextPath);
                    } else if (item.type === 'file' && isAudioFile(item.name)) {
                        audioItems.push({
                            id: item.id || `dav_temp_${Date.now()}_${Math.random()}`,
                            title: item.name.replace(/\.[^/.]+$/, ""),
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
                    await songloft.storage.set(`webdav_lib_${davId}`, JSON.stringify(libData));
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
            await songloft.storage.set(`webdav_lib_${davId}`, JSON.stringify(libData));
            broadcastWebDavLibrary(davId, libData);
            scanStatus = 'completed';
        }
    } catch (fatalErr) {
        if (currentScanVersion === version) scanStatus = 'failed';
    }
}

// 🔌 挂载路由
export function setupWebDAVRoutes(router: any) {
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
        const cache = await songloft.storage.get(`webdav_lib_${davId}`);
        return jsonResponse(cache ? JSON.parse(cache) : {});
    });

}