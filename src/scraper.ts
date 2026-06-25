// src/scraper.ts
// iWebPlayer 后端刮削引擎 (Phase 2: 满血雷达评分版 + Debug透传)

// ==========================================
// 🌟 核心情报箱：用于供 /debug 页面读取
// ==========================================
let lastScrapeLog: any = null; // 内部私有变量

export function getLastScrapeLog() {
    return lastScrapeLog; // 暴露出获取函数
}

function initScrapeLog(targetInfo: any) {
    // ⚡ 生产环境为了极致性能，直接短路掉日志初始化
    /* lastScrapeLog = {
        target: targetInfo,
        timestamp: new Date().toISOString(),
        attempts: []
    };
    */
}

function addScrapeAttempt(attemptLog: any) {
    // ⚡ 生产环境为了极致性能，直接短路掉数组 push 动作
    /*
    if (lastScrapeLog && lastScrapeLog.attempts) {
        lastScrapeLog.attempts.push(attemptLog);
    }
    */
}

// ==========================================
// 工具函数
// ==========================================
function cleanStr(str: string): string {
    if (!str) return "";
    return String(str).replace(/\.[^/.]+$/, "").replace(/[\(（].*?[\)）]/g, '').replace(/\s+/g, '').toLowerCase().trim();
}

function parseArtists(str: string): string[] {
    if (!str) return [];
    return str.split(/&|、|,|，|\/|\||和|与|feat\.|ft\./i).map(a => a.replace(/\s+/g, '').toLowerCase().trim()).filter(a => a);
}

function isArtistMatch(localArtists: string[], apiArtists: string[]): boolean {
    if (localArtists.length === 0 || apiArtists.length === 0) return false;
    return localArtists.some(la => apiArtists.includes(la));
}

async function fetchWithTimeout(url: string, timeoutMs = 3000): Promise<any> {
    try {
        const res: any = await Promise.race([
            fetch(url, { method: 'GET' }),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), timeoutMs))
        ]);
        return res;
    } catch (e) {
        return null;
    }
}

// 🖼️ 获取封面 (保持原样)
export async function scrapeCover(searchTerm: string): Promise<string | null> {
    if (!searchTerm) return null;
    const appleUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(searchTerm)}&media=music&entity=song&limit=1`;
    let res = await fetchWithTimeout(appleUrl);

    if (res && res.status === 429) {
        await new Promise(r => setTimeout(r, 3000));
        res = await fetchWithTimeout(appleUrl);
    }

    if (res && res.ok) {
        try {
            const data = await res.json();
            if (data && data.results && data.results.length > 0) {
                return data.results[0].artworkUrl100.replace('100x100bb', '600x600bb');
            }
        } catch(e) {}
    }

    const neteaseUrl = `https://music.163.com/api/cloudsearch/pc?s=${encodeURIComponent(searchTerm)}&type=1&limit=1`;
    const neRes = await fetchWithTimeout(neteaseUrl);
    if (neRes && neRes.ok) {
        try {
            const neData = await neRes.json();
            if (neData && neData.result && neData.result.songs && neData.result.songs.length > 0) {
                const al = neData.result.songs[0].al;
                if (al && al.picUrl) return al.picUrl + "?param=600y600";
            }
        } catch(e) {}
    }
    return null;
}


