/// <reference types="@songloft/plugin-sdk" />
import { jsonResponse, createRouter } from '@songloft/plugin-sdk';
import { scrapeCover, scrapeLyric } from './scraper';
import { setupWebDAVRoutes } from './webdav';
import { scrapeCover, scrapeLyric, getLastScrapeLog } from './scraper';

const router = createRouter();
setupWebDAVRoutes(router);

// 🌟 全局临时沙盒：只在前端拉歌的短短几秒内存在，超时必死，绝不长驻内存！
let flashSongsCache: any[] | null = null;
let flashTimeout: any = null;

// 🌟 新增：搞一个全局变量，用来专门记录最新一次探测失败的底层原始错误
let lastSystemError: any = null;

router.get('/musiclist', async (req) => {
  try {
    const urlParams = new URLSearchParams(String(req.query));
    const action = urlParams.get('action') || 'legacy';

    // ==========================================
    // 🐜 引擎 A：低配兼容模式 (Light - 蚂蚁搬家)
    // ==========================================
    if (action === 'meta_light') {
      const customNames: string[] = [];
      const playlists = (await songloft.playlists.list()) ?? [];

      playlists.forEach(pl => {
          const isAutoCreated = pl.labels && pl.labels.includes("auto_created");
          if (!isAutoCreated) customNames.push(pl.name);
      });

      return jsonResponse({
          _custom_playlists: customNames,
          _playlist_meta: playlists
      });
    }

    if (action === 'playlist_songs') {
      const idStr = urlParams.get('id');
      if (!idStr) return jsonResponse({ error: "Missing playlist id" }, 400);

      const id = parseInt(idStr, 10);
      if (isNaN(id)) return jsonResponse({ error: "Invalid playlist id format" }, 400);

      const plSongs = (await songloft.playlists.getSongs(id, { limit: 10000 })) ?? [];

      const cleanedSongs = plSongs.map((s: any) => ({
          id: s.id, title: s.title || "", artist: s.artist || "", album: s.album || "",
          file_path: s.file_path || "", cover_url: s.cover_url || "", duration: s.duration || 0, type: s.type || "local",
          plugin_entry_path: s.plugin_entry_path || "", dedup_key: s.dedup_key || ""
      }));

      return jsonResponse(cleanedSongs);
    }

    // ==========================================
    // 🚀 引擎 B：高性能模式 (Bulk - 并发抽水)
    // ==========================================
    if (action === 'meta_bulk') {
      if (flashTimeout) { clearTimeout(flashTimeout); flashTimeout = null; }
      flashSongsCache = null;

      const structure: any = {};
      const customNames: string[] = [];
      const songMap = new Map();

      const playlists = (await songloft.playlists.list()) ?? [];

      await Promise.all(playlists.map(async (pl) => {
        try {
          const plSongs = (await songloft.playlists.getSongs(pl.id, { limit: 10000 })) ?? [];
          const cleanedSongs = plSongs.map((s: any) => ({
              id: s.id, title: s.title || "", artist: s.artist || "", album: s.album || "",
              file_path: s.file_path || "", cover_url: s.cover_url || "", duration: s.duration || 0, type: s.type || "local",
              plugin_entry_path: s.plugin_entry_path || "", dedup_key: s.dedup_key || ""
          }));

          if (pl.name !== 'music') {
              structure[`${pl.name}`] = cleanedSongs.map((s: any) => s.id);
          }

          const isAutoCreated = pl.labels && pl.labels.includes("auto_created");
          if (!isAutoCreated) customNames.push(pl.name);

          const isBuiltIn = pl.labels && pl.labels.includes("built_in");
          if (!isBuiltIn) {
              for (const s of cleanedSongs) {
                  if (s && s.id) songMap.set(s.id, s);
              }
          }
        } catch (e) {}
      }));

      const allSongsArray = Array.from(songMap.values());
      structure["所有歌曲"] = allSongsArray.map((s: any) => s.id);
      structure["曲库搜索"] = [];

      flashSongsCache = allSongsArray;
      flashTimeout = setTimeout(() => {
          flashSongsCache = null;
          flashTimeout = null;
      }, 60000);

      return jsonResponse({
          structure: structure,
          _custom_playlists: customNames,
          _playlist_meta: playlists
      });
    }

    if (action === 'chunk') {
      if (!flashSongsCache) return jsonResponse([]);
      const page = parseInt(urlParams.get('page') || '1');
      const pageSize = 1000;
      const start = (page - 1) * pageSize;
      const end = start + pageSize;
      return jsonResponse(flashSongsCache.slice(start, end));
    }

    if (action === 'destroy') {
      if (flashTimeout) { clearTimeout(flashTimeout); flashTimeout = null; }
      flashSongsCache = null;
      return jsonResponse({ ret: "OK" });
    }

    return jsonResponse({ error: "非法访问，请使用标准 action 抽屉" });
  } catch (error) {
    return jsonResponse({ error: "后端核心引擎崩溃" });
  }
});

