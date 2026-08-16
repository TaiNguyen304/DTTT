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

// Helper to convert Google Drive link to streaming direct URL (which streams web-standard H.264)
function formatVideoUrl(url) {
  if (!url) return '';
  url = String(url).trim();
  
  if (url.startsWith('/api/drive-video/')) return url;

  const drivePatterns = [
    /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i,
    /drive\.google\.com\/open\?(?:.*&)?id=([a-zA-Z0-9_-]+)/i,
    /drive\.google\.com\/uc\?(?:.*&)?id=([a-zA-Z0-9_-]+)/i,
    /drive\.usercontent\.google\.com\/download\?(?:.*&)?id=([a-zA-Z0-9_-]+)/i,
    /lh3\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/i,
    /docs\.google\.com\/(?:file\/d\/|uc\?(?:.*&)?id=)([a-zA-Z0-9_-]+)/i
  ];

  for (const pattern of drivePatterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return `/api/drive-video/${match[1]}`;
    }
  }

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
  videoEl.muted = true;
  videoEl.preload = 'auto';

  if (videoEl.src !== targetUrl && !videoEl.src.endsWith(targetUrl)) {
    videoEl.src = targetUrl;
    try {
      videoEl.load();
    } catch (e) {}
  }

  // Automatic retry on network or decode glitch while server is preparing H.264
  if (!videoEl._retryHandlerAttached) {
    videoEl._retryHandlerAttached = true;
    let retryCount = 0;
    videoEl.addEventListener('error', (e) => {
      if (retryCount < 5 && videoEl.src) {
        retryCount++;
        const currentSrc = videoEl.src;
        setTimeout(() => {
          if (videoEl.src === currentSrc) {
            console.log(`[VideoPlayer] Retrying video reload (${retryCount}/5)...`);
            videoEl.load();
          }
        }, 1500 * retryCount);
      }
    });

    videoEl.addEventListener('canplay', () => {
      retryCount = 0;
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
// HIGH-PRECISION UNIVERSAL CLOCK & TAB-SWITCH DRIFT PROTECTOR
// Guarantees exact timestamp sync across all tabs and devices
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

    this.loop = this.loop.bind(this);
    this.handleVisibility = this.handleVisibility.bind(this);

    document.addEventListener('visibilitychange', this.handleVisibility);
    window.addEventListener('focus', this.handleVisibility);
    window.addEventListener('pageshow', this.handleVisibility);

    // Periodic safety sync interval (100ms)
    setInterval(() => {
      this.tick();
    }, 100);
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

    this.tick();
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

    this.tick();
  }

  reset(data = {}) {
    this.isPlaying = false;
    this.isTimerRunning = false;
    this.currentVideoTime = 0;
    this.currentRemaining = 60;
    this.startPosition = 0;
    this.startRemaining = 60;
    this.startedAt = 0;

    this.tick();
  }

  sync(data = {}) {
    if (data.serverTime) this.setServerTime(data.serverTime);
    this.isPlaying = !!data.isPlaying;
    this.isTimerRunning = !!(data.isTimerRunning || data.isRunning);

    if (this.isPlaying || this.isTimerRunning) {
      this.startedAt = data.startedAt || this.startedAt || this.getAdjustedNow();
      if (typeof data.startPosition === 'number') this.startPosition = data.startPosition;
      if (typeof data.startRemaining === 'number') this.startRemaining = data.startRemaining;
    } else {
      if (typeof data.currentSeconds === 'number') this.currentVideoTime = data.currentSeconds;
      if (typeof data.currentTime === 'number') this.currentVideoTime = data.currentTime;
      if (typeof data.secondsRemaining === 'number') this.currentRemaining = data.secondsRemaining;
      this.startPosition = this.currentVideoTime;
      this.startRemaining = this.currentRemaining;
    }

    this.tick();
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
        if (this.onFinish) this.onFinish();
      }
    }

    // Sync all attached video elements
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
    this.tick();
    if (this.isPlaying || this.isTimerRunning) {
      this.rafId = requestAnimationFrame(this.loop);
    } else {
      this.rafId = null;
    }
  }

  handleVisibility() {
    // When tab becomes active or switches focus, immediately snap video and timers
    this.tick();
    this.syncAttachedVideos(true);
  }

  syncAttachedVideos(forceSeek = false) {
    const target = this.currentVideoTime;
    const playing = this.isPlaying;

    this.videoElements.forEach(v => {
      if (!v) return;

      if (this.isMutedVideo) {
        v.muted = true;
      }

      // Calculate time difference between video's current frame and target time
      const diff = v.currentTime - target;
      const absDiff = Math.abs(diff);

      if (forceSeek || absDiff > 0.25) {
        // Hard seek if drift is noticeable or forceSeek is requested
        try {
          v.currentTime = target;
          v.playbackRate = 1.0;
        } catch (e) {}
      } else if (playing && absDiff > 0.04) {
        // Micro-nudge playback rate (broadcast precision sync within 1 frame)
        // If video is slightly ahead, slow down slightly; if behind, speed up slightly
        if (diff > 0) {
          v.playbackRate = 0.95;
        } else {
          v.playbackRate = 1.05;
        }
      } else {
        if (v.playbackRate !== 1.0) {
          v.playbackRate = 1.0;
        }
      }

      if (playing) {
        if (v.paused) {
          const playPromise = v.play();
          if (playPromise !== undefined) {
            playPromise.catch(() => {
              v.muted = true;
              v.play().catch(() => {});
            });
          }
        }
      } else {
        if (!v.paused) {
          try { v.pause(); } catch (e) {}
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
