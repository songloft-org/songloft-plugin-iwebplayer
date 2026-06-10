/**
 * iWebPlayer 专属元数据刮削引擎 (Cover & Lyrics)
 * 职责：纯粹的黑盒数据获取，内部处理名字清洗和限流重试，最终只返回 String 或 null
 */
(function(global) {
    'use strict';

    // 内部工具函数：用于歌词匹配的名字清洗
    function cleanStr(str) {
        if (!str) return "";
        return String(str).replace(/\.[^/.]+$/, "").replace(/[\(（].*?[\)）]/g, '').replace(/\s+/g, '').toLowerCase().trim();
    }

    function parseArtists(str) {
        if (!str) return [];
        return str.split(/&|、|,|，|\/|\||和|与|feat\.|ft\./i).map(a => a.replace(/\s+/g, '').toLowerCase().trim()).filter(a => a);
    }

    function isArtistMatch(localArtists, apiArtists) {
        if (localArtists.length === 0 || apiArtists.length === 0) return false;
        return localArtists.some(la => apiArtists.includes(la));
    }

    async function fetchProxyJSON(targetUrl, timeoutMs = 3000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(`/api/v1/proxy?url=${encodeURIComponent(targetUrl)}`, {
                method: 'GET',
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (res.ok) return await res.json();
        } catch (e) {} finally {
            clearTimeout(timeoutId);
        }
        return null;
    }

    async function fetchFromLrcCx(title, artist, isStrict) {
        let resLrc = null;
        if (!title) return { lrc: null };

        const data = await fetchProxyJSON(`https://api.lrc.cx/jsonapi?title=${encodeURIComponent(title)}` + (artist ? `&artist=${encodeURIComponent(artist)}` : ""));

        if (Array.isArray(data) && data.length > 0) {
            const cLocalTitle = cleanStr(title);
            const localArtists = parseArtists(artist);

            for (const item of data) {
                let isMatch = false;
                const cApiTitle = cleanStr(item.title);
                const apiArtists = parseArtists(item.artist);

                if (isStrict) {
                    if (cLocalTitle === cApiTitle && isArtistMatch(localArtists, apiArtists)) isMatch = true;
                } else {
                    if (cLocalTitle && cApiTitle && (cApiTitle.includes(cLocalTitle) || cLocalTitle.includes(cApiTitle))) isMatch = true;
                }

                if (isMatch) {
                    if (!resLrc && typeof item.lrc === 'string' && item.lrc.length > 60 && /\[(\d{1,2}):(\d{2})(?:\.\d{1,3})?\]/m.test(item.lrc)) {
                        resLrc = item.lrc;
                    }
                    if (resLrc) break;
                }
            }
        }
        return { lrc: resLrc };
    }

    // 🌟 核心暴露接口
    global.Scraper = {

        // 获取封面：苹果主攻 -> 429重试 -> 网易云兜底
        async getCover(rawItem) {
            if (!rawItem) return null;

            // 1. 提取并清洗文件名
            const songName = global.getSongNameObj ? global.getSongNameObj(rawItem) : String(rawItem.file_path || '').split('/').pop();
            const filename = songName.replace(/\.(mp3|flac|wav|m4a|aac|ogg|ape|wma|alac)(.*)$/i, '').replace(/#.*$/, '');
            let searchTerm = filename;
            if (filename.includes('-')) searchTerm = `${filename.split('-')[1].trim()} ${filename.split('-')[0].trim()}`;

            const proxyUrl = `/api/v1/proxy?url=${encodeURIComponent(`https://itunes.apple.com/search?term=${encodeURIComponent(searchTerm)}&media=music&entity=song&limit=1`)}`;

            const doFetch = async () => {
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 3000);
                    const res = await fetch(proxyUrl, { signal: controller.signal });
                    clearTimeout(timeoutId);
                    return res;
                } catch(e) { return null; }
            };

            let res = await doFetch();

            // 遇到429限流，内部默默等待3秒重试
            if (res && res.status === 429) {
                await new Promise(r => setTimeout(r, 3000));
                res = await doFetch();
            }

            let hdCover = null;

            // 解析苹果结果
            if (res && res.ok) {
                try {
                    const data = await res.json();
                    if (data && data.results && data.results.length > 0) {
                        hdCover = data.results[0].artworkUrl100.replace('100x100bb', '600x600bb');
                    }
                } catch(e) {}
            }

            // 苹果失败，网易云单次兜底
            if (!hdCover) {
                const neteaseUrl = `/api/v1/proxy?url=${encodeURIComponent(`https://music.163.com/api/cloudsearch/pc?s=${encodeURIComponent(searchTerm)}&type=1&limit=1`)}`;
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 3000);
                    const neRes = await fetch(neteaseUrl, { signal: controller.signal });
                    clearTimeout(timeoutId);
                    if (neRes.ok) {
                        const neData = await neRes.json();
                        if (neData && neData.result && neData.result.songs && neData.result.songs.length > 0) {
                            const al = neData.result.songs[0].al;
                            if (al && al.picUrl) hdCover = al.picUrl + "?param=600y600";
                        }
                    }
                } catch(e) {}
            }

            return hdCover;
        },

        // 获取歌词：本地解析 -> Lrc.cx精准 -> Lrc.cx模糊 -> Lrclib
        async getLyrics(rawItem, globalToken, currentSongName) {
            let finalLrc = null;

            // 1. 本地接口自带歌词
            if (rawItem.lyric_url) {
                try {
                    const lrcRes = await fetch(`${rawItem.lyric_url}?access_token=${globalToken}`);
                    if (lrcRes.ok) {
                        const rawText = await lrcRes.text();
                        let lrcText = rawText;
                        try {
                            const jsonObj = JSON.parse(rawText);
                            if (jsonObj.lyric) lrcText = jsonObj.lyric;
                            else if (jsonObj.lrc) lrcText = jsonObj.lrc;
                        } catch (e) {}

                        if (lrcText && lrcText.length > 10 && lrcText.includes('[')) {
                            finalLrc = lrcText;
                        }
                    }
                } catch (e) { }
            }

            if (finalLrc) return finalLrc;

            // 2. 外部歌词兜底刮削
            let scrapeTitle = rawItem.title || "";
            let scrapeArtist = rawItem.artist || "";

            if (scrapeTitle && scrapeArtist) {
                const res1 = await fetchFromLrcCx(scrapeTitle, scrapeArtist, true);
                if (res1.lrc) return res1.lrc;
            }

            const filename = currentSongName.replace(/\.(mp3|flac|wav|m4a|aac|ogg|ape|wma|alac)(.*)$/i, '').replace(/#.*$/, '');
            if (filename.includes('-')) {
                let nameFormat = localStorage.getItem('iwebplayer.music_name_format') || 'Title-Artist';
                const parts = filename.split('-');
                const part1 = parts[0].trim();
                const part2 = parts.slice(1).join('-').trim();
                let guessTitle = nameFormat === 'Title-Artist' ? part1 : part2;
                let guessArtist = nameFormat === 'Title-Artist' ? part2 : part1;

                let res2 = await fetchFromLrcCx(guessTitle, guessArtist, true);
                if (!res2.lrc) {
                    guessTitle = nameFormat === 'Title-Artist' ? part2 : part1;
                    guessArtist = nameFormat === 'Title-Artist' ? part1 : part2;
                    res2 = await fetchFromLrcCx(guessTitle, guessArtist, true);
                    if (res2.lrc) localStorage.setItem('iwebplayer.music_name_format', nameFormat === 'Title-Artist' ? 'Artist-Title' : 'Title-Artist');
                }
                if (res2.lrc) return res2.lrc;
            } else {
                const res2_loose = await fetchFromLrcCx(filename, "", false);
                if (res2_loose.lrc) return res2_loose.lrc;
            }

            // 3. Lrclib.net 最终兜底
            const qTerm = encodeURIComponent(filename);
            try {
                const res3 = await fetch(`https://lrclib.net/api/search?q=${qTerm}`);
                if (res3.ok) {
                    const data = await res3.json();
                    if (data && data.length > 0) {
                        const fetchedLyrics = data[0].syncedLyrics || data[0].plainLyrics;
                        if (fetchedLyrics) return fetchedLyrics;
                    }
                }
            } catch (e) {}

            return null;
        }
    };

})(window);