// Low-overhead reader for the SoundCloud player bar.
// Event-driven: MutationObservers on just two small elements (play button, track badge),
// plus one 5s tick that only does a few querySelector calls. No 1s polling, no body-wide observers.
(() => {
  const q = (s) => document.querySelector(s);
  const toSec = (t) => (t ? t.trim().split(':').map(Number).reduce((a, b) => a * 60 + b, 0) : 0);
  const HEARTBEAT_MS = 30000;

  function read() {
    const titleEl = q('.playbackSoundBadge__titleLink');
    if (!titleEl) return { playing: false };
    const title = titleEl.getAttribute('title') || (titleEl.querySelector('span[aria-hidden="true"]') || titleEl).textContent.trim();
    const artistEl = q('.playbackSoundBadge__lightLink');
    let artwork = '';
    const av = q('.playbackSoundBadge__avatar span');
    if (av) {
      const m = /url\(["']?(.*?)["']?\)/.exec(av.style.backgroundImage || '');
      if (m) artwork = m[1].replace(/-t\d+x\d+/, '-t500x500');
    }
    let url = '';
    try { const u = new URL(titleEl.href, location.origin); url = u.origin + u.pathname; } catch {}
    const playBtn = q('.playControls__play');
    const passed = q('.playbackTimeline__timePassed span[aria-hidden="true"]');
    const dur = q('.playbackTimeline__duration span[aria-hidden="true"]');
    return {
      playing: !!(playBtn && playBtn.classList.contains('playing')),
      title, artist: artistEl ? artistEl.textContent.trim() : '', artwork, url,
      position: toSec(passed && passed.textContent), duration: toSec(dur && dur.textContent),
    };
  }

  let last = null, lastSentAt = 0, debounce = 0;
  const send = (p) => {
    try { chrome.runtime.sendMessage({ type: 'scp-update', payload: p }); } catch {}
    lastSentAt = Date.now(); last = { ...p, at: lastSentAt };
  };

  function check() {
    const cur = read();
    if (!last) return send(cur);
    // Only talk to the background when something actually changed (or a rare heartbeat while playing)
    const expected = last.position + (last.playing ? (Date.now() - last.at) / 1000 : 0);
    const changed = cur.playing !== last.playing || cur.url !== last.url || (cur.playing && Math.abs(cur.position - expected) > 3);
    const heartbeat = cur.playing && Date.now() - lastSentAt > HEARTBEAT_MS;
    if (changed || heartbeat) send(cur);
  }
  const schedule = () => { clearTimeout(debounce); debounce = setTimeout(check, 400); };

  // Observe only the two small elements that change on play/pause/track change.
  let playEl = null, badgeEl = null, obsPlay = null, obsBadge = null;
  function attach() {
    const p = q('.playControls__play'), b = q('.playbackSoundBadge');
    if (p !== playEl) {
      obsPlay && obsPlay.disconnect(); playEl = p; obsPlay = null;
      if (p) { obsPlay = new MutationObserver(schedule); obsPlay.observe(p, { attributes: true, attributeFilter: ['class'] }); }
    }
    if (b !== badgeEl) {
      obsBadge && obsBadge.disconnect(); badgeEl = b; obsBadge = null;
      if (b) { obsBadge = new MutationObserver(schedule); obsBadge.observe(b, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'title', 'href'] }); }
    }
  }

  // Slow safety tick: re-attach if SoundCloud re-rendered the player, catch seeks.
  const tick = () => { attach(); check(); };
  setTimeout(tick, 1500);
  setInterval(tick, 5000);

  window.addEventListener('pagehide', () => send({ playing: false }));
})();
