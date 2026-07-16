// src/webdav.ts
import { jsonResponse } from '@songloft/plugin-sdk';
import type { HTTPRequest } from '@songloft/plugin-sdk';

let currentScanVersion = 0;
let scanStatus = 'idle'; // 'idle' | 'scanning' | 'completed' | 'failed'
let scannedFoldersCount = 0;
let activeDavId = '';

const AUDIO_EXTS = ['.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.ape', '.wma', '.alac'];

function isAudioFile(filename: string): boolean {
    const lower = filename.toLowerCase();
    return AUDIO_EXTS.some(ext => lower.endsWith(ext));
}

// 🌐 异步递归扫描核心
async function runScanTask(version: number, hostUrl: string, token: string, davId: string, rootPath: string) {
    const queue: string[] = [rootPath];
    const resultLibrary: Record<string, any[]> = {};
    let lastWriteTime = Date.now();

    try {
        while (queue.length > 0) {
            // 🛡️ 版本锁拦截：触发新扫描时，旧扫描自动退出
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

                        // 🚀 核心：100% 匹配官方标准 Remote Payload 格式，去扩展名保留原汁原味歌名
                        audioItems.push({
                            id: item.id || `dav_temp_${Date.now()}_${Math.random()}`, // 临时前端展示 ID
                            title: item.name.replace(/\.[^/.]+$/, ""),                 // 只切后缀，不洗歌名
                            artist: "未知歌手",
                            album: "",
                            duration: item.duration || 0,
                            cover_url: "",
                            plugin_entry_path: "dav",                                   // 声明属于 dav 插件
                            source_data: JSON.stringify({ configName: davId, path: item.id }), // 你的抓包核心数据
                            dedup_key: `dav_${davId}_${item.id}`,                       // 官方唯一防重排键
                            streamUrl: item.streamUrl,                                  // 附带直链，供前端 0 延迟秒播
                            _isOnlineObj: true                                          // 标记为在线资源
                        });
                    }
                }

                if (audioItems.length > 0) {
                    let plName = currentPath === '/' ? '根目录' : currentPath.split('/').pop() || '未知文件夹';
                    resultLibrary[plName] = audioItems;
                    scannedFoldersCount++;
                }

                // ⏱️ 3秒心跳批处理写入：减轻 QuickJS 存盘磁盘 I/O 压力
                if (Date.now() - lastWriteTime > 3000) {
                    await songloft.storage.set(`webdav_lib_${davId}`, JSON.stringify(resultLibrary));
                    lastWriteTime = Date.now();
                }

            } catch (err) {
                songloft.logger.error(`[WebDAV] 扫描出错 ${currentPath}:`, String(err));
            }
        }

        if (currentScanVersion === version) {
            await songloft.storage.set(`webdav_lib_${davId}`, JSON.stringify(resultLibrary));
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