// ==========================================
// 🎤 lrc.cx 加权评分抓取器 (多维雷达探测 - V2 精准版)
// ==========================================
async function fetchFromLrcCx(title: string, artist: string): Promise<string | null> {
    if (!title) return null;

    let attemptLog = {
        api: 'lrc.cx',
        query: { title, artist },
        candidates: [] as any[],
        selected: null as any,
        all: null
    };

    const url = `https://api.lrc.cx/jsonapi?title=${encodeURIComponent(title)}` + (artist ? `&artist=${encodeURIComponent(artist)}` : "");
    const res = await fetchWithTimeout(url);

    if (!res || !res.ok) {
        attemptLog.candidates.push({ message: "API请求失败或超时" });
        addScrapeAttempt(attemptLog);
        return null;
    }

    let data: any;
    try { data = await res.json(); } catch(e) {
        attemptLog.candidates.push({ message: "API返回非JSON格式" });
        addScrapeAttempt(attemptLog);
        return null;
    }

    let bestLrc: string | null = null;

    if (Array.isArray(data) && data.length > 0) {
        const cLocalTitle = cleanStr(title);
        const localArtists = parseArtists(artist);

        // 🌟 新增：提取不丢弃括号的原始小写字符串，用于“绝对匹配”判定
        const rawLocalTitle = title.toLowerCase().replace(/\s+/g, '');

        let bestCandidate: any = null;
        let highestScore = -999;

        for (const item of data) {
            const lrcText = item.lrc;

            // ⛔ 门卫：一票否决
            if (typeof lrcText !== 'string' || lrcText.length < 60 || !/\[(\d{1,2}):(\d{2})(?:\.\d{1,3})?\]/m.test(lrcText)) {
                attemptLog.candidates.push({
                    api_title: item.title, api_artist: item.artist, api_from: item.from,
                    score: 0, status: "⛔ 淘汰 (无时间轴或纯文本)"
                });
                continue;
            }

            const cApiTitle = cleanStr(item.title);
            const rawApiTitle = item.title.toLowerCase().replace(/\s+/g, '');
            const apiArtists = parseArtists(item.artist);

            let score = 0;
            let titleLog = "";
            let artistLog = "";
            let bonusLog = "";

            // ⚖️ 维度一：歌名匹配 (满分 50)
            if (rawLocalTitle === rawApiTitle) {
                // 连括号和特殊字符都完全一样，才是真正的绝对一致！
                score += 50; titleLog = "绝对一致(+50)";
            } else if (cLocalTitle === cApiTitle) {
                // 抠掉括号后一致
                score += 40; titleLog = "清洗一致(+40)";
            } else if (cLocalTitle && cApiTitle && (cApiTitle.includes(cLocalTitle) || cLocalTitle.includes(cApiTitle))) {
                score += 20; titleLog = "部分包含(+20)";
            } else {
                titleLog = "不匹配(0)";
            }

            // ⚖️ 附加惩罚：原版防篡改判定
            const penaltyTags = ["live", "remix", "dj", "伴奏", "清唱", "合唱", "cover", "翻唱"];
            for (const tag of penaltyTags) {
                if (rawApiTitle.includes(tag) && !rawLocalTitle.includes(tag)) {
                    score -= 15;
                    titleLog += ` 降级(含${tag} -15)`;
                }
            }

            // ⚖️ 维度二：歌手匹配 (满分 40，不匹配扣 20 分防翻唱)
            if (isArtistMatch(localArtists, apiArtists)) {
                 const isExact = localArtists.length === apiArtists.length && localArtists.every(la => apiArtists.includes(la));
                 if (isExact) {
                     score += 40; artistLog = "完全一致(+40)";
                 } else {
                     score += 25; artistLog = "部分命中(+25)";
                 }
            } else {
                score -= 20; artistLog = "未命中(-20)";
            }

            // ⚖️ 维度三：滚动格式及格分 (活过门卫的保底得 30 分)
            score += 30;

            // ⚖️ 维度四：歌曲完整度加成 (长度满分 10)
            if (lrcText.length > 150) {
                score += 10; bonusLog += "长度足(+10) ";
            }

            // 🌟 维度五：网易云血统信仰加成 (+10分)
            if (item.from === 'Netease') {
                score += 10; bonusLog += "网易源(+10) ";
            }

            // 🌟 维度六：元数据考究加成 (作词作曲各 +5分)
            if (lrcText.includes('作词') || lrcText.includes('作詞')) {
                score += 5; bonusLog += "含作词(+5) ";
            }
            if (lrcText.includes('作曲')) {
                score += 5; bonusLog += "含作曲(+5) ";
            }

            const candLog = {
                api_title: item.title,
                api_artist: item.artist,
                api_from: item.from,
                score: score,
                detail: `歌名:${titleLog}, 歌手:${artistLog}, 增益:${bonusLog || "无"}`,
                status: ""
            };

            // 竞选最高分
            if (score > highestScore) {
                highestScore = score;
                bestCandidate = { item, logRef: candLog };
            }

            attemptLog.candidates.push(candLog);
        }

        const PASS_SCORE = 60;
        if (bestCandidate) {
            if (highestScore >= PASS_SCORE) {
                bestCandidate.logRef.status = `✅ 最终入选 (全场最高分且及格)`;
                bestLrc = bestCandidate.item.lrc;
                attemptLog.selected = bestCandidate.logRef;
            } else {
                bestCandidate.logRef.status = `❌ 抛弃 (最高分仍不及格)`;
            }
        }
    }

    addScrapeAttempt(attemptLog);
    return bestLrc;
}

// ==========================================
// 🎤 获取歌词：瀑布流主入口
// ==========================================
export async function scrapeLyric(title: string, artist: string, filename: string): Promise<string | null> {
    // 1. 初始化情报箱
    initScrapeLog({ query_title: title, query_artist: artist, query_filename: filename });

    // 2. 正常查询
    if (title && artist) {
        const lrc = await fetchFromLrcCx(title, artist);
        if (lrc) return lrc;
    }

    // 3. 切割文件名兜底查询
    if (filename.includes('-')) {
        const parts = filename.split('-');
        const part1 = parts[0].trim();
        const part2 = parts.slice(1).join('-').trim();

        let lrc = await fetchFromLrcCx(part1, part2);
        if (lrc) return lrc;

        lrc = await fetchFromLrcCx(part2, part1);
        if (lrc) return lrc;
    } else {
        let lrc = await fetchFromLrcCx(filename, "");
        if (lrc) return lrc;
    }

    // 4. 最终兜底 lrclib.net (严格要求必须是 syncedLyrics 滚动歌词)
    const qTerm = encodeURIComponent(filename);
    let lrclibLog = { api: 'lrclib.net', query: { filename }, result: "" };

    const res3 = await fetchWithTimeout(`https://lrclib.net/api/search?q=${qTerm}`);
    if (res3 && res3.ok) {
        try {
            const data = await res3.json();
            if (data && data.length > 0) {
                const synced = data[0].syncedLyrics;
                if (synced && synced.length >= 60) {
                    lrclibLog.result = "✅ 兜底命中 (获取到合规滚动歌词)";
                    addScrapeAttempt(lrclibLog);
                    return synced;
                } else {
                    lrclibLog.result = "❌ 兜底淘汰 (未找到带时间轴的滚动歌词)";
                }
            } else {
                lrclibLog.result = "❌ 兜底淘汰 (未搜到结果)";
            }
        } catch(e) {
            lrclibLog.result = "❌ 解析报错";
        }
    } else {
        lrclibLog.result = "❌ 请求超时或失败";
    }

    addScrapeAttempt(lrclibLog);
    return null;
}