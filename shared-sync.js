/**
 * Game Show Real-time Audio & Video Synchronization Engine
 * Includes Anti-DevTools Protection and High-Performance Sound Synthesizer
 */

// 1. DISABLE DEVTOOLS ON ALL PAGES
(function disableDevToolsGlobal() {
  // Disable right click / context menu
  document.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    return false;
  }, { capture: true });

  // Disable DevTools and View Source keyboard shortcuts
  window.addEventListener('keydown', function (e) {
    // F12
    if (e.key === 'F12' || e.keyCode === 123) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
    // Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C (or Cmd+Option+I, Cmd+Option+J, Cmd+Option+C on Mac)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (
      e.key === 'I' || e.key === 'i' || e.keyCode === 73 ||
      e.key === 'J' || e.key === 'j' || e.keyCode === 74 ||
      e.key === 'C' || e.key === 'c' || e.keyCode === 67
    )) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
    // Ctrl+U / Cmd+U (View Source)
    if ((e.ctrlKey || e.metaKey) && (e.key === 'u' || e.key === 'U' || e.keyCode === 85)) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
    // Ctrl+S / Cmd+S (Save Page)
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S' || e.keyCode === 83)) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
  }, { capture: true });
})();

// Helper to convert Google Drive link to streaming direct URL
function formatVideoUrl(url) {
  if (!url) return '';
  url = String(url).trim();
  
  // If already our API endpoint
  if (url.startsWith('/api/drive-video/')) return url;

  // Extract Google Drive File ID from all common Google Drive URL patterns
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

  // If pure fileId (length between 25 and 50 characters)
  if (/^[a-zA-Z0-9_-]{25,50}$/.test(url)) {
    return `/api/drive-video/${url}`;
  }

  return url;
}

// Fixed audio filenames as requested
const AUDIO_FILES = {
  CATEGORY: 'The Master Of Minds - Category.mp3',
  COUNTDOWN_5S: 'The Master Of Minds - 5s CountDown.mp3',
  COUNTDOWN_3S: '3s.mp3',
  CLIP_BED: 'The Master Of Minds - Clip bed R2.mp3'
};

// Web Audio API Synthesizer & MP3 Player for Game Show
class SoundFXEngine {
  constructor() {
    this.ctx = null;
    this.currentThemeOscillators = [];
    this.currentCategoryAudio = null;
    this.currentCountdownAudio = null;
    this.clipBedAudio = null;
  }

  // Check if audio should be silenced (Controller is completely silent)
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

  // 1. Play Theme Audio (The Master Of Minds - Category.mp3)
  playTheme() {
    if (this.isMuted()) return;
    this.stopCategoryAndCountdown();
    this.init();

    const audioUrl = '/' + encodeURIComponent(AUDIO_FILES.CATEGORY);
    try {
      this.currentCategoryAudio = new Audio(audioUrl);
      this.currentCategoryAudio.play().catch(e => {
        console.warn('MP3 file fallback to synthesizer:', e);
        this.synthesizeThemeMusic();
      });
    } catch (e) {
      this.synthesizeThemeMusic();
    }
  }

  // 2. Play 5-Second Countdown Audio (The Master Of Minds - 5s CountDown.mp3)
  play5Seconds() {
    if (this.isMuted()) return;
    this.stopCategoryAndCountdown();
    this.init();

    const audioUrl = '/' + encodeURIComponent(AUDIO_FILES.COUNTDOWN_5S);
    try {
      this.currentCountdownAudio = new Audio(audioUrl);
      this.currentCountdownAudio.play().catch(e => {
        console.warn('MP3 file fallback to synthesizer:', e);
        this.synthesizeCountdown(5);
      });
    } catch (e) {
      this.synthesizeCountdown(5);
    }
  }

  // 3. Play 3-Second Countdown Audio (3s.mp3)
  play3Seconds() {
    if (this.isMuted()) return;
    this.stopCategoryAndCountdown();
    this.init();

    const audioUrl = '/' + encodeURIComponent(AUDIO_FILES.COUNTDOWN_3S);
    try {
      this.currentCountdownAudio = new Audio(audioUrl);
      this.currentCountdownAudio.play().catch(e => {
        console.warn('MP3 file fallback to synthesizer:', e);
        this.synthesizeCountdown(3);
      });
    } catch (e) {
      this.synthesizeCountdown(3);
    }
  }

  // 4. Play Clip Bed Audio when video plays (The Master Of Minds - Clip bed R2.mp3)
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
        if (Math.abs(this.clipBedAudio.currentTime - currentTime) > 0.3) {
          this.clipBedAudio.currentTime = currentTime;
        }
      }
      this.clipBedAudio.play().catch(e => {
        console.warn('Clip bed playback note:', e);
      });
    } catch (e) {
      console.warn(e);
    }
  }

  // Pause Clip Bed Audio
  pauseClipBed() {
    if (this.clipBedAudio) {
      try {
        this.clipBedAudio.pause();
      } catch (e) {}
    }
  }

  // Stop & Reset Clip Bed Audio
  stopClipBed() {
    if (this.clipBedAudio) {
      try {
        this.clipBedAudio.pause();
        this.clipBedAudio.currentTime = 0;
      } catch (e) {}
    }
  }

  // Stop category & countdown sounds
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

  // Stop all audio completely
  stopAll() {
    this.stopCategoryAndCountdown();
    this.stopClipBed();
  }

  // Synthesizer Theme Fanfare fallback
  synthesizeThemeMusic() {
    if (this.isMuted() || !this.ctx) return;
    const now = this.ctx.currentTime;
    
    const chords = [
      [261.63, 329.63, 392.00, 523.25], // C Major
      [293.66, 369.99, 440.00, 587.33], // D Major
      [329.63, 415.30, 493.88, 659.25], // E Major
      [349.23, 440.00, 523.25, 698.46], // F Major
      [392.00, 493.88, 587.33, 783.99], // G Major
      [523.25, 659.25, 783.99, 1046.50] // C High Fanfare
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

  // Synthesizer Countdown Beep fallback
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

window.soundEngine = new SoundFXEngine();
window.formatVideoUrl = formatVideoUrl;

// Unlock audio context on any user interaction
document.addEventListener('click', () => {
  window.soundEngine.init();
}, { once: false });
