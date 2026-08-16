import express from 'express';
import http from 'http';
import https from 'https';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import fs from 'fs';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;
const VIDEO_CACHE_DIR = path.join(__dirname, '.cache', 'videos');

if (!fs.existsSync(VIDEO_CACHE_DIR)) {
  fs.mkdirSync(VIDEO_CACHE_DIR, { recursive: true });
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Default demo topics and video links (Streamable support)
const DEFAULT_DEMO = {
  topic1: 'Chủ đề 1',
  video1Url: 'https://streamable.com/ifjh',
  topic2: 'Chủ đề 2',
  video2Url: 'https://streamable.com/ifjh',
  topic3: 'Chủ đề 3',
  video3Url: 'https://streamable.com/ifjh',
  themeAudioUrl: 'The Master Of Minds - Category.mp3',
  audio5sUrl: 'The Master Of Minds - 5s CountDown.mp3',
  audio3sUrl: '3s.mp3',
  clipBedAudioUrl: 'The Master Of Minds - Clip bed R2.mp3'
};

// In-memory room store
const rooms = new Map();

function generateRandom6Digit() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateRandomPassword() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    const newRoom = {
      roomId,
      createdAt: Date.now(),
      passwords: {
        player1: generateRandomPassword(),
        player2: generateRandomPassword(),
        player3: generateRandomPassword()
      },
      topic1: DEFAULT_DEMO.topic1,
      topic2: DEFAULT_DEMO.topic2,
      topic3: DEFAULT_DEMO.topic3,
      topic1Visible: false,
      topic2Visible: false,
      topic3Visible: false,
      video1Url: DEFAULT_DEMO.video1Url,
      video2Url: DEFAULT_DEMO.video2Url,
      video3Url: DEFAULT_DEMO.video3Url,
      themeAudioUrl: DEFAULT_DEMO.themeAudioUrl,
      audio5sUrl: DEFAULT_DEMO.audio5sUrl,
      audio3sUrl: DEFAULT_DEMO.audio3sUrl,
      clipBedAudioUrl: DEFAULT_DEMO.clipBedAudioUrl,
      videoState: {
        isPlaying: false,
        startedAt: null,
        startPosition: 0,
        currentSeconds: 0,
        updatedAt: Date.now()
      },
      timer60s: {
        isRunning: false,
        startedAt: null,
        startRemaining: 60,
        secondsRemaining: 60
      },
      activeAudio: {
        type: null,
        isPlaying: false,
        timestamp: Date.now()
      },
      connected: {
        controller: false,
        player1: false,
        player2: false,
        player3: false,
        viewers: 0
      }
    };
    rooms.set(roomId, newRoom);
  }
  return rooms.get(roomId);
}

// Initial demo room
const DEMO_ROOM_ID = '123456';
const demoRoom = getOrCreateRoom(DEMO_ROOM_ID);
demoRoom.passwords = {
  player1: '1111',
  player2: '2222',
  player3: '3333'
};

// -------------------------------------------------------------
// VIDEO STREAMING & UNIVERSAL TRANSCODING ENGINE (STREAMABLE & GOOGLE DRIVE)
// Ensures video displays clear visuals across all browsers
// -------------------------------------------------------------

const activeTranscodes = new Map();

