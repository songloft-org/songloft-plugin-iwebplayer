/// <reference types="@songloft/plugin-sdk" />
import { jsonResponse, createRouter } from '@songloft/plugin-sdk';

const router = createRouter();

// 初始页面：获取所有歌单和歌曲（内置了 cover_url 和 lyric_url）
router.get('/musiclist', async (req) => {
  try {
    const allPlaylists: any = {};
    const customNames: string[] = [];

    // 1. 初始化固定格子
    allPlaylists["所有歌曲"] = [];
    allPlaylists["曲库搜索"] = [];
    allPlaylists["收藏"] = [];

    // 2. 实时获取系统配置
    const hostUrl = await songloft.plugin.getHostUrl();
    const token = await songloft.plugin.getToken();

    // 3. 获取歌单是否包括子目录歌曲
    const res = await fetch(`${hostUrl}/api/v1/configs/scan_auto_create_include_subdirs`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    const configDetail = res.ok ? await res.json() : { value: "false" };
    const includeSubDirs = configDetail.value === "true";

    // 获取所有歌单牌子
    const playlists = (await songloft.playlists.list()) ?? [];

    if (includeSubDirs) {
      // 🟢 模式 A：包含子目录
      await Promise.all(playlists.map(async (pl) => {
        try {
          const plSongs = (await songloft.playlists.getSongs(pl.id, { limit: 10000 })) ?? [];
          const cleanedSongs = plSongs.map((s: any) => ({ ...s }));

          // 顺手判断身份并记录
          const isAutoCreated = pl.labels && pl.labels.includes("auto_created");
          if (!isAutoCreated) customNames.push(pl.name);

          if (pl.name === 'music') {
            allPlaylists["所有歌曲"] = cleanedSongs;
          } else {
            allPlaylists[`${pl.name}`] = cleanedSongs;
          }
        } catch (e) {}
      }));

    } else {
      // 🔴 模式 B：不含子目录
      await Promise.all(playlists.map(async (pl) => {
        try {
          const plSongs = (await songloft.playlists.getSongs(pl.id, { limit: 10000 })) ?? [];
          const cleanedSongs = plSongs.map((s: any) => ({ ...s }));

          allPlaylists[`${pl.name}`] = cleanedSongs;

          // 顺手判断身份并记录
          const isAutoCreated = pl.labels && pl.labels.includes("auto_created");
          if (!isAutoCreated) {
              customNames.push(pl.name);
          } else {
              allPlaylists["所有歌曲"].push(...cleanedSongs);
          }
        } catch (e) {}
      }));
    }

    allPlaylists["_playlist_meta"] = playlists;
    allPlaylists["_custom_playlists"] = customNames;

    return jsonResponse(allPlaylists);
  } catch (error) {
    return jsonResponse({ "所有歌曲": [], "曲库搜索": [], "收藏": [] });
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
        // const rawSongs = (await songloft.songs.list({ limit: 1000 })) ?? {};
        // debugResult.songs = rawSongs;


        // ==========================================
        // 🟢 模块 2：查看所有歌单（不需要时直接注释掉整块）
        // ==========================================
         const playlists = (await songloft.playlists.list()) ?? [];
         debugResult.playlists = playlists;


        // ==========================================
        // 🟢 模块 3：查看系统配置（不需要时直接注释掉整块）
        // ==========================================
        const hostUrl = await songloft.plugin.getHostUrl();
        const token = await songloft.plugin.getToken();
        const targetUrl = `${hostUrl}/api/v1/configs?limit=100`; // 想查单个配置就把这里改成具体 Key
        const res = await fetch(targetUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
        debugResult.configs = await res.json();

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