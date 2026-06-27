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
    const progEl = document.querySelector('[data-progress]');
    if (progEl) progEl.textContent = Math.round(ratio * 100);

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

/* ------------------------------------------------------------------
   Reader enhancements — dock, options, listen, quote, section actions
   ------------------------------------------------------------------ */
(() => {
  const dock = document.querySelector('[data-dock]');
  const main = document.querySelector('.dossier');
  if (!dock || !main) return;
  dock.hidden = false;

  const L = window.__dossierLabels || {};
  const sections = Array.from(main.querySelectorAll('section[id]'));
  const toastEl = document.querySelector('[data-toast]');
  let toastTimer;
  const toast = (msg) => {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
  };

  const currentIndex = () => {
    const marker = window.innerHeight * 0.35;
    let idx = 0;
    sections.forEach((s, i) => { if (s.getBoundingClientRect().top <= marker) idx = i; });
    return idx;
  };
  const goTo = (i) => {
    const t = sections[Math.max(0, Math.min(sections.length - 1, i))];
    if (t) t.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  };

  const sectionText = (sec) => {
    const clone = sec.cloneNode(true);
    clone.querySelectorAll('.movement-num, .player, .witness, .sec-actions, .scroll-cue, .letter-seal, .seal-mark, .dossier-seal, .resolve-mark, .severance-date, .halo, .flag, .player-fallback, audio, video, script').forEach((n) => n.remove());
    const t = (clone.textContent || '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ');
    return t.replace(/\s+/g, ' ').trim();
  };

  /* ---- Listen (Web Speech API) ---- */
  const synth = window.speechSynthesis;
  const listenBtn = dock.querySelector('[data-listen]');
  const listenGlyph = dock.querySelector('[data-listen-glyph]');
  const listenLabel = dock.querySelector('[data-listen-label]');
  let speaking = false, speakIdx = 0, pickedVoice = null;

  const pickVoice = () => {
    const want = (document.documentElement.lang || 'en').toLowerCase().slice(0, 2);
    const voices = synth ? synth.getVoices() : [];
    if (!voices.length) return null;
    return voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(want)) || voices[0];
  };
  const clearSpeak = () => sections.forEach((s) => s.classList.remove('is-speaking'));
  const stopListen = () => {
    speaking = false;
    if (synth) synth.cancel();
    clearSpeak();
    if (listenBtn) listenBtn.setAttribute('aria-pressed', 'false');
    if (listenGlyph) listenGlyph.innerHTML = '&#9654;';
    if (listenLabel) listenLabel.textContent = listenLabel.dataset.on || 'Listen';
  };
  function next() {
    if (!speaking) return;
    clearSpeak();
    if (speakIdx >= sections.length) { stopListen(); return; }
    const sec = sections[speakIdx];
    const text = sectionText(sec);
    if (!text) { speakIdx++; next(); return; }
    sec.classList.add('is-speaking');
    sec.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    const u = new SpeechSynthesisUtterance(text);
    if (pickedVoice) u.voice = pickedVoice;
    u.rate = 0.92; u.pitch = 0.92;
    u.onend = () => { if (speaking) { speakIdx++; next(); } };
    u.onerror = () => { if (speaking) { speakIdx++; next(); } };
    synth.speak(u);
  }
  const speakFrom = (i) => {
    if (!synth) { toast(L.noSpeech || 'Speech not supported here'); return; }
    speaking = true; speakIdx = i; pickedVoice = pickVoice();
    if (listenBtn) listenBtn.setAttribute('aria-pressed', 'true');
    if (listenGlyph) listenGlyph.innerHTML = '&#9632;';
    if (listenLabel) listenLabel.textContent = listenLabel.dataset.off || 'Stop';
    next();
  };
  if (listenBtn) listenBtn.addEventListener('click', () => (speaking ? stopListen() : speakFrom(currentIndex())));
  if (synth && synth.addEventListener) synth.addEventListener('voiceschanged', () => { pickedVoice = pickVoice(); });
  window.addEventListener('beforeunload', () => { if (synth) synth.cancel(); });

  /* ---- Reading options ---- */
  const PREFS = 'dossier-prefs';
  const readPrefs = () => { try { return JSON.parse(localStorage.getItem(PREFS) || '{}'); } catch { return {}; } };
  const writePrefs = (p) => { try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch {} };
  let prefs = readPrefs();
  const optsBtn = dock.querySelector('[data-opts]');
  const optsPanel = document.querySelector('[data-opts-panel]');
  const sizeVal = optsPanel && optsPanel.querySelector('[data-size-val]');
  const SIZES = [16, 17, 18, 20, 22, 24];
  let legibleLoaded = false;
  const loadLegibleFont = () => {
    if (legibleLoaded) return; legibleLoaded = true;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&display=swap';
    document.head.appendChild(l);
  };
  const applyPrefs = () => {
    const c = document.documentElement;
    c.classList.toggle('theme-light', !!prefs.themeLight);
    c.classList.toggle('reading', !!prefs.themeLight);
    c.classList.toggle('legible', !!prefs.legible);
    c.style.fontSize = (prefs.size || 18) + 'px';
    if (prefs.legible) loadLegibleFont();
    if (optsPanel) optsPanel.querySelectorAll('[data-opt]').forEach((b) => {
      const on = b.dataset.opt === 'theme-light' ? !!prefs.themeLight : !!prefs.legible;
      b.setAttribute('aria-pressed', String(on));
    });
    if (sizeVal) sizeVal.textContent = Math.round(((prefs.size || 18) / 18) * 100) + '%';
  };
  const toggleOpts = (force) => {
    if (!optsPanel) return;
    const open = force != null ? force : optsPanel.getAttribute('aria-hidden') === 'true';
    optsPanel.setAttribute('aria-hidden', String(!open));
    optsPanel.classList.toggle('is-open', open);
    optsBtn.setAttribute('aria-expanded', String(open));
    optsBtn.classList.toggle('is-on', open);
  };
  if (optsBtn) optsBtn.addEventListener('click', () => toggleOpts());
  document.addEventListener('click', (e) => {
    if (optsPanel && optsPanel.classList.contains('is-open') &&
        !optsPanel.contains(e.target) && !optsBtn.contains(e.target)) toggleOpts(false);
  });
  if (optsPanel) {
    optsPanel.querySelectorAll('[data-opt]').forEach((b) => b.addEventListener('click', () => {
      const key = b.dataset.opt === 'theme-light' ? 'themeLight' : 'legible';
      prefs[key] = !prefs[key]; writePrefs(prefs); applyPrefs();
    }));
    optsPanel.querySelectorAll('[data-size]').forEach((b) => b.addEventListener('click', () => {
      let i = SIZES.indexOf(prefs.size || 18); if (i < 0) i = 2;
      i = b.dataset.size === '+' ? Math.min(SIZES.length - 1, i + 1) : Math.max(0, i - 1);
      prefs.size = SIZES[i]; writePrefs(prefs); applyPrefs();
    }));
  }
  applyPrefs();

  /* ---- Print ---- */
  const printBtn = dock.querySelector('[data-print]');
  if (printBtn) printBtn.addEventListener('click', () => window.print());

  /* ---- Prev / next ---- */
  const prevBtn = dock.querySelector('[data-prev]');
  const nextBtn = dock.querySelector('[data-next]');
  if (prevBtn) prevBtn.addEventListener('click', () => goTo(currentIndex() - 1));
  if (nextBtn) nextBtn.addEventListener('click', () => goTo(currentIndex() + 1));
  document.addEventListener('keydown', (e) => {
    if (!(e.target instanceof Element) || e.target.matches('input, textarea, [contenteditable], [role="slider"]')) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'j' || e.key === 'J') goTo(currentIndex() + 1);
    else if (e.key === 'k' || e.key === 'K') goTo(currentIndex() - 1);
  });

  /* ---- Quote-card generator ---- */
  const modal = document.querySelector('[data-qmodal]');
  const canvas = modal && modal.querySelector('[data-qcanvas]');
  const qtext = modal && modal.querySelector('[data-qtext]');
  const quoteBtn = dock.querySelector('[data-quote]');

  const wrapText = (ctx, text, maxW) => {
    const words = text.split(/\s+/);
    const lines = []; let line = '';
    if (words.length <= 2 && text.length > 12) {              // CJK / spaceless
      for (const ch of text) {
        if (ctx.measureText(line + ch).width > maxW && line) { lines.push(line); line = ch; }
        else line += ch;
      }
      if (line) lines.push(line); return lines;
    }
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
      else line = test;
    }
    if (line) lines.push(line);
    return lines;
  };
  const draw = async (text) => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = '#0a0a0b'; ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(W / 2, H * 0.4, H * 0.2, W / 2, H * 0.5, W * 0.75);
    g.addColorStop(0, 'rgba(20,20,24,0)'); g.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 2; ctx.strokeRect(40, 40, W - 80, H - 80);
    ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    ctx.fillStyle = '#d2554d'; ctx.font = '600 22px "IBM Plex Mono", monospace';
    ctx.fillText('U N D E R   T H E   S E A L', 72, 74);
    ctx.fillStyle = 'rgba(94,23,20,0.75)'; ctx.font = '64px serif'; ctx.textAlign = 'right';
    ctx.fillText('⚜', W - 60, 62); ctx.textAlign = 'left';
    try { await document.fonts.load('italic 700 52px "Crimson Text"'); } catch {}
    ctx.fillStyle = '#d7d4cc'; ctx.font = 'italic 700 52px "Crimson Text", Georgia, serif';
    const lines = wrapText(ctx, '“' + text.trim() + '”', W - 160).slice(0, 6);
    const lh = 70; let y = Math.max(150, (H - lines.length * lh) / 2 - 10);
    lines.forEach((ln) => { ctx.fillText(ln, 80, y); y += lh; });
    ctx.fillStyle = '#8d8a82'; ctx.font = '500 24px "IBM Plex Mono", monospace';
    ctx.fillText('— Bo Shang', 80, H - 112);
    ctx.fillStyle = '#6f6c66'; ctx.font = '400 19px "IBM Plex Mono", monospace';
    ctx.fillText('bo-sam-matter.web.app', 80, H - 76);
  };
  const openQuote = (seed) => {
    if (!modal || !canvas) return;
    qtext.value = (seed || '').replace(/\s+/g, ' ').trim().slice(0, 280);
    draw(qtext.value);
    if (typeof modal.showModal === 'function') { try { modal.showModal(); } catch { modal.setAttribute('open', ''); } }
    else modal.setAttribute('open', '');
  };
  if (qtext) qtext.addEventListener('input', () => draw(qtext.value));
  if (quoteBtn) quoteBtn.addEventListener('click', () => {
    const sel = String(window.getSelection()).trim();
    openQuote(sel || (L.defaultQuote || 'I will be a victim whose fidelity to the unspoken becomes its own strange kind of wholeness.'));
  });
  if (modal) {
    modal.querySelector('[data-qclose]').addEventListener('click', () => modal.close());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.close(); });
    modal.querySelector('[data-qdownload]').addEventListener('click', () => {
      canvas.toBlob((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = 'bo-shang-quote.png'; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }, 'image/png');
    });
    const shareBtn = modal.querySelector('[data-qshare]');
    if (navigator.canShare) {
      try {
        if (navigator.canShare({ files: [new File([new Blob()], 'x.png', { type: 'image/png' })] })) {
          shareBtn.hidden = false;
          shareBtn.addEventListener('click', () => canvas.toBlob(async (blob) => {
            try { await navigator.share({ files: [new File([blob], 'bo-shang-quote.png', { type: 'image/png' })], title: 'Under the Seal', text: qtext.value }); } catch {}
          }, 'image/png'));
        }
      } catch {}
    }
    modal.querySelector('[data-qcopy]').addEventListener('click', () =>
      navigator.clipboard?.writeText(qtext.value).then(() => toast(L.textCopied || 'Text copied')));
  }

  /* ---- Per-section actions ---- */
  sections.forEach((sec) => {
    const head = sec.querySelector('.movement-head');
    if (!head) return;
    const bar = document.createElement('div');
    bar.className = 'sec-actions';
    bar.innerHTML =
      `<button class="sec-act" type="button" data-sec-listen><span aria-hidden="true">&#9654;</span> ${L.listen || 'Listen'}</button>` +
      `<button class="sec-act" type="button" data-sec-copy><span aria-hidden="true">&#128279;</span> ${L.copy || 'Copy link'}</button>` +
      `<button class="sec-act" type="button" data-sec-quote><span aria-hidden="true">&#10078;</span> ${L.quote || 'Quote'}</button>`;
    head.appendChild(bar);
    bar.querySelector('[data-sec-listen]').addEventListener('click', () => {
      const i = sections.indexOf(sec);
      if (speaking && speakIdx === i) stopListen(); else speakFrom(i);
    });
    bar.querySelector('[data-sec-copy]').addEventListener('click', (e) => {
      const url = location.origin + location.pathname + '#' + sec.id;
      const btn = e.currentTarget;
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => {
        btn.classList.add('copied'); toast(L.copied || 'Link copied');
        setTimeout(() => btn.classList.remove('copied'), 1400);
      }).catch(() => toast(url));
    });
    bar.querySelector('[data-sec-quote]').addEventListener('click', () => {
      const sel = window.getSelection();
      const text = String(sel).trim();
      const seed = text && sel.anchorNode && sec.contains(sel.anchorNode)
        ? text : (sectionText(sec).split(/(?<=[.!?。！？])\s?/)[0] || sectionText(sec)).slice(0, 240);
      openQuote(seed);
    });
  });
})();

/* ------------------------------------------------------------------
   PWA — offline shell + installable
   ------------------------------------------------------------------ */
(() => {
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