// 播放歌曲（极限瘦身 + 智能探测 + 统一极简报错）
router.get('/musicinfo', async (req) => {
  try {
    const id = new URLSearchParams(String(req.query)).get('id') || "";
    if (!id) throw new Error("缺少歌曲ID");

    const token = await songloft.plugin.getToken();
    const audioUrl = `/api/v1/songs/${id}/play?access_token=${token}`;
    const fullUrl = `${await songloft.plugin.getHostUrl()}${audioUrl}`;

    // 🌟 赛跑机制探测 (3秒超时)
    const probeRes: any = await Promise.race([
        fetch(fullUrl, { method: 'HEAD' }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("探测超时")), 3000))
    ]);

    // 如果文件丢失或拒绝访问，直接抛出错误
    if (!probeRes.ok) throw new Error(`资源拒绝访问 (HTTP ${probeRes.status})`);

    // 探测通过，清空上一次的错误记录，下发直链
    lastSystemError = null;
    return jsonResponse({ url: audioUrl });

  } catch (error) {
    // 🌟 统一兜底：所有报错都汇聚于此
    lastSystemError = String(error); // 塞给全局变量，留给 /debug 后门排查
    return jsonResponse({ error: "音频链接已失效" }); // 给前端极简回复（不带url字段触发前端切歌）
  }
});

// ==========================================
// ☁️ 云端接力：读取/保存云端账本 (防弹升级版)
// ==========================================
router.get('/sync', async (req) => {
    try {
        const urlParams = new URLSearchParams(String(req.query));
        const playlist = urlParams.get('playlist');
        if (!playlist) return jsonResponse({ error: "Missing playlist" }, 400);

        let dataStr = "";
        const key = `sync_${playlist}`;

        // 稳妥探测底层 API
        if (typeof songloft.storage.getItem === 'function') {
            dataStr = await songloft.storage.getItem(key);
        } else if (typeof songloft.storage.get === 'function') {
            dataStr = await songloft.storage.get(key);
        }

        if (!dataStr) return jsonResponse({ data: null });
        return jsonResponse({ data: JSON.parse(dataStr) });
    } catch (error) {
        return jsonResponse({ error: "云端读取崩溃: " + String(error) });
    }
});

router.post('/sync', async (req) => {
    try {
        // 🌟 修复 1：规避 req.json() 不是函数的问题，直接手撕 req.body 字符串
        let bodyStr = req.body;
        if (typeof bodyStr !== 'string') {
            bodyStr = String(bodyStr);
        }
        const body = JSON.parse(bodyStr);

        const playlist = body.playlist;
        if (!playlist) return jsonResponse({ error: "Missing playlist" }, 400);

        const dataToSave = {
            songName: body.songName,
            time: body.time,
            updateAt: Date.now()
        };

        const key = `sync_${playlist}`;
        const val = JSON.stringify(dataToSave);

        // 🌟 修复 2：稳妥调用，不玩 .call() 的花活
        if (typeof songloft.storage.setItem === 'function') {
            await songloft.storage.setItem(key, val);
        } else if (typeof songloft.storage.set === 'function') {
            await songloft.storage.set(key, val);
        } else {
            throw new Error("存储引擎不支持写入");
        }

        return jsonResponse({ ret: "OK" });
    } catch (error) {
        return jsonResponse({ error: "云端写入崩溃: " + String(error) });
    }
});

// ==========================================
// 🗄️ 通用配置存储接口 (用于保存平台排序等配置)
// ==========================================
router.get('/store', async (req) => {
    try {
        const urlParams = new URLSearchParams(String(req.query));
        const key = urlParams.get('key');
        if (!key) return jsonResponse({ error: "Missing key" }, 400);

        let dataStr = "";
        if (typeof songloft.storage.getItem === 'function') {
            dataStr = await songloft.storage.getItem(key);
        } else if (typeof songloft.storage.get === 'function') {
            dataStr = await songloft.storage.get(key);
        }

        return jsonResponse({ data: dataStr });
    } catch (error) {
        return jsonResponse({ error: "读取配置失败: " + String(error) });
    }
});