function extractStreamableId(url) {
  if (!url) return null;
  url = String(url).trim().replace(/^['"`]|['"`]$/g, '');
  if (url.startsWith('/api/streamable-video/')) {
    return url.replace('/api/streamable-video/', '').split('?')[0].split('/')[0].trim();
  }

  const match = url.match(/(?:https?:\/\/)?(?:www\.)?streamable\.com\/(?:(?:e|o|m)\/)?([a-zA-Z0-9]+)/i);
  if (match && match[1]) return match[1];

  if (/^[a-zA-Z0-9]{4,12}$/.test(url)) {
    return url;
  }

  return null;
}

function extractDriveFileId(url) {
  if (!url) return null;
  url = String(url).trim().replace(/^['"`]|['"`]$/g, '');
  if (url.startsWith('/api/drive-video/')) {
    return url.replace('/api/drive-video/', '').split('?')[0].split('/')[0].trim();
  }

  const drivePatterns = [
    /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i,
    /drive\.google\.com\/(?:open|uc)\?(?:[^#]*&)?id=([a-zA-Z0-9_-]+)/i,
    /drive\.usercontent\.google\.com\/(?:download|uc)\?(?:[^#]*&)?id=([a-zA-Z0-9_-]+)/i,
    /lh3\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/i,
    /docs\.google\.com\/(?:file\/d\/|uc\?(?:[^#]*&)?id=)([a-zA-Z0-9_-]+)/i,
    /[?&]id=([a-zA-Z0-9_-]{25,60})/i
  ];

  for (const p of drivePatterns) {
    const match = url.match(p);
    if (match && match[1]) return match[1];
  }

  if (/^[a-zA-Z0-9_-]{25,60}$/.test(url)) {
    return url;
  }

  return null;
}

function streamLocalFile(filePath, req, res) {
  try {
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('Video file not found');
    }
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Accept, Content-Type, Origin');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Cache-Control', 'public, max-age=86400');

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize) {
        res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
        return res.end();
      }

      const chunkSize = end - start + 1;
      const fileStream = fs.createReadStream(filePath, { start, end });

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Content-Length': chunkSize
      });

      fileStream.pipe(res);
      req.on('close', () => fileStream.destroy());
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize
      });
      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
      req.on('close', () => fileStream.destroy());
    }
  } catch (err) {
    console.error('streamLocalFile error:', err);
    if (!res.headersSent) res.status(500).send('Error streaming file');
  }
}

// Streamable video processor with local high-speed caching & faststart
async function ensureStreamableVideo(streamableId) {
  if (!streamableId) throw new Error('Missing streamableId');
  const targetFilePath = path.join(VIDEO_CACHE_DIR, `streamable_${streamableId}.mp4`);
  if (fs.existsSync(targetFilePath) && fs.statSync(targetFilePath).size > 5000) {
    return targetFilePath;
  }

  const cacheKey = `streamable_${streamableId}`;
  if (activeTranscodes.has(cacheKey)) {
    return activeTranscodes.get(cacheKey);
  }

  const promise = (async () => {
    console.log(`[StreamableEngine] Fetching metadata for ${streamableId}...`);
    const apiUrl = `https://api.streamable.com/videos/${streamableId}`;
    let mp4DirectUrl = null;

    try {
      const resp = await fetch(apiUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      if (resp.ok) {
        const json = await resp.json();
        if (json.files) {
          if (json.files.mp4 && json.files.mp4.url) mp4DirectUrl = json.files.mp4.url;
          else if (json.files['mp4-high'] && json.files['mp4-high'].url) mp4DirectUrl = json.files['mp4-high'].url;
          else if (json.files['mp4-mobile'] && json.files['mp4-mobile'].url) mp4DirectUrl = json.files['mp4-mobile'].url;
          else {
            for (const k of Object.keys(json.files)) {
              if (json.files[k] && json.files[k].url && (json.files[k].url.includes('.mp4') || k.includes('mp4'))) {
                mp4DirectUrl = json.files[k].url;
                break;
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn(`[StreamableEngine] Error fetching api for ${streamableId}:`, e.message);
    }

    if (!mp4DirectUrl) {
      mp4DirectUrl = `https://cdn-cf-west.streamable.com/video/mp4/${streamableId}.mp4`;
    }
    if (mp4DirectUrl.startsWith('//')) {
      mp4DirectUrl = 'https:' + mp4DirectUrl;
    }

    console.log(`[StreamableEngine] Downloading direct MP4 for ${streamableId}...`);
    const rawFilePath = path.join(VIDEO_CACHE_DIR, `temp_streamable_${streamableId}_raw.mp4`);

    await new Promise((resolve, reject) => {
      const curl = spawn('curl', ['-s', '-L', '-A', 'Mozilla/5.0', mp4DirectUrl, '-o', rawFilePath]);
      curl.on('close', (code) => {
        if (code === 0 && fs.existsSync(rawFilePath) && fs.statSync(rawFilePath).size > 1000) {
          resolve();
        } else {
          reject(new Error(`Failed to download Streamable video ${streamableId}`));
        }
      });
      curl.on('error', reject);
    });

    // Run ffmpeg faststart + AAC stereo ensuring immediate frame render and clean audio
    console.log(`[StreamableEngine] Optimizing streamable_${streamableId} with faststart & AAC audio...`);
    await new Promise((resolve) => {
      const ff = spawn('ffmpeg', [
        '-y',
        '-i', rawFilePath,
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-ar', '44100',
        '-movflags', '+faststart',
        targetFilePath
      ]);
      ff.on('close', () => {
        try { fs.unlinkSync(rawFilePath); } catch (e) {}
        resolve();
      });
      ff.on('error', () => {
        try { fs.renameSync(rawFilePath, targetFilePath); } catch (e) {}
        resolve();
      });
    });

    console.log(`[StreamableEngine] Successfully cached Streamable video: ${targetFilePath} (${fs.statSync(targetFilePath).size} bytes)`);
    io.emit('video-ready', { fileId: streamableId, url: `/api/streamable-video/${streamableId}` });
    return targetFilePath;
  })().finally(() => {
    activeTranscodes.delete(cacheKey);
  });

  activeTranscodes.set(cacheKey, promise);
  return promise;
}

async function ensureH264Video(fileId) {
  if (!fileId) throw new Error('Missing fileId');
  const targetFilePath = path.join(VIDEO_CACHE_DIR, `${fileId}.mp4`);
  if (fs.existsSync(targetFilePath) && fs.statSync(targetFilePath).size > 10000) {
    return targetFilePath;
  }

  if (activeTranscodes.has(fileId)) {
    return activeTranscodes.get(fileId);
  }

  const promise = (async () => {
    const rawFilePath = path.join(VIDEO_CACHE_DIR, `temp_${fileId}_raw.mp4`);
    const driveUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;

    console.log(`[VideoEngine] Downloading Google Drive file: ${fileId}...`);
    // 1. Download raw file using curl
    await new Promise((resolve, reject) => {
      const curl = spawn('curl', ['-s', '-L', driveUrl, '-o', rawFilePath]);
      curl.on('close', (code) => {
        if (code === 0 && fs.existsSync(rawFilePath) && fs.statSync(rawFilePath).size > 1000) {
          resolve();
        } else {
          // Fallback to second url pattern
          const backupUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
          const curl2 = spawn('curl', ['-s', '-L', backupUrl, '-o', rawFilePath]);
          curl2.on('close', (code2) => {
            if (code2 === 0 && fs.existsSync(rawFilePath) && fs.statSync(rawFilePath).size > 1000) {
              resolve();
            } else {
              reject(new Error(`Failed to download Drive file ${fileId}`));
            }
          });
          curl2.on('error', reject);
        }
      });
      curl.on('error', reject);
    });

    // 2. Check codec using ffprobe
    const isH264 = await new Promise((resolve) => {
      const ffprobe = spawn('ffprobe', [
        '-v', 'error',
        '-show_entries', 'stream=codec_name,codec_type',
        '-of', 'default=noprint_wrappers=1',
        rawFilePath
      ]);
      let output = '';
      ffprobe.stdout.on('data', (d) => { output += d.toString(); });
      ffprobe.on('close', () => {
        resolve(output.includes('codec_name=h264') || output.includes('codec_name=avc1'));
      });
      ffprobe.on('error', () => resolve(false));
    });

    if (isH264) {
      console.log(`[VideoEngine] File ${fileId} is already H.264. Ensuring standard AAC audio & faststart...`);
      await new Promise((resolve) => {
        const ff = spawn('ffmpeg', ['-y', '-i', rawFilePath, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-movflags', '+faststart', targetFilePath]);
        ff.on('close', () => {
          try { fs.unlinkSync(rawFilePath); } catch (e) {}
          resolve();
        });
        ff.on('error', () => {
          try { fs.renameSync(rawFilePath, targetFilePath); } catch (e) {}
          resolve();
        });
      });
    } else {
      console.log(`[VideoEngine] Transcoding ${fileId} (HEVC/H.265) to web-standard H.264 + AAC stereo with ultrafast preset...`);
      await new Promise((resolve, reject) => {
        const ff = spawn('ffmpeg', [
          '-y',
          '-i', rawFilePath,
          '-c:v', 'libx264',
          '-preset', 'ultrafast',
          '-crf', '23',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-b:a', '192k',
          '-ar', '44100',
          '-movflags', '+faststart',
          targetFilePath
        ]);
        ff.on('close', (code) => {
          try { fs.unlinkSync(rawFilePath); } catch (e) {}
          if (code === 0) resolve();
          else reject(new Error('FFmpeg conversion failed with code ' + code));
        });
        ff.on('error', reject);
      });
    }

    console.log(`[VideoEngine] Successfully prepared H.264 video: ${targetFilePath} (${fs.statSync(targetFilePath).size} bytes)`);
    // Broadcast to all connected sockets that this video is ready
    io.emit('video-ready', { fileId, url: `/api/drive-video/${fileId}` });
    return targetFilePath;
  })().finally(() => {
    activeTranscodes.delete(fileId);
  });

  activeTranscodes.set(fileId, promise);
  return promise;
}

// Background prewarm helper for Streamable and Google Drive
function prewarmVideos(urls = []) {
  for (const url of urls) {
    const streamableId = extractStreamableId(url);
    if (streamableId) {
      ensureStreamableVideo(streamableId).catch(err => {
        console.warn(`[StreamableEngine] Pre-warm failed for ${streamableId}:`, err.message);
      });
      continue;
    }
    const fileId = extractDriveFileId(url);
    if (fileId) {
      ensureH264Video(fileId).catch(err => {
        console.warn(`[VideoEngine] Pre-warm failed for ${fileId}:`, err.message);
      });
    }
  }
}

// Start prewarming initial demo videos immediately
prewarmVideos([DEFAULT_DEMO.video1Url, DEFAULT_DEMO.video2Url, DEFAULT_DEMO.video3Url]);

// Streamable Video Stream Route
app.get('/api/streamable-video/:streamableId', async (req, res) => {
  const streamableId = req.params.streamableId;
  if (!streamableId) return res.status(400).send('Streamable ID is required');

  try {
    const targetFilePath = await ensureStreamableVideo(streamableId);
    streamLocalFile(targetFilePath, req, res);
  } catch (err) {
    console.error('Streamable video stream error:', err);
    try {
      const apiUrl = `https://api.streamable.com/videos/${streamableId}`;
      const resp = await fetch(apiUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const json = await resp.json();
      const mp4 = json?.files?.mp4?.url || json?.files?.['mp4-mobile']?.url;
      if (mp4) {
        return res.redirect(mp4.startsWith('//') ? 'https:' + mp4 : mp4);
      }
    } catch (e) {}
    res.status(500).send('Unable to stream video from Streamable');
  }
});

// Google Drive Stream Proxy Route (with guaranteed H.264 support)
app.get('/api/drive-video/:fileId', async (req, res) => {
  const fileId = req.params.fileId;
  if (!fileId) return res.status(400).send('File ID is required');

  try {
    const targetFilePath = await ensureH264Video(fileId);
    streamLocalFile(targetFilePath, req, res);
  } catch (err) {
    console.error('Drive video error:', err);
    // Fallback: proxy raw stream if transcoding failed
    const driveUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
    proxyVideoStream(driveUrl, req, res, 'video/mp4');
  }
});

// Video preparation status API
app.get('/api/video-status/:fileId', (req, res) => {
  const fileId = req.params.fileId;
  const streamablePath = path.join(VIDEO_CACHE_DIR, `streamable_${fileId}.mp4`);
  const drivePath = path.join(VIDEO_CACHE_DIR, `${fileId}.mp4`);
  
  const isStreamableReady = fs.existsSync(streamablePath) && fs.statSync(streamablePath).size > 5000;
  const isDriveReady = fs.existsSync(drivePath) && fs.statSync(drivePath).size > 10000;
  const isReady = isStreamableReady || isDriveReady;
  const isProcessing = activeTranscodes.has(fileId) || activeTranscodes.has(`streamable_${fileId}`);
  
  res.json({
    fileId,
    ready: isReady,
    processing: isProcessing,
    size: isStreamableReady ? fs.statSync(streamablePath).size : (isDriveReady ? fs.statSync(drivePath).size : 0)
  });
});

// Proxy for other external videos with Range & CORS support
function proxyVideoStream(targetUrl, req, res, fallbackContentType = 'video/mp4', redirectCount = 0) {
  if (redirectCount > 5) {
    return res.status(508).send('Too many redirects');
  }

  try {
    const parsedUrl = new URL(targetUrl);
    const clientModule = parsedUrl.protocol === 'http:' ? http : https;

    const requestHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': '*/*'
    };

    if (req.headers.range) {
      requestHeaders['Range'] = req.headers.range;
    }

    const upstreamReq = clientModule.get(targetUrl, { headers: requestHeaders }, (upstreamRes) => {
      if ([301, 302, 303, 307, 308].includes(upstreamRes.statusCode) && upstreamRes.headers.location) {
        upstreamRes.resume();
        const nextUrl = new URL(upstreamRes.headers.location, targetUrl).href;
        return proxyVideoStream(nextUrl, req, res, fallbackContentType, redirectCount + 1);
      }

      const statusCode = upstreamRes.statusCode || 200;
      let contentType = upstreamRes.headers['content-type'] || fallbackContentType;
      if (contentType.includes('text/html') || contentType.includes('application/json')) {
        contentType = fallbackContentType;
      }

      const responseHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Accept, Content-Type, Origin',
        'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
        'Accept-Ranges': 'bytes',
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400'
      };

      if (upstreamRes.headers['content-range']) {
        responseHeaders['Content-Range'] = upstreamRes.headers['content-range'];
      }
      if (upstreamRes.headers['content-length']) {
        responseHeaders['Content-Length'] = upstreamRes.headers['content-length'];
      }

      res.writeHead(statusCode, responseHeaders);
      upstreamRes.pipe(res);

      upstreamRes.on('error', () => {
        if (!res.headersSent) res.status(500).send('Streaming error');
      });
    });

    upstreamReq.on('error', () => {
      if (!res.headersSent) res.status(502).send('Video stream gateway error');
    });

    req.on('close', () => {
      upstreamReq.destroy();
    });
  } catch (err) {
    if (!res.headersSent) res.status(400).send('Invalid video URL');
  }
}

app.get('/api/proxy-video', (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('URL query parameter is required');
  proxyVideoStream(String(targetUrl), req, res, 'video/mp4');
});

// REST API Endpoints
app.post('/api/create-room', (req, res) => {
  let roomId = req.body.roomId ? String(req.body.roomId).trim() : generateRandom6Digit();
  if (roomId.length !== 6 || isNaN(Number(roomId))) {
    roomId = generateRandom6Digit();
  }

  const p1 = req.body.player1Pass ? String(req.body.player1Pass).trim() : generateRandomPassword();
  const p2 = req.body.player2Pass ? String(req.body.player2Pass).trim() : generateRandomPassword();
  const p3 = req.body.player3Pass ? String(req.body.player3Pass).trim() : generateRandomPassword();

  const room = getOrCreateRoom(roomId);
  room.passwords = {
    player1: p1,
    player2: p2,
    player3: p3
  };

  if (req.body.topic1) room.topic1 = req.body.topic1;
  if (req.body.topic2) room.topic2 = req.body.topic2;
  if (req.body.topic3) room.topic3 = req.body.topic3;
  if (req.body.video1Url) room.video1Url = req.body.video1Url;
  if (req.body.video2Url) room.video2Url = req.body.video2Url;
  if (req.body.video3Url) room.video3Url = req.body.video3Url;

  res.json({
    success: true,
    roomId,
    passwords: room.passwords,
    room
  });
});

app.get('/api/room/:roomId', (req, res) => {
  const roomId = req.params.roomId;
  if (!rooms.has(roomId)) {
    return res.status(404).json({ success: false, message: 'Phòng không tồn tại!' });
  }
  const room = rooms.get(roomId);
  res.json({
    success: true,
    roomId: room.roomId,
    topic1: room.topic1,
    topic2: room.topic2,
    topic3: room.topic3,
    topic1Visible: room.topic1Visible,
    topic2Visible: room.topic2Visible,
    topic3Visible: room.topic3Visible,
    video1Url: room.video1Url,
    video2Url: room.video2Url,
    video3Url: room.video3Url,
    videoState: room.videoState,
    timer60s: room.timer60s,
    connected: room.connected
  });
});

app.post('/api/login', (req, res) => {
  const { roomId, player, password } = req.body;
  if (!roomId || !player || !password) {
    return res.status(400).json({ success: false, message: 'Vui lòng nhập đầy đủ thông tin!' });
  }

  const room = rooms.get(String(roomId).trim());
  if (!room) {
    return res.status(404).json({ success: false, message: 'Mã phòng không tồn tại!' });
  }

  const expectedPass = room.passwords[player];
  if (expectedPass && expectedPass === String(password).trim()) {
    const fileMap = {
      player1: 'Player1.html',
      player2: 'Player2.html',
      player3: 'Player3.html'
    };
    const targetFile = fileMap[player] || 'Player1.html';
    return res.json({
      success: true,
      message: 'Đăng nhập thành công!',
      roomId: room.roomId,
      player,
      targetUrl: `/${targetFile}?roomid=${room.roomId}&auth=${encodeURIComponent(password)}`
    });
  }

  return res.status(401).json({ success: false, message: 'Mật khẩu người chơi không đúng!' });
});

// HTML route handlers
app.get(['/', '/index.html', '/Index.html', '/index', '/Index'], (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get(['/Controller.html', '/controller.html', '/Controller', '/controller'], (req, res) => {
  res.sendFile(path.join(__dirname, 'Controller.html'));
});

app.get(['/Player1.html', '/player1.html', '/Player1', '/player1'], (req, res) => {
  res.sendFile(path.join(__dirname, 'Player1.html'));
});

app.get(['/Player2.html', '/player2.html', '/Player2', '/player2'], (req, res) => {
  res.sendFile(path.join(__dirname, 'Player2.html'));
});

app.get(['/Player3.html', '/player3.html', '/Player3', '/player3'], (req, res) => {
  res.sendFile(path.join(__dirname, 'Player3.html'));
});

app.get(['/Viewer.html', '/viewer.html', '/Viewer', '/viewer'], (req, res) => {
  res.sendFile(path.join(__dirname, 'Viewer.html'));
});

// Serve static assets from root directory
app.use(express.static(__dirname));

// -------------------------------------------------------------
// AUTHORITATIVE TIME CLOCK & SOCKET.IO REAL-TIME SYNC
// Prevents tab-switch throttling from desyncing timers or videos
// -------------------------------------------------------------

// Periodic Authoritative Heartbeat Broadcaster (every 500ms)
setInterval(() => {
  const now = Date.now();
  rooms.forEach((room, rId) => {
    if (room.timer60s.isRunning || room.videoState.isPlaying) {
      const elapsed = Math.max(0, (now - (room.videoState.startedAt || now)) / 1000);
      const currentSeconds = Math.min(60, (room.videoState.startPosition || 0) + elapsed);
      const secondsRemaining = Math.max(0, Math.ceil((room.timer60s.startRemaining || 60) - elapsed));

      room.videoState.currentSeconds = currentSeconds;
      room.timer60s.secondsRemaining = secondsRemaining;

      if (secondsRemaining <= 0 || currentSeconds >= 60) {
        // Auto finish at 60s
        room.videoState.isPlaying = false;
        room.videoState.startedAt = null;
        room.videoState.currentSeconds = 60;
        room.timer60s.isRunning = false;
        room.timer60s.startedAt = null;
        room.timer60s.secondsRemaining = 0;

        io.to(`room-${rId}`).emit('video-action', {
          action: 'pause',
          currentTime: 60,
          isPlaying: false,
          timestamp: now
        });
        io.to(`room-${rId}`).emit('timer-action', {
          action: 'finish',
          secondsRemaining: 0,
          isRunning: false,
          timestamp: now
        });
      }

      io.to(`room-${rId}`).emit('time-sync', {
        serverTime: now,
        isPlaying: room.videoState.isPlaying,
        currentSeconds: room.videoState.currentSeconds,
        isTimerRunning: room.timer60s.isRunning,
        secondsRemaining: room.timer60s.secondsRemaining,
        startedAt: room.videoState.startedAt,
        startPosition: room.videoState.startPosition,
        startRemaining: room.timer60s.startRemaining
      });
    }
  });
}, 500);

io.on('connection', (socket) => {
  let currentRoomId = null;
  let currentRole = null;

  socket.on('join-room', (data) => {
    const { roomId, role } = data || {};
    if (!roomId) return;

    currentRoomId = String(roomId).trim();
    currentRole = role; // 'controller', 'player1', 'player2', 'player3', 'viewer'

    const room = getOrCreateRoom(currentRoomId);
    socket.join(`room-${currentRoomId}`);

    if (currentRole === 'controller') room.connected.controller = true;
    else if (currentRole === 'player1') room.connected.player1 = true;
    else if (currentRole === 'player2') room.connected.player2 = true;
    else if (currentRole === 'player3') room.connected.player3 = true;
    else if (currentRole === 'viewer') room.connected.viewers += 1;

    // Send full current state to newly joined client
    socket.emit('room-state', {
      roomId: room.roomId,
      serverTime: Date.now(),
      passwords: currentRole === 'controller' ? room.passwords : undefined,
      topic1: room.topic1,
      topic2: room.topic2,
      topic3: room.topic3,
      topic1Visible: room.topic1Visible,
      topic2Visible: room.topic2Visible,
      topic3Visible: room.topic3Visible,
      video1Url: room.video1Url,
      video2Url: room.video2Url,
      video3Url: room.video3Url,
      themeAudioUrl: room.themeAudioUrl,
      audio5sUrl: room.audio5sUrl,
      audio3sUrl: room.audio3sUrl,
      clipBedAudioUrl: room.clipBedAudioUrl,
      videoState: room.videoState,
      timer60s: room.timer60s,
      activeAudio: room.activeAudio,
      connected: room.connected
    });

    // Notify others in room about presence
    io.to(`room-${currentRoomId}`).emit('presence-update', room.connected);
  });

  // Controller updates topics and video links
  socket.on('controller:update-links', (data) => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;
    const room = rooms.get(currentRoomId);

    if (data.topic1 !== undefined) room.topic1 = data.topic1;
    if (data.topic2 !== undefined) room.topic2 = data.topic2;
    if (data.topic3 !== undefined) room.topic3 = data.topic3;
    if (data.video1Url !== undefined) room.video1Url = data.video1Url;
    if (data.video2Url !== undefined) room.video2Url = data.video2Url;
    if (data.video3Url !== undefined) room.video3Url = data.video3Url;

    // Trigger pre-warming for newly updated video links immediately
    prewarmVideos([room.video1Url, room.video2Url, room.video3Url]);

    io.to(`room-${currentRoomId}`).emit('links-updated', {
      topic1: room.topic1,
      topic2: room.topic2,
      topic3: room.topic3,
      video1Url: room.video1Url,
      video2Url: room.video2Url,
      video3Url: room.video3Url
    });
  });

  // Controller toggles topic visibility
  socket.on('controller:show-topic', (data) => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;
    const room = rooms.get(currentRoomId);
    const { topicIndex, visible } = data; // 1, 2, 3

    if (topicIndex === 1) room.topic1Visible = visible !== undefined ? visible : true;
    if (topicIndex === 2) room.topic2Visible = visible !== undefined ? visible : true;
    if (topicIndex === 3) room.topic3Visible = visible !== undefined ? visible : true;

    io.to(`room-${currentRoomId}`).emit('topic-visibility-updated', {
      topicIndex,
      visible: topicIndex === 1 ? room.topic1Visible : topicIndex === 2 ? room.topic2Visible : room.topic3Visible,
      topic1Visible: room.topic1Visible,
      topic2Visible: room.topic2Visible,
      topic3Visible: room.topic3Visible,
      topic1: room.topic1,
      topic2: room.topic2,
      topic3: room.topic3
    });
  });

  // Controller plays theme audio (The Master Of Minds - Category.mp3)
  socket.on('controller:play-theme-audio', () => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;
    const room = rooms.get(currentRoomId);
    room.activeAudio = { type: 'theme', isPlaying: true, timestamp: Date.now() };

    io.to(`room-${currentRoomId}`).emit('audio-action', {
      action: 'play',
      type: 'theme',
      timestamp: Date.now()
    });
  });

  // Controller plays 5-second audio (The Master Of Minds - 5s CountDown.mp3)
  socket.on('controller:play-5s-audio', () => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;
    const room = rooms.get(currentRoomId);
    room.activeAudio = { type: '5s', isPlaying: true, timestamp: Date.now() };

    io.to(`room-${currentRoomId}`).emit('audio-action', {
      action: 'play',
      type: '5s',
      timestamp: Date.now()
    });
  });

  // Controller plays 3-second audio (3s.mp3)
  socket.on('controller:play-3s-audio', () => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;
    const room = rooms.get(currentRoomId);
    room.activeAudio = { type: '3s', isPlaying: true, timestamp: Date.now() };

    io.to(`room-${currentRoomId}`).emit('audio-action', {
      action: 'play',
      type: '3s',
      timestamp: Date.now()
    });
  });

  // Controller stops all audio
  socket.on('controller:stop-audio', () => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;
    const room = rooms.get(currentRoomId);
    room.activeAudio = { type: null, isPlaying: false, timestamp: Date.now() };

    io.to(`room-${currentRoomId}`).emit('audio-action', {
      action: 'stop',
      timestamp: Date.now()
    });
  });

  // Controller plays videos (synchronized play for all 3 videos + 60s countdown timer + clip bed music)
  socket.on('controller:play-videos', (data) => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;
    const room = rooms.get(currentRoomId);
    const now = Date.now();
    const currentTime = typeof data?.currentTime === 'number' ? data.currentTime : room.videoState.currentSeconds;

    room.videoState = {
      isPlaying: true,
      startedAt: now,
      startPosition: currentTime,
      currentSeconds: currentTime,
      updatedAt: now
    };

    if (room.timer60s.secondsRemaining <= 0) {
      room.timer60s.secondsRemaining = 60;
    }

    room.timer60s.isRunning = true;
    room.timer60s.startedAt = now;
    room.timer60s.startRemaining = room.timer60s.secondsRemaining;

    io.to(`room-${currentRoomId}`).emit('video-action', {
      action: 'play',
      currentTime: currentTime,
      startedAt: now,
      startPosition: currentTime,
      isPlaying: true,
      serverTime: now,
      timestamp: now
    });
    io.to(`room-${currentRoomId}`).emit('timer-action', {
      action: 'start',
      secondsRemaining: room.timer60s.secondsRemaining,
      startRemaining: room.timer60s.startRemaining,
      startedAt: now,
      isRunning: true,
      serverTime: now,
      timestamp: now
    });
  });

  // Controller pauses videos + pauses timer + pauses clip bed music
  socket.on('controller:pause-videos', (data) => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;
    const room = rooms.get(currentRoomId);
    const now = Date.now();

    if (room.videoState.startedAt) {
      const elapsed = (now - room.videoState.startedAt) / 1000;
      room.videoState.currentSeconds = Math.min(60, (room.videoState.startPosition || 0) + elapsed);
      room.timer60s.secondsRemaining = Math.max(0, Math.ceil((room.timer60s.startRemaining || 60) - elapsed));
    }

    if (typeof data?.currentTime === 'number') {
      room.videoState.currentSeconds = data.currentTime;
    }

    room.videoState.isPlaying = false;
    room.videoState.startedAt = null;
    room.videoState.startPosition = room.videoState.currentSeconds;
    room.videoState.updatedAt = now;

    room.timer60s.isRunning = false;
    room.timer60s.startedAt = null;
    room.timer60s.startRemaining = room.timer60s.secondsRemaining;

    io.to(`room-${currentRoomId}`).emit('video-action', {
      action: 'pause',
      currentTime: room.videoState.currentSeconds,
      isPlaying: false,
      serverTime: now,
      timestamp: now
    });
    io.to(`room-${currentRoomId}`).emit('timer-action', {
      action: 'pause',
      secondsRemaining: room.timer60s.secondsRemaining,
      isRunning: false,
      serverTime: now,
      timestamp: now
    });
  });

  // Controller seeks / resets videos
  socket.on('controller:seek-videos', (data) => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;
    const room = rooms.get(currentRoomId);
    const now = Date.now();
    const currentTime = typeof data?.currentTime === 'number' ? data.currentTime : 0;

    room.videoState = {
      isPlaying: false,
      startedAt: null,
      startPosition: currentTime,
      currentSeconds: currentTime,
      updatedAt: now
    };
    room.timer60s = {
      isRunning: false,
      startedAt: null,
      startRemaining: 60,
      secondsRemaining: 60
    };

    io.to(`room-${currentRoomId}`).emit('video-action', {
      action: 'seek',
      currentTime: currentTime,
      isPlaying: false,
      serverTime: now,
      timestamp: now
    });
    io.to(`room-${currentRoomId}`).emit('timer-action', {
      action: 'reset',
      secondsRemaining: 60,
      isRunning: false,
      serverTime: now,
      timestamp: now
    });
  });

  // Controller 60s timer actions
  socket.on('controller:timer-action', (data) => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;
    const room = rooms.get(currentRoomId);
    const now = Date.now();
    const action = data?.action; // 'start', 'pause', 'reset'

    if (action === 'start') {
      room.timer60s.isRunning = true;
      room.timer60s.startedAt = now;
      room.timer60s.startRemaining = typeof data?.seconds === 'number' ? data.seconds : (room.timer60s.secondsRemaining || 60);
      room.timer60s.secondsRemaining = room.timer60s.startRemaining;

      room.videoState.isPlaying = true;
      room.videoState.startedAt = now;
      room.videoState.startPosition = room.videoState.currentSeconds;
    } else if (action === 'pause') {
      if (room.timer60s.startedAt) {
        const elapsed = (now - room.timer60s.startedAt) / 1000;
        room.timer60s.secondsRemaining = Math.max(0, Math.ceil(room.timer60s.startRemaining - elapsed));
        room.videoState.currentSeconds = Math.min(60, room.videoState.startPosition + elapsed);
      }
      room.timer60s.isRunning = false;
      room.timer60s.startedAt = null;
      room.videoState.isPlaying = false;
      room.videoState.startedAt = null;
    } else if (action === 'reset') {
      room.timer60s = { isRunning: false, startedAt: null, startRemaining: 60, secondsRemaining: 60 };
      room.videoState = { isPlaying: false, startedAt: null, startPosition: 0, currentSeconds: 0, updatedAt: now };
    }

    io.to(`room-${currentRoomId}`).emit('timer-action', {
      action,
      secondsRemaining: room.timer60s.secondsRemaining,
      isRunning: room.timer60s.isRunning,
      startedAt: room.timer60s.startedAt,
      startRemaining: room.timer60s.startRemaining,
      serverTime: now,
      timestamp: now
    });
  });

  // Client requests resync
  socket.on('request-sync', () => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;
    const room = rooms.get(currentRoomId);
    socket.emit('room-state', {
      roomId: room.roomId,
      serverTime: Date.now(),
      passwords: currentRole === 'controller' ? room.passwords : undefined,
      topic1: room.topic1,
      topic2: room.topic2,
      topic3: room.topic3,
      topic1Visible: room.topic1Visible,
      topic2Visible: room.topic2Visible,
      topic3Visible: room.topic3Visible,
      video1Url: room.video1Url,
      video2Url: room.video2Url,
      video3Url: room.video3Url,
      themeAudioUrl: room.themeAudioUrl,
      audio5sUrl: room.audio5sUrl,
      audio3sUrl: room.audio3sUrl,
      clipBedAudioUrl: room.clipBedAudioUrl,
      videoState: room.videoState,
      timer60s: room.timer60s,
      activeAudio: room.activeAudio,
      connected: room.connected
    });
  });

  // Disconnect handler
  socket.on('disconnect', () => {
    if (currentRoomId && rooms.has(currentRoomId)) {
      const room = rooms.get(currentRoomId);
      if (currentRole === 'controller') room.connected.controller = false;
      else if (currentRole === 'player1') room.connected.player1 = false;
      else if (currentRole === 'player2') room.connected.player2 = false;
      else if (currentRole === 'player3') room.connected.player3 = false;
      else if (currentRole === 'viewer') {
        room.connected.viewers = Math.max(0, room.connected.viewers - 1);
      }
      io.to(`room-${currentRoomId}`).emit('presence-update', room.connected);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`===========================================`);
  console.log(`🚀 Game Show Sync Server is running!`);
  console.log(`🌐 Local & Cloud URL: http://0.0.0.0:${PORT}`);
  console.log(`🎮 Demo Room created with code: ${DEMO_ROOM_ID}`);
  console.log(`   - Player 1 Pass: ${demoRoom.passwords.player1}`);
  console.log(`   - Player 2 Pass: ${demoRoom.passwords.player2}`);
  console.log(`   - Player 3 Pass: ${demoRoom.passwords.player3}`);
  console.log(`===========================================`);
});
