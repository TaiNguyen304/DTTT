/**
 * Game Show Real-time Audio & Video Synchronization Engine
 * Includes Anti-DevTools Protection, High-Precision Universal Time Sync & Web Audio Synthesizer
 */

// 1. DISABLE DEVTOOLS ON ALL PAGES
(function disableDevToolsGlobal() {
  document.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    return false;
  }, { capture: true });

  window.addEventListener('keydown', function (e) {
    if (e.key === 'F12' || e.keyCode === 123) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (
      e.key === 'I' || e.key === 'i' || e.keyCode === 73 ||
      e.key === 'J' || e.key === 'j' || e.keyCode === 74 ||
      e.key === 'C' || e.key === 'c' || e.keyCode === 67
    )) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'u' || e.key === 'U' || e.keyCode === 85)) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S' || e.keyCode === 83)) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
  }, { capture: true });
})();

// Helper to convert Streamable / Google Drive / MP4 links to streaming direct URL
function formatVideoUrl(url) {
  if (!url) return '';
  url = String(url).trim().replace(/^['"`]|['"`]$/g, '');
  
  if (url.startsWith('/api/streamable-video/') || url.startsWith('/api/drive-video/')) {
    return url;
  }

  // 1. Handle Streamable links: https://streamable.com/{id}, streamable.com/e/{id}, streamable.com/{id}
  const streamableMatch = url.match(/(?:https?:\/\/)?(?:www\.)?streamable\.com\/(?:(?:e|o|m)\/)?([a-zA-Z0-9]+)/i);
  if (streamableMatch && streamableMatch[1]) {
    return `/api/streamable-video/${streamableMatch[1]}`;
  }

  // 2. Handle Google Drive link variations including /file/d/{id}/view?usp=sharing
  const drivePatterns = [
    /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i,
    /drive\.google\.com\/(?:open|uc)\?(?:[^#]*&)?id=([a-zA-Z0-9_-]+)/i,
    /drive\.usercontent\.google\.com\/(?:download|uc)\?(?:[^#]*&)?id=([a-zA-Z0-9_-]+)/i,
    /lh3\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/i,
    /docs\.google\.com\/(?:file\/d\/|uc\?(?:[^#]*&)?id=)([a-zA-Z0-9_-]+)/i,
    /[?&]id=([a-zA-Z0-9_-]{25,60})/i
  ];

  for (const pattern of drivePatterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return `/api/drive-video/${match[1]}`;
    }
  }

  // Direct Drive File ID (25-60 chars)
  if (/^[a-zA-Z0-9_-]{25,60}$/.test(url)) {
    return `/api/drive-video/${url}`;
  }

  return url;
}

// Safely configure and load a video element without <source> conflicts
function attachVideoSafely(videoEl, rawUrl) {
  if (!videoEl || !rawUrl) return;
  const targetUrl = formatVideoUrl(rawUrl);

  // Clear any existing <source> child tags to prevent browser source resolution conflicts
  while (videoEl.firstChild) {
    videoEl.removeChild(videoEl.firstChild);
  }

  videoEl.playsInline = true;
  videoEl.webkitPlaysInline = true;
  videoEl.preload = 'auto';
  videoEl.disablePictureInPicture = true;
  videoEl.controls = false;

  // GPU compositing hint
  videoEl.style.transform = 'translateZ(0)';
  videoEl.style.backfaceVisibility = 'hidden';

  const normalizedTarget = new URL(targetUrl, window.location.origin).href;
  const currentSrc = videoEl.currentSrc ? new URL(videoEl.currentSrc, window.location.origin).href : '';

  if (currentSrc !== normalizedTarget && videoEl.src !== targetUrl && !videoEl.src.endsWith(targetUrl)) {
    videoEl.src = targetUrl;
    try {
      videoEl.load();
    } catch (e) {}
  }

  // Automatic retry & stall recovery without infinite freeze loops
  if (!videoEl._syncHandlersAttached) {
    videoEl._syncHandlersAttached = true;
    let retryCount = 0;

    videoEl.addEventListener('error', (e) => {
      if (retryCount < 5 && videoEl.src) {
        retryCount++;
        const savedSrc = videoEl.src;
        setTimeout(() => {
          if (videoEl.src === savedSrc) {
            console.log(`[VideoPlayer] Retrying video reload (${retryCount}/5)...`);
            try { videoEl.load(); } catch (err) {}
          }
        }, 1200 * retryCount);
      }
    });

    videoEl.addEventListener('stalled', () => {
      if (videoEl.paused && window.syncClock && window.syncClock.isPlaying) {
        try { videoEl.play().catch(() => {}); } catch (e) {}
      }
    });

    videoEl.addEventListener('waiting', () => {
      // Browser buffering, allow smooth decode catchup
    });

    videoEl.addEventListener('canplay', () => {
      retryCount = 0;
      if (videoEl.paused && videoEl.currentTime < 0.05 && (!window.syncClock || !window.syncClock.isPlaying)) {
        try { videoEl.currentTime = 0.05; } catch (e) {}
      }
    });
  }
}

// Fixed audio filenames
const AUDIO_FILES = {
  CATEGORY: 'The Master Of Minds - Category.mp3',
  COUNTDOWN_5S: 'The Master Of Minds - 5s CountDown.mp3',
  COUNTDOWN_3S: '3s.mp3',
  CLIP_BED: 'The Master Of Minds - Clip bed R2.mp3'
};

// Web Audio API Synthesizer & Audio Player
class SoundFXEngine {
  constructor() {
    this.ctx = null;
    this.currentThemeOscillators = [];
    this.currentCategoryAudio = null;
    this.currentCountdownAudio = null;
    this.clipBedAudio = null;
  }

  isMuted() {
    return window.IS_CONTROLLER === true;
  }

  init() {
    if (this.isMuted()) return;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playTheme() {
    if (this.isMuted()) return;
    this.stopCategoryAndCountdown();
    this.init();

    const audioUrl = '/' + encodeURIComponent(AUDIO_FILES.CATEGORY);
    try {
      this.currentCategoryAudio = new Audio(audioUrl);
      this.currentCategoryAudio.play().catch(() => {
        this.synthesizeThemeMusic();
      });
    } catch (e) {
      this.synthesizeThemeMusic();
    }
  }

  play5Seconds() {
    if (this.isMuted()) return;
    this.stopCategoryAndCountdown();
    this.init();

    const audioUrl = '/' + encodeURIComponent(AUDIO_FILES.COUNTDOWN_5S);
    try {
      this.currentCountdownAudio = new Audio(audioUrl);
      this.currentCountdownAudio.play().catch(() => {
        this.synthesizeCountdown(5);
      });
    } catch (e) {
      this.synthesizeCountdown(5);
    }
  }

  play3Seconds() {
    if (this.isMuted()) return;
    this.stopCategoryAndCountdown();
    this.init();

    const audioUrl = '/' + encodeURIComponent(AUDIO_FILES.COUNTDOWN_3S);
    try {
      this.currentCountdownAudio = new Audio(audioUrl);
      this.currentCountdownAudio.play().catch(() => {
        this.synthesizeCountdown(3);
      });
    } catch (e) {
      this.synthesizeCountdown(3);
    }
  }

  playClipBed(currentTime = 0) {
    if (this.isMuted()) return;
    this.init();

    const audioUrl = '/' + encodeURIComponent(AUDIO_FILES.CLIP_BED);
    if (!this.clipBedAudio) {
      this.clipBedAudio = new Audio(audioUrl);
      this.clipBedAudio.loop = false;
    }

    try {
      if (typeof currentTime === 'number' && !isNaN(currentTime) && currentTime >= 0) {
        if (Math.abs(this.clipBedAudio.currentTime - currentTime) > 0.4) {
          this.clipBedAudio.currentTime = currentTime;
        }
      }
      this.clipBedAudio.play().catch(() => {});
    } catch (e) {}
  }

  pauseClipBed() {
    if (this.clipBedAudio) {
      try {
        this.clipBedAudio.pause();
      } catch (e) {}
    }
  }

  stopClipBed() {
    if (this.clipBedAudio) {
      try {
        this.clipBedAudio.pause();
        this.clipBedAudio.currentTime = 0;
      } catch (e) {}
    }
  }

  stopCategoryAndCountdown() {
    if (this.currentCategoryAudio) {
      try {
        this.currentCategoryAudio.pause();
        this.currentCategoryAudio.currentTime = 0;
      } catch (e) {}
      this.currentCategoryAudio = null;
    }
    if (this.currentCountdownAudio) {
      try {
        this.currentCountdownAudio.pause();
        this.currentCountdownAudio.currentTime = 0;
      } catch (e) {}
      this.currentCountdownAudio = null;
    }
    this.currentThemeOscillators.forEach(osc => {
      try { osc.stop(); } catch (e) {}
    });
    this.currentThemeOscillators = [];
  }

  stopAll() {
    this.stopCategoryAndCountdown();
    this.stopClipBed();
  }

  synthesizeThemeMusic() {
    if (this.isMuted() || !this.ctx) return;
    const now = this.ctx.currentTime;
    
    const chords = [
      [261.63, 329.63, 392.00, 523.25],
      [293.66, 369.99, 440.00, 587.33],
      [329.63, 415.30, 493.88, 659.25],
      [349.23, 440.00, 523.25, 698.46],
      [392.00, 493.88, 587.33, 783.99],
      [523.25, 659.25, 783.99, 1046.50]
    ];

    chords.forEach((chord, chordIdx) => {
      const startTime = now + chordIdx * 0.45;
      chord.forEach((freq, noteIdx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc.type = chordIdx === chords.length - 1 ? 'sawtooth' : 'triangle';
        osc.frequency.setValueAtTime(freq, startTime);
        
        gain.gain.setValueAtTime(0.001, startTime);
        gain.gain.exponentialRampToValueAtTime(0.12 / (noteIdx + 1), startTime + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + (chordIdx === chords.length - 1 ? 1.8 : 0.4));

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(startTime);
        osc.stop(startTime + (chordIdx === chords.length - 1 ? 2.0 : 0.45));
        this.currentThemeOscillators.push(osc);
      });
    });
  }

  synthesizeCountdown(seconds) {
    if (this.isMuted() || !this.ctx) return;
    const now = this.ctx.currentTime;

    for (let i = 0; i < seconds; i++) {
      const isLast = i === seconds - 1;
      const beepTime = now + i * 1.0;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(isLast ? 1046.50 : 587.33, beepTime);

      gain.gain.setValueAtTime(0.001, beepTime);
      gain.gain.exponentialRampToValueAtTime(0.3, beepTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, beepTime + (isLast ? 0.9 : 0.25));

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(beepTime);
      osc.stop(beepTime + (isLast ? 1.0 : 0.3));
      this.currentThemeOscillators.push(osc);
    }
  }
}

// -------------------------------------------------------------
// HIGH-PRECISION UNIVERSAL CLOCK & UNTHROTTLED BACKGROUND ENGINE
// Guarantees continuous video & timer playback across tab switches and shape overlays
// -------------------------------------------------------------

class UniversalSyncClock {
  constructor(options = {}) {
    this.onTick = options.onTick || null;
    this.onFinish = options.onFinish || null;
    this.videoElements = options.videoElements || [];
    this.isMutedVideo = !!options.isMutedVideo;

    this.isPlaying = false;
    this.isTimerRunning = false;
    this.serverTimeOffset = 0; // localTime - serverTime
    this.startedAt = 0;
    this.startPosition = 0; // video seconds
    this.startRemaining = 60; // countdown seconds
    this.currentVideoTime = 0;
    this.currentRemaining = 60;
    this.rafId = null;

    // Per-element last seek timestamps to avoid decoder thrashing
    this.lastSeekMap = new WeakMap();

    this.loop = this.loop.bind(this);
    this.handleVisibility = this.handleVisibility.bind(this);
    this.tick = this.tick.bind(this);

    // 1. Setup unthrottled Web Worker Ticker for background tab execution
    this.initBackgroundWorker();

    document.addEventListener('visibilitychange', this.handleVisibility);
    window.addEventListener('focus', this.handleVisibility);
    window.addEventListener('pageshow', this.handleVisibility);

    // 2. Window fallback interval (100ms)
    setInterval(() => {
      if (this.isPlaying || this.isTimerRunning) {
        this.tick();
      }
    }, 100);
  }

  initBackgroundWorker() {
    this.worker = null;
    try {
      const workerCode = `
        let timer = null;
        self.onmessage = function(e) {
          if (e.data === 'start') {
            if (!timer) {
              timer = setInterval(function() {
                self.postMessage('tick');
              }, 50);
            }
          } else if (e.data === 'stop') {
            if (timer) {
              clearInterval(timer);
              timer = null;
            }
          }
        };
      `;
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      this.worker = new Worker(URL.createObjectURL(blob));
      this.worker.onmessage = (e) => {
        if (e.data === 'tick' && (this.isPlaying || this.isTimerRunning)) {
          this.tick();
        }
      };
    } catch (e) {
      console.warn('[SyncClock] Web Worker ticker disabled, falling back to interval timers:', e);
    }
  }

  startWorker() {
    if (this.worker) {
      try { this.worker.postMessage('start'); } catch (e) {}
    }
  }

  stopWorker() {
    if (this.worker) {
      try { this.worker.postMessage('stop'); } catch (e) {}
    }
  }

  setServerTime(serverTime) {
    if (typeof serverTime === 'number' && serverTime > 0) {
      this.serverTimeOffset = Date.now() - serverTime;
    }
  }

  getAdjustedNow() {
    return Date.now() - this.serverTimeOffset;
  }

  start(data = {}) {
    if (data.serverTime) this.setServerTime(data.serverTime);
    this.isPlaying = true;
    this.isTimerRunning = true;
    this.startedAt = data.startedAt || this.getAdjustedNow();
    this.startPosition = typeof data.currentTime === 'number' ? data.currentTime : (typeof data.startPosition === 'number' ? data.startPosition : this.currentVideoTime);
    this.startRemaining = typeof data.secondsRemaining === 'number' ? data.secondsRemaining : (typeof data.startRemaining === 'number' ? data.startRemaining : this.currentRemaining);
    if (this.startRemaining <= 0) this.startRemaining = 60;

    this.startWorker();
    this.tick();
    this.syncAttachedVideos(true);

    if (!this.rafId) this.rafId = requestAnimationFrame(this.loop);
  }

  pause(data = {}) {
    if (data.serverTime) this.setServerTime(data.serverTime);
    this.isPlaying = false;
    this.isTimerRunning = false;
    if (typeof data.currentTime === 'number') this.currentVideoTime = data.currentTime;
    if (typeof data.secondsRemaining === 'number') this.currentRemaining = data.secondsRemaining;
    this.startPosition = this.currentVideoTime;
    this.startRemaining = this.currentRemaining;

    this.stopWorker();
    this.tick();
    this.syncAttachedVideos(true);
  }

  reset(data = {}) {
    if (data.serverTime) this.setServerTime(data.serverTime);
    this.isPlaying = false;
    this.isTimerRunning = false;
    this.currentVideoTime = 0;
    this.currentRemaining = 60;
    this.startPosition = 0;
    this.startRemaining = 60;
    this.startedAt = 0;

    this.stopWorker();
    this.tick();
    this.syncAttachedVideos(true);
  }

  sync(data = {}) {
    if (data.serverTime) this.setServerTime(data.serverTime);
    const wasPlaying = this.isPlaying;
    this.isPlaying = !!data.isPlaying;
    this.isTimerRunning = !!(data.isTimerRunning || data.isRunning);

    if (this.isPlaying || this.isTimerRunning) {
      this.startedAt = data.startedAt || this.startedAt || this.getAdjustedNow();
      if (typeof data.startPosition === 'number') this.startPosition = data.startPosition;
      if (typeof data.startRemaining === 'number') this.startRemaining = data.startRemaining;
      this.startWorker();
    } else {
      if (typeof data.currentSeconds === 'number') this.currentVideoTime = data.currentSeconds;
      if (typeof data.currentTime === 'number') this.currentVideoTime = data.currentTime;
      if (typeof data.secondsRemaining === 'number') this.currentRemaining = data.secondsRemaining;
      this.startPosition = this.currentVideoTime;
      this.startRemaining = this.currentRemaining;
      this.stopWorker();
    }

    this.tick();
    if (this.isPlaying && !wasPlaying) {
      this.syncAttachedVideos(true);
    }
    if ((this.isPlaying || this.isTimerRunning) && !this.rafId) {
      this.rafId = requestAnimationFrame(this.loop);
    }
  }

  tick() {
    if (this.isPlaying || this.isTimerRunning) {
      const now = this.getAdjustedNow();
      const elapsed = Math.max(0, (now - this.startedAt) / 1000);
      this.currentVideoTime = Math.min(60, this.startPosition + elapsed);
      this.currentRemaining = Math.max(0, Math.ceil(this.startRemaining - elapsed));

      if (this.currentRemaining <= 0 || this.currentVideoTime >= 60) {
        this.isPlaying = false;
        this.isTimerRunning = false;
        this.currentRemaining = 0;
        this.currentVideoTime = 60;
        this.stopWorker();
        if (this.onFinish) this.onFinish();
      }
    }

    // Continuously sync all attached video elements
    this.syncAttachedVideos();

    // Trigger UI Callback
    if (this.onTick) {
      this.onTick({
        videoTime: this.currentVideoTime,
        secondsRemaining: this.currentRemaining,
        isPlaying: this.isPlaying,
        isTimerRunning: this.isTimerRunning
      });
    }
  }

  loop() {
    if (!this.isPlaying && !this.isTimerRunning) {
      this.rafId = null;
      return;
    }

    this.tick();

    if (!document.hidden && (this.isPlaying || this.isTimerRunning)) {
      this.rafId = requestAnimationFrame(this.loop);
    } else {
      this.rafId = null;
    }
  }

  handleVisibility() {
    // When tab becomes active or switches focus, immediately force video and clock alignment
    this.tick();
    if (this.isPlaying || this.isTimerRunning) {
      this.syncAttachedVideos(true);
      if (!this.rafId) {
        this.rafId = requestAnimationFrame(this.loop);
      }
    }
  }

  syncAttachedVideos(forceSeek = false) {
    const target = this.currentVideoTime;
    const playing = this.isPlaying;
    const now = Date.now();

    this.videoElements.forEach(v => {
      if (!v || !v.src) return;

      if (this.isMutedVideo) {
        v.muted = true;
      }

      if (!playing) {
        // Paused state: ensure video is paused and gently set frame
        if (!v.paused) {
          try { v.pause(); } catch (e) {}
        }
        if (forceSeek || Math.abs(v.currentTime - target) > 0.08) {
          try { v.currentTime = target; } catch (e) {}
        }
        if (v.playbackRate !== 1.0) {
          v.playbackRate = 1.0;
        }
        return;
      }

      // Playing state:
      // 1. Ensure video is actively playing continuously
      if (v.paused) {
        const playPromise = v.play();
        if (playPromise !== undefined) {
          playPromise.catch((err) => {
            console.warn('[SyncClock] Unmuted playback blocked, falling back to muted continuous play:', err.message);
            v.muted = true;
            v.play().catch(() => {});
          });
        }
      }

      // 2. Skip time adjustment if hardware seek is already in progress
      if (v.seeking) return;

      const diff = v.currentTime - target;
      const absDiff = Math.abs(diff);
      const lastSeek = this.lastSeekMap.get(v) || 0;

      if (forceSeek || (absDiff > 1.25 && now - lastSeek > 1200)) {
        // Hard seek if drift is significant (e.g. initial start or return from long background tab)
        this.lastSeekMap.set(v, now);
        try {
          v.currentTime = target;
          v.playbackRate = 1.0;
        } catch (e) {}
      } else if (absDiff > 0.15) {
        // Smooth adaptive dynamic rate to eliminate frame drops
        if (diff > 0) {
          v.playbackRate = 0.93; // slightly slower
        } else {
          v.playbackRate = 1.07; // slightly faster
        }
      } else {
        // In tight sync zone (<150ms): steady 1.0x standard rate
        if (v.playbackRate !== 1.0) {
          v.playbackRate = 1.0;
        }
      }
    });
  }
}

window.soundEngine = new SoundFXEngine();
window.formatVideoUrl = formatVideoUrl;
window.attachVideoSafely = attachVideoSafely;
window.UniversalSyncClock = UniversalSyncClock;

// Unlock audio context on any user interaction
document.addEventListener('click', () => {
  window.soundEngine.init();
}, { once: false });