router.post('/store', async (req) => {
    try {
        let bodyStr = req.body;
        if (typeof bodyStr !== 'string') {
            bodyStr = String(bodyStr);
        }
        const body = JSON.parse(bodyStr);

        const key = body.key;
        const value = body.value;
        if (!key) return jsonResponse({ error: "Missing key" }, 400);

        if (typeof songloft.storage.setItem === 'function') {
            await songloft.storage.setItem(key, value);
        } else if (typeof songloft.storage.set === 'function') {
            await songloft.storage.set(key, value);
        } else {
            throw new Error("存储引擎不支持写入");
        }

        return jsonResponse({ ret: "OK" });
    } catch (error) {
        return jsonResponse({ error: "保存配置失败: " + String(error) });
    }
});

// ==========================================
// 🕷️ 刮削网关：统一处理封面与歌词请求
// ==========================================
router.get('/scrape', async (req) => {
    try {
        const urlParams = new URLSearchParams(String(req.query));
        const type = urlParams.get('type'); // 允许: 'cover' | 'lyric' | 'all'
        const title = urlParams.get('title') || '';
        const artist = urlParams.get('artist') || '';
        const filename = urlParams.get('filename') || '';

        let result: any = {};

        // 1. 刮封面
        if (type === 'cover' || type === 'all') {
            let searchTerm = filename;
            if (filename.includes('-')) {
                searchTerm = `${filename.split('-')[1].trim()} ${filename.split('-')[0].trim()}`;
            }
            if (!searchTerm && title) searchTerm = `${title} ${artist}`.trim();

            result.cover = await scrapeCover(searchTerm);
        }

        // 2. 刮歌词
        if (type === 'lyric' || type === 'all') {
            result.lyric = await scrapeLyric(title, artist, filename);
        }

        return jsonResponse(result);
    } catch (error) {
        return jsonResponse({ error: "刮削引擎发生错误: " + String(error) });
    }
});

// 🌟 专供 debug 页面调用的后门接口
// http://10.0.91.11:10333/api/v1/jsplugin/iwebplayer/static/debug.html

router.get('/debug', async (req) => {
    try {
        // 准备一个空托盘，用来装你想要输出的数据
        const debugResult: any = {};

        // ==========================================
        // 🟢 模块 1：查看所有歌曲（不需要时直接注释掉整块）
        // ==========================================
        const rawSongs = (await songloft.songs.list({ limit: 10000 })) ?? {};
        debugResult.songs = rawSongs;


        // ==========================================
        // 🟢 模块 2：查看所有歌单（不需要时直接注释掉整块）
        // ==========================================
        // const playlists = (await songloft.playlists.list()) ?? [];
        // debugResult.playlists = playlists;


        // ==========================================
        // 🟢 模块 3：查看系统配置（不需要时直接注释掉整块）
        // ==========================================
        // const hostUrl = await songloft.plugin.getHostUrl();
        // const token = await songloft.plugin.getToken();
        // const targetUrl = `${hostUrl}/api/v1/configs?limit=100`; // 想查单个配置就把这里改成具体 Key
        // const res = await fetch(targetUrl, {
        //         method: 'GET',
        //         headers: {
        //             'Authorization': `Bearer ${token}`,
        //             'Content-Type': 'application/json'
        //         }
        //     });
        // debugResult.configs = await res.json();

        // =============================================

        // const res = await fetch(`${hostUrl}/api/v1/configs/scan_auto_create_include_subdirs`, {
        //   method: 'GET',
        //   headers: {
        //     'Authorization': `Bearer ${token}`,
        //     'Content-Type': 'application/json'
        //   }
        // });
        // const configDetail = res.ok ? await res.json() : { value: "false" };
        // debugResult.ttt = configDetail.value

        // ==========================================
        // 🌟 把最新捕获的探子死因放进托盘输出
        // ==========================================
        //debugResult.lastProbeError = lastSystemError;

        // ==========================================
        // 🌟 新增：把最新一次的【歌词刮削打分全过程】放进托盘！
        // ==========================================
        //debugResult.lastScrapeLog = getLastScrapeLog() || "暂无刮削记录，请先在前端播放一首没有本地歌词的歌";

        // ==========================================
        // 📤 最终输出：把托盘里收集到的所有数据一把推给浏览器
        // ==========================================
        return jsonResponse(debugResult);

    } catch (error) {
        // 兜底：如果上面某行代码写残了，也不会白屏，而是告诉你哪里崩了
        return jsonResponse({ error: "Debug接口发生崩溃: " + String(error) });
    }
});



// ==== 核心生命周期函数 ====
function onInit(): void { songloft.log.info('iWebPlayer 原生架构已就绪！'); }
function onDeinit(): void {}
function onHTTPRequest(req: HTTPRequest): HTTPResponse { return router.handle(req); }

// @ts-expect-error
globalThis.onInit = onInit;
// @ts-expect-error
globalThis.onDeinit = onDeinit;
// @ts-expect-error
globalThis.onHTTPRequest = onHTTPRequest;

