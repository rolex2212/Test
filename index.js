const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

const headers = {
    "User-Agent": "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3",
    "X-User-Agent": "Model: MAG250; Link: WiFi",
    "Cookie": "mac=00:1A:79:17:1E:AA; stb_lang=en; timezone=GMT",
    "Referer": "http://tv.maxx4k.cc/stalker_portal/c/",
    "Accept": "*/*"
};

// 1. Proxy Part (ரீஸ்ட்ரீமிங் வீடியோ துண்டுகள்)
app.get('/proxy', async (req, res) => {
    try {
        const url = Buffer.from(req.query.url, 'base64').toString();
        const response = await axios.get(url, { headers, responseType: 'stream' });
        res.setHeader('Content-Type', 'video/mp2t');
        response.data.pipe(res);
    } catch (e) { res.status(500).send("Proxy Error"); }
});

// 2. Main Logic
app.get('/master.m3u8', async (req, res) => {
    const channelName = req.query.c;
    if (!channelName) return res.send("Add ?c=ChannelName");

    try {
        // Handshake
        const hs = await axios.get("http://tv.maxx4k.cc/stalker_portal/server/load.php?type=stb&action=handshake&JsHttpRequest=1-xml", { headers });
        const token = hs.data.js.token;
        const authH = { ...headers, "Authorization": `Bearer ${token}` };

        // Profile
        await axios.get("http://tv.maxx4k.cc/stalker_portal/server/load.php?type=stb&action=get_profile&stb_type=MAG250&sn=797995C29B984&device_id=797995c29b984c9b0f4cd869c93cd610&JsHttpRequest=1-xml", { headers: authH });

        // Get Channels
        const all = await axios.get("http://tv.maxx4k.cc/stalker_portal/server/load.php?type=itv&action=get_all_channels&JsHttpRequest=1-xml", { headers: authH });
        const target = channelName.toLowerCase().replace(/_/g, '');
        const found = all.data.js.data.find(i => i.name.toLowerCase().replace(/[\s_]/g, '').includes(target));

        if (!found) return res.status(404).send("Channel Not Found");

        // Create Link
        const linkRes = await axios.get(`http://tv.maxx4k.cc/stalker_portal/server/load.php?type=itv&action=create_link&cmd=${encodeURIComponent(found.cmds[0].url)}&JsHttpRequest=1-xml`, { headers: authH });
        let streamUrl = linkRes.data.js.cmd;
        if (streamUrl.includes(' ')) streamUrl = streamUrl.split(' ').pop();

        // M3U8 Processing
        const m3u8Content = await axios.get(streamUrl, { headers });
        const baseUrl = streamUrl.substring(0, streamUrl.lastIndexOf('/') + 1);
        
        let m3u8Body = m3u8Content.data;
        // Nested Playlist Handling (e.g., index.m3u8 -> mono.m3u8)
        if (m3u8Body.includes('.m3u8')) {
            const lines = m3u8Body.split('\n');
            const nextM3u8 = lines.find(l => l.trim() && !l.startsWith('#'));
            const nextUrl = nextM3u8.startsWith('http') ? nextM3u8 : baseUrl + nextM3u8.trim();
            const nextContent = await axios.get(nextUrl, { headers });
            m3u8Body = nextContent.data;
        }

        const host = req.get('host');
        const finalM3u8 = m3u8Body.split('\n').map(line => {
            if (line.trim() && !line.startsWith('#')) {
                const full = line.startsWith('http') ? line : baseUrl + line.trim();
                return `http://${host}/proxy?url=${Buffer.from(full).toString('base64')}`;
            }
            return line;
        }).join('\n');

        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.send(finalM3u8);

    } catch (e) { res.status(500).send("Error: " + e.message); }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
