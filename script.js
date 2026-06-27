// Under the Seal of Unspoken Knowledge — interactions
// Confirm JS is live before any reveal-hiding CSS applies, so a failed
// load can never leave the dossier blank.
document.documentElement.classList.add('js');

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------------
   Firebase Analytics — loaded out-of-band so a blocked CDN never
   takes the rest of the page down with it.
   ------------------------------------------------------------------ */
(async () => {
  try {
    const [{ initializeApp }, { getAnalytics }] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.14.0/firebase-analytics.js'),
    ]);
    const app = initializeApp({
      apiKey: 'AIzaSyBaTcCqBZFyrADuqqNnA8YyAXHHT2Z3tyY',
      authDomain: 'bo-sam-matter.firebaseapp.com',
      projectId: 'bo-sam-matter',
      storageBucket: 'bo-sam-matter.firebasestorage.app',
      messagingSenderId: '872605418604',
      appId: '1:872605418604:web:49fc068aa072d12a684449',
      measurementId: 'G-KFED1GJQD5',
    });
    getAnalytics(app);
  } catch {
    /* analytics is optional; the dossier works without it */
  }
})();

/* ------------------------------------------------------------------
   Reveal on scroll
   ------------------------------------------------------------------ */
(() => {
  const items = document.querySelectorAll('.reveal');
  if (!items.length) return;

  if (reduceMotion || !('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('is-visible'));
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.16, rootMargin: '0px 0px -8% 0px' }
  );
  items.forEach((el) => io.observe(el));
})();

/* ------------------------------------------------------------------
   Reading-progress spine + scroll-spy on the index rail
   ------------------------------------------------------------------ */
(() => {
  const rail = document.querySelector('.rail');
  const links = Array.from(document.querySelectorAll('[data-rail]'));
  if (!rail || !links.length) return;

  const sections = links
    .map((a) => document.querySelector(a.getAttribute('href')))
    .filter(Boolean);

  let ticking = false;

  const update = () => {
    ticking = false;

    // progress spine: how far through the document we've scrolled
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    rail.style.setProperty('--progress', ratio.toFixed(4));

    // scroll-spy: the section whose top last crossed the upper third wins
    const marker = window.innerHeight * 0.35;
    let activeIndex = 0;
    sections.forEach((sec, i) => {
      if (sec.getBoundingClientRect().top <= marker) activeIndex = i;
    });
    links.forEach((a, i) => a.classList.toggle('is-active', i === activeIndex));
  };

  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  update();

  // Move keyboard/SR focus into the destination section on in-page nav, so the
  // reading cursor follows the scroll (links alone don't move focus).
  sections.forEach((sec) => { if (!sec.hasAttribute('tabindex')) sec.tabIndex = -1; });
  const focusTargets = [...links, document.querySelector('.scroll-cue')].filter(Boolean);
  focusTargets.forEach((a) => {
    a.addEventListener('click', () => {
      const target = document.querySelector(a.getAttribute('href'));
      if (target) requestAnimationFrame(() => target.focus({ preventScroll: true }));
    });
  });

  // On mobile the rail is just a 3px progress bar with no links — hide the now
  // empty navigation landmark from assistive tech.
  const mobile = window.matchMedia('(max-width: 960px)');
  const syncRailHidden = () => {
    if (mobile.matches) rail.setAttribute('aria-hidden', 'true');
    else rail.removeAttribute('aria-hidden');
  };
  syncRailHidden();
  mobile.addEventListener('change', syncRailHidden);
})();

/* ------------------------------------------------------------------
   Spoken Renditions — custom audio player (five voices, one element)
   ------------------------------------------------------------------ */
