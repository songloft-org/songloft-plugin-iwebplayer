/// <reference types="@songloft/plugin-sdk" />
import { jsonResponse, createRouter } from '@songloft/plugin-sdk';

const router = createRouter();

// 🌟 全局临时沙盒：只在前端拉歌的短短几秒内存在，超时必死，绝不长驻内存！
let flashSongsCache: any[] | null = null;
let flashTimeout: any = null;

router.get('/musiclist', async (req) => {
  try {
    const urlParams = new URLSearchParams(String(req.query));
    const action = urlParams.get('action') || 'legacy';

    // ==========================================
    // 🚚 抽屉 1：获取轻量级骨架图纸 (action=meta)
    // ==========================================
    if (action === 'meta') {
      // 1. 安全清理残留的缓存和定时器
      if (flashTimeout) { clearTimeout(flashTimeout); flashTimeout = null; }
      flashSongsCache = null;

      const structure: any = {};
      const customNames: string[] = [];
      const songMap = new Map(); // 用于全库去重

      const playlists = (await songloft.playlists.list()) ?? [];

      await Promise.all(playlists.map(async (pl) => {
        try {
          const plSongs = (await songloft.playlists.getSongs(pl.id, { limit: 10000 })) ?? [];
          // 极速白名单瘦身，抹除 fingerprint 等 504 隐患
          const cleanedSongs = plSongs.map((s: any) => ({
              id: s.id,
              title: s.title || "",
              artist: s.artist || "",
              album: s.album || "",
              file_path: s.file_path || "",
              cover_url: s.cover_url || "",
              duration: s.duration || 0,
              type: s.type || "local"
          }));

          // 骨肉分离：把实体歌曲替换成纯数字 ID 数组
          if (pl.name !== 'music') {
              structure[`${pl.name}`] = cleanedSongs.map((s: any) => s.id);
          }

          // 判别自定义与外部歌单
          const isAutoCreated = pl.labels && pl.labels.includes("auto_created");
          if (!isAutoCreated) {
              customNames.push(pl.name);
          }

          // 【最强方案一】合流：只要不是 built_in，统统倒进大池子去重
          const isBuiltIn = pl.labels && pl.labels.includes("built_in");
          if (!isBuiltIn) {
              for (const s of cleanedSongs) {
                  if (s && s.id) songMap.set(s.id, s);
              }
          }
        } catch (e) {}
      }));

      // 提取去重后的全库实体数组，准备装车
      const allSongsArray = Array.from(songMap.values());

      // 完善大盘的骨架映射
      structure["所有歌曲"] = allSongsArray.map((s: any) => s.id);
      structure["曲库搜索"] = [];
      structure["收藏"] = [];

      // 2. 将实体歌曲停入沙盒，等待前端召唤
      flashSongsCache = allSongsArray;

      // 3. 💣 埋下自杀炸弹：60 秒后强制释放内存，保护 NAS！
      flashTimeout = setTimeout(() => {
          flashSongsCache = null;
          flashTimeout = null;
      }, 60000);

      // 4. 秒回体积微小的骨架图纸
      return jsonResponse({
          structure: structure,
          _custom_playlists: customNames,
          _playlist_meta: playlists
      });
    }

    // ==========================================
    // 🚚 抽屉 2：蚂蚁搬家分页切片 (action=chunk)
    // ==========================================
    if (action === 'chunk') {
      if (!flashSongsCache) return jsonResponse([]);

      const page = parseInt(urlParams.get('page') || '1');
      const pageSize = 500; // 每次只传 500 首，丝滑无痛
      const start = (page - 1) * pageSize;
      const end = start + pageSize;

      return jsonResponse(flashSongsCache.slice(start, end)); // 0毫秒极速切片
    }

    // ==========================================
    // 🚚 抽屉 3：功成身退手动销毁 (action=destroy)
    // ==========================================
    if (action === 'destroy') {
      if (flashTimeout) { clearTimeout(flashTimeout); flashTimeout = null; }
      flashSongsCache = null; // 内存瞬间释放
      return jsonResponse({ ret: "OK" });
    }

    return jsonResponse({ error: "非法访问，请使用标准 action 抽屉" });
  } catch (error) {
    return jsonResponse({ error: "后端核心引擎崩溃" });
  }
});

// 播放歌曲（极限瘦身版！）
router.get('/musicinfo', async (req) => {
  try {
    const id = new URLSearchParams(String(req.query)).get('id') || "";
    if (!id) return jsonResponse({ error: "缺少歌曲ID" }, 400);

    const token = await songloft.plugin.getToken();

    // 🌟 核心修改：因为前端已经在列表里拿到了封面和歌词，这里完全不需要再去查询大系统了！
    // 直接拼接带 Token 的播放直链，0毫秒延迟打回给前端！
    const audioUrl = `/api/v1/songs/${id}/play?access_token=${token}`;

    return jsonResponse({
      url: audioUrl
    });

  } catch (error) {
    return jsonResponse({ error: "获取歌曲直链失败: " + String(error) });
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
        // const rawSongs = (await songloft.songs.list({ limit: 10000 })) ?? {};
        // debugResult.songs = rawSongs;


        // ==========================================
        // 🟢 模块 2：查看所有歌单（不需要时直接注释掉整块）
        // ==========================================
         const playlists = (await songloft.playlists.list()) ?? [];
         debugResult.playlists = playlists;


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