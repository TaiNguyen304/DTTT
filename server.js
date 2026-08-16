import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import cors from 'cors';
import { fileURLToPath } from 'url';

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

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Default demo topics and video links
const DEFAULT_DEMO = {
  topic1: 'Chủ đề 1',
  video1Url: 'https://drive.google.com/file/d/1ptLK4YNaz0bS7L-AfXQVo4GIH1JvEHkd/view?usp=drive_link',
  topic2: 'Chủ đề 2',
  video2Url: 'https://drive.google.com/file/d/1ZAijZ5ePiNtGDdNH2cKjB2DKCFvHSzqE/view?usp=drive_link',
  topic3: 'Chủ đề 3',
  video3Url: 'https://drive.google.com/file/d/1j8sJh424Q6P5z5NG4eUYfeaC6-VwH1JW/view?usp=drive_link',
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
        currentTime: 0,
        updatedAt: Date.now()
      },
      timer60s: {
        isRunning: false,
        secondsRemaining: 60,
        startedAt: null
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

// Google Drive Stream Proxy Route
app.get('/api/drive-video/:fileId', (req, res) => {
  const fileId = req.params.fileId;
  if (!fileId) return res.status(400).send('File ID is required');

  // Direct Google Drive download stream link
  const driveUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
  res.redirect(driveUrl);
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
    return res.status(400).json({ success: false, message: 'Vui lòng điền đầy đủ Mã phòng, Tên người chơi và Mật khẩu!' });
  }

  const room = rooms.get(String(roomId).trim());
  if (!room) {
    return res.status(404).json({ success: false, message: 'Mã phòng không tồn tại hoặc đã hết hạn!' });
  }

  const normalizedPlayer = String(player).toLowerCase().replace(/\s+/g, '');
  let expectedPassword = '';
  let targetFile = '';

  if (normalizedPlayer === 'player1' || normalizedPlayer === '1') {
    expectedPassword = room.passwords.player1;
    targetFile = 'Player1.html';
  } else if (normalizedPlayer === 'player2' || normalizedPlayer === '2') {
    expectedPassword = room.passwords.player2;
    targetFile = 'Player2.html';
  } else if (normalizedPlayer === 'player3' || normalizedPlayer === '3') {
    expectedPassword = room.passwords.player3;
    targetFile = 'Player3.html';
  } else {
    return res.status(400).json({ success: false, message: 'Người chơi không hợp lệ (chọn Player 1, Player 2 hoặc Player 3)!' });
  }

  if (String(password).trim() !== String(expectedPassword).trim()) {
    return res.status(401).json({ success: false, message: 'Mật khẩu người chơi không chính xác!' });
  }

  res.json({
    success: true,
    message: 'Đăng nhập thành công!',
    roomId: room.roomId,
    player: normalizedPlayer,
    targetUrl: `/${targetFile}?roomid=${room.roomId}`
  });
});

// Serve direct HTML files (supporting both uppercase and lowercase aliases)
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

// Socket.IO real-time synchronization
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

  // Controller plays videos (synchronous play for all 3 videos + 60s timer + clip bed music)
  socket.on('controller:play-videos', (data) => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;
    const room = rooms.get(currentRoomId);
    const currentTime = typeof data?.currentTime === 'number' ? data.currentTime : room.videoState.currentTime;

    room.videoState = {
      isPlaying: true,
      currentTime: currentTime,
      updatedAt: Date.now()
    };
    room.timer60s.isRunning = true;
    room.timer60s.startedAt = Date.now();

    io.to(`room-${currentRoomId}`).emit('video-action', {
      action: 'play',
      currentTime: currentTime,
      timestamp: Date.now()
    });
    io.to(`room-${currentRoomId}`).emit('timer-action', {
      action: 'start',
      secondsRemaining: room.timer60s.secondsRemaining,
      isRunning: true,
      timestamp: Date.now()
    });
  });

  // Controller pauses videos + pauses timer + pauses clip bed music
  socket.on('controller:pause-videos', (data) => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;
    const room = rooms.get(currentRoomId);
    const currentTime = typeof data?.currentTime === 'number' ? data.currentTime : room.videoState.currentTime;

    room.videoState = {
      isPlaying: false,
      currentTime: currentTime,
      updatedAt: Date.now()
    };
    room.timer60s.isRunning = false;

    io.to(`room-${currentRoomId}`).emit('video-action', {
      action: 'pause',
      currentTime: currentTime,
      timestamp: Date.now()
    });
    io.to(`room-${currentRoomId}`).emit('timer-action', {
      action: 'pause',
      secondsRemaining: room.timer60s.secondsRemaining,
      isRunning: false,
      timestamp: Date.now()
    });
  });

  // Controller seeks / resets videos
  socket.on('controller:seek-videos', (data) => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;
    const room = rooms.get(currentRoomId);
    const currentTime = typeof data?.currentTime === 'number' ? data.currentTime : 0;

    room.videoState.currentTime = currentTime;
    room.videoState.isPlaying = false;
    room.videoState.updatedAt = Date.now();
    room.timer60s.isRunning = false;
    room.timer60s.secondsRemaining = 60;

    io.to(`room-${currentRoomId}`).emit('video-action', {
      action: 'seek',
      currentTime: currentTime,
      timestamp: Date.now()
    });
    io.to(`room-${currentRoomId}`).emit('timer-action', {
      action: 'reset',
      secondsRemaining: 60,
      isRunning: false,
      timestamp: Date.now()
    });
  });

  // Controller 60s timer actions
  socket.on('controller:timer-action', (data) => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;
    const room = rooms.get(currentRoomId);
    const action = data?.action; // 'start', 'pause', 'reset'

    if (action === 'start') {
      room.timer60s.isRunning = true;
      room.timer60s.secondsRemaining = typeof data?.seconds === 'number' ? data.seconds : 60;
      room.timer60s.startedAt = Date.now();
      room.videoState.isPlaying = true;
    } else if (action === 'pause') {
      room.timer60s.isRunning = false;
      if (typeof data?.seconds === 'number') {
        room.timer60s.secondsRemaining = data.seconds;
      }
      room.videoState.isPlaying = false;
    } else if (action === 'reset') {
      room.timer60s.isRunning = false;
      room.timer60s.secondsRemaining = 60;
      room.timer60s.startedAt = null;
      room.videoState.isPlaying = false;
      room.videoState.currentTime = 0;
    }

    io.to(`room-${currentRoomId}`).emit('timer-action', {
      action,
      secondsRemaining: room.timer60s.secondsRemaining,
      isRunning: room.timer60s.isRunning,
      timestamp: Date.now()
    });
  });

  // Client requests resync
  socket.on('request-sync', () => {
    if (!currentRoomId || !rooms.has(currentRoomId)) return;
    const room = rooms.get(currentRoomId);
    socket.emit('room-state', {
      roomId: room.roomId,
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