(() => {
  const root = document.querySelector('[data-player]');
  if (!root) return;

  const audio    = root.querySelector('[data-audio]');
  const voices   = Array.from(root.querySelectorAll('[data-voice]'));
  const playBtn  = root.querySelector('[data-play]');
  const scrub    = root.querySelector('[data-scrub]');
  const fill     = root.querySelector('[data-scrub-fill]');
  const head     = root.querySelector('[data-scrub-head]');
  const elapsedEl = root.querySelector('[data-elapsed]');
  const totalEl   = root.querySelector('[data-total]');
  const nowVoice  = root.querySelector('[data-now-voice]');
  const nowNote   = root.querySelector('[data-now-note]');
  const fallback  = root.querySelector('[data-fallback]');
  const video     = document.querySelector('[data-video]');

  if (!audio || !voices.length || !playBtn || !scrub) return;

  let current = voices.find((v) => v.getAttribute('aria-checked') === 'true') || voices[0];
  let srcLoaded = false;
  let pendingRatio = null; // a seek requested before metadata was available

  const totalText = () => totalEl.textContent || '0:00';

  const fmt = (s) => {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, '0')}`;
  };

  // The label is stable ("Play or pause narration"); aria-pressed carries the
  // on/off state, so screen readers don't announce a contradictory action+state.
  const setPressed = (on) => {
    playBtn.setAttribute('aria-pressed', String(on));
  };

  const renderProgress = (ratio) => {
    const pct = Math.min(100, Math.max(0, ratio * 100));
    fill.style.width = pct + '%';
    head.style.left = pct + '%';
    scrub.setAttribute('aria-valuenow', String(Math.round(pct)));
  };

  const loadVoice = (btn, { autoplay = false } = {}) => {
    current = btn;
    voices.forEach((v) => {
      const on = v === btn;
      v.setAttribute('aria-checked', String(on));
      v.tabIndex = on ? 0 : -1; // roving tabindex: only the checked radio is tabbable
    });

    audio.src = btn.dataset.src;
    srcLoaded = true;
    pendingRatio = null;

    nowVoice.textContent = btn.querySelector('.voice-name').textContent;
    if (nowNote) nowNote.textContent = btn.dataset.note || '';
    if (fallback) {
      fallback.setAttribute('href', btn.dataset.src);
      fallback.textContent = `Download the ${nowVoice.textContent} rendition`;
    }

    elapsedEl.textContent = '0:00';
    totalEl.textContent = btn.dataset.dur || '0:00';
    renderProgress(0);
    scrub.setAttribute('aria-valuetext', `0:00 of ${totalText()}`);

    if (autoplay) audio.play().catch(() => setPressed(false));
  };

  const ensureSrc = () => {
    if (!srcLoaded) loadVoice(current);
  };

  // --- voice selection (radiogroup) ---
  const selectVoice = (btn, { focus = false } = {}) => {
    const wasPlaying = srcLoaded && !audio.paused;
    if (!(btn === current && srcLoaded)) loadVoice(btn, { autoplay: wasPlaying });
    if (focus) btn.focus();
  };

  voices.forEach((btn, i) => {
    btn.addEventListener('click', () => selectVoice(btn));
    btn.addEventListener('keydown', (e) => {
      let next = -1;
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown': next = (i + 1) % voices.length; break;
        case 'ArrowLeft':
        case 'ArrowUp':   next = (i - 1 + voices.length) % voices.length; break;
        case 'Home':      next = 0; break;
        case 'End':       next = voices.length - 1; break;
        default: return;
      }
      e.preventDefault();
      selectVoice(voices[next], { focus: true });
    });
  });

  // seed roving tabindex from the initially-checked voice
  voices.forEach((v) => { v.tabIndex = v === current ? 0 : -1; });

  // --- play / pause ---
  playBtn.addEventListener('click', () => {
    ensureSrc();
    if (audio.paused) {
      if (video && !video.paused) video.pause();
      audio.play().catch(() => setPressed(false));
    } else {
      audio.pause();
    }
  });

  // pause the narration if the witness film starts, and vice versa
  if (video) {
    video.addEventListener('play', () => {
      if (srcLoaded && !audio.paused) audio.pause();
    });
  }

  // --- audio element events ---
  audio.addEventListener('play', () => setPressed(true));
  audio.addEventListener('pause', () => setPressed(false));
  audio.addEventListener('ended', () => {
    setPressed(false);
    renderProgress(0);
    audio.currentTime = 0;
    elapsedEl.textContent = '0:00';
  });

  audio.addEventListener('loadedmetadata', () => {
    totalEl.textContent = fmt(audio.duration);
    if (pendingRatio != null) {
      audio.currentTime = pendingRatio * audio.duration;
      pendingRatio = null;
    }
  });

  audio.addEventListener('timeupdate', () => {
    const d = audio.duration;
    if (!isFinite(d) || d === 0) return;
    const ratio = audio.currentTime / d;
    renderProgress(ratio);
    elapsedEl.textContent = fmt(audio.currentTime);
    scrub.setAttribute('aria-valuetext', `${fmt(audio.currentTime)} of ${fmt(d)}`);
  });

  audio.addEventListener('error', () => setPressed(false));

  // --- scrubbing (pointer) ---
  const seekToClientX = (clientX) => {
    const rect = scrub.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    ensureSrc();
    if (isFinite(audio.duration) && audio.duration > 0) {
      audio.currentTime = ratio * audio.duration;
      renderProgress(ratio);
    } else {
      // Metadata not in yet. Stash the target — 'loadedmetadata' applies it.
      // (Never call audio.load() here: it would abort an in-flight play().)
      pendingRatio = ratio;
      renderProgress(ratio);
    }
  };

  let dragging = false;
  scrub.addEventListener('pointerdown', (e) => {
    dragging = true;
    scrub.setPointerCapture(e.pointerId);
    seekToClientX(e.clientX);
  });
  scrub.addEventListener('pointermove', (e) => {
    if (dragging) seekToClientX(e.clientX);
  });
  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    try { scrub.releasePointerCapture(e.pointerId); } catch {}
  };
  scrub.addEventListener('pointerup', endDrag);
  scrub.addEventListener('pointercancel', endDrag);

  // --- scrubbing (keyboard) ---
  scrub.addEventListener('keydown', (e) => {
    ensureSrc();
    const d = audio.duration;
    const known = isFinite(d) && d > 0;
    const step = e.shiftKey ? 15 : 5;
    let handled = true;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        if (known) audio.currentTime = Math.min(d, audio.currentTime + step);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        if (known) audio.currentTime = Math.max(0, audio.currentTime - step);
        break;
      case 'Home':
        if (known) audio.currentTime = 0;
        else { pendingRatio = 0; renderProgress(0); }
        break;
      case 'End':
        if (known) audio.currentTime = d;
        else { pendingRatio = 1; renderProgress(1); }
        break;
      case ' ':
      case 'Enter':
        playBtn.click(); // convenience: toggle playback from the focused slider
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  });
})();
