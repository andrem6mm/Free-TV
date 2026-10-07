/* Free TV — a channel browser and player for the iptv-org/iptv playlist. */
(() => {
  'use strict';

  const DEFAULT_PLAYLIST = 'https://iptv-org.github.io/iptv/index.m3u';
  const PAGE_SIZE = 150;
  const LOAD_TIMEOUT_MS = 20000;
  const MAX_RECENT = 30;
  const IS_HTTPS = location.protocol === 'https:';

  // ---------- storage ----------
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem('freetv:' + key);
        return v === null ? fallback : JSON.parse(v);
      } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('freetv:' + key, JSON.stringify(value)); } catch { /* storage unavailable */ }
    },
  };

  // ---------- elements ----------
  const $ = (id) => document.getElementById(id);
  const video = $('video');
  const player = $('player');
  const overlay = $('overlay');
  const overlayText = $('overlayText');
  const overlayActions = $('overlayActions');
  const osd = $('osd');
  const listEl = $('channels');
  const countEl = $('count');
  const searchEl = $('search');
  const countryEl = $('country');
  const categoryEl = $('category');
  const hideHttpEl = $('hideHttp');
  const hideGeoEl = $('hideGeo');
  const playlistUrlEl = $('playlistUrl');
  const favBtn = $('favBtn');

  // ---------- state ----------
  let channels = [];          // everything parsed from the playlist
  let byUrl = new Map();
  let view = [];              // channels after tab + filters
  let rendered = 0;
  let current = null;
  let hls = null;
  let loadTimer = null;
  let triedRecover = false;

  const favorites = new Set(store.get('favorites', []));
  let recent = store.get('recent', []);
  const prefs = Object.assign({
    tab: 'all',
    country: '',
    category: '',
    hideHttp: IS_HTTPS,
    hideGeo: false,
    playlist: DEFAULT_PLAYLIST,
  }, store.get('prefs', {}));

  const savePrefs = () => store.set('prefs', prefs);

  // ---------- helpers ----------
  const regionNames = (() => {
    try { return new Intl.DisplayNames(['en'], { type: 'region' }); } catch { return null; }
  })();

  function countryInfo(code) {
    const cc = code.toUpperCase() === 'UK' ? 'GB' : code.toUpperCase();
    let name = cc;
    try { name = (regionNames && regionNames.of(cc)) || cc; } catch { /* unknown region */ }
    const flag = /^[A-Z]{2}$/.test(cc)
      ? String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
      : '';
    return { code: code.toLowerCase(), name, flag };
  }
  const countryCache = new Map();
  function country(code) {
    if (!countryCache.has(code)) countryCache.set(code, countryInfo(code));
    return countryCache.get(code);
  }

  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    if (props) Object.assign(node, props);
    for (const c of children) if (c != null) node.append(c);
    return node;
  }

  function initials(name) {
    return name.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2)
      .map((w) => w[0]).join('').toUpperCase() || 'TV';
  }

  // ---------- playlist parsing ----------
  function parseM3U(text) {
    const out = [];
    const lines = text.split(/\r?\n/);
    let pending = null;
    const attrRe = /([\w-]+)="([^"]*)"/g;

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('#EXTINF')) {
        const attrs = {};
        let m, lastEnd = 0;
        attrRe.lastIndex = 0;
        while ((m = attrRe.exec(line))) { attrs[m[1].toLowerCase()] = m[2]; lastEnd = attrRe.lastIndex; }
        const comma = line.indexOf(',', lastEnd);
        const title = comma >= 0 ? line.slice(comma + 1).trim() : 'Unknown';
        pending = { attrs, title };
      } else if (line.startsWith('#')) {
        continue;
      } else if (pending) {
        out.push(makeChannel(pending, line));
        pending = null;
      }
    }
    return out;
  }

  function makeChannel({ attrs, title }, url) {
    const tags = [...title.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
    const quality = (title.match(/\((\d{3,4}[pi])\)/) || [])[1] || '';
    const name = title.replace(/\[[^\]]*\]/g, '').replace(/\(\d{3,4}[pi]\)/g, '').replace(/\s+/g, ' ').trim() || title;
    const id = attrs['tvg-id'] || '';
    let cc = (id.match(/\.([a-z]{2})(?:@|$)/i) || [])[1] || '';
    if (!cc && attrs['tvg-country']) cc = attrs['tvg-country'].split(';')[0];
    const groups = (attrs['group-title'] || '').split(';').map((g) => g.trim()).filter((g) => g && g !== 'Undefined');
    return {
      name,
      url,
      logo: attrs['tvg-logo'] || '',
      country: cc.toLowerCase(),
      groups,
      quality,
      tags,
      geo: tags.some((t) => /geo/i.test(t)),
      httpOnly: url.startsWith('http://'),
      search: (name + ' ' + id).toLowerCase(),
    };
  }

  // ---------- loading ----------
  async function loadPlaylist() {
    countEl.textContent = 'Loading channels…';
    listEl.replaceChildren();
    try {
      const res = await fetch(prefs.playlist, { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      channels = parseM3U(text);
      if (!channels.length) throw new Error('No channels found in playlist');
    } catch (err) {
      channels = [];
      countEl.textContent = '';
      listEl.replaceChildren(el('li', { className: 'empty' },
        `Couldn't load the playlist (${err.message}). Check your connection or the playlist URL in Settings.`));
      return;
    }
    byUrl = new Map(channels.map((c) => [c.url, c]));
    buildFilterOptions();
    applyFilters();

    const last = byUrl.get(store.get('lastUrl', ''));
    if (last && !current) select(last, { autoplay: false });
  }

  function buildFilterOptions() {
    const cCounts = new Map();
    const gCounts = new Map();
    for (const c of channels) {
      if (c.country) cCounts.set(c.country, (cCounts.get(c.country) || 0) + 1);
      for (const g of c.groups) gCounts.set(g, (gCounts.get(g) || 0) + 1);
    }
    const countries = [...cCounts.keys()].map(country).sort((a, b) => a.name.localeCompare(b.name));
    countryEl.replaceChildren(
      el('option', { value: '', textContent: 'All countries' }),
      ...countries.map((c) => el('option', { value: c.code, textContent: `${c.flag} ${c.name} (${cCounts.get(c.code)})`.trim() })),
    );
    const groups = [...gCounts.keys()].sort((a, b) => a.localeCompare(b));
    categoryEl.replaceChildren(
      el('option', { value: '', textContent: 'All categories' }),
      ...groups.map((g) => el('option', { value: g, textContent: `${g} (${gCounts.get(g)})` })),
    );
    countryEl.value = cCounts.has(prefs.country) ? prefs.country : '';
    categoryEl.value = gCounts.has(prefs.category) ? prefs.category : '';
  }

  // ---------- filtering & rendering ----------
  function applyFilters() {
    let base;
    if (prefs.tab === 'fav') base = channels.filter((c) => favorites.has(c.url));
    else if (prefs.tab === 'recent') base = recent.map((u) => byUrl.get(u)).filter(Boolean);
    else base = channels;

    const q = searchEl.value.trim().toLowerCase();
    const cc = countryEl.value;
    const cat = categoryEl.value;
    view = base.filter((c) =>
      (!q || c.search.includes(q)) &&
      (!cc || c.country === cc) &&
      (!cat || c.groups.includes(cat)) &&
      (!prefs.hideHttp || !c.httpOnly) &&
      (!prefs.hideGeo || !c.geo));

    rendered = 0;
    listEl.replaceChildren();
    listEl.scrollTop = 0;
    if (!view.length) {
      const msg = prefs.tab === 'fav' && !favorites.size ? 'No favorites yet — tap ☆ on a channel to add it.'
        : prefs.tab === 'recent' && !recent.length ? 'Channels you watch will show up here.'
        : 'No channels match your filters.';
      listEl.append(el('li', { className: 'empty', textContent: msg }));
    }
    countEl.textContent = `${view.length.toLocaleString()} channel${view.length === 1 ? '' : 's'}`;
    renderMore();
  }

  function renderMore() {
    const frag = document.createDocumentFragment();
    const end = Math.min(rendered + PAGE_SIZE, view.length);
    for (let i = rendered; i < end; i++) frag.append(channelRow(view[i], i));
    rendered = end;
    listEl.append(frag);
  }

  function channelRow(c, i) {
    const logo = el('div', { className: 'logo', textContent: initials(c.name) });
    if (c.logo) {
      const img = el('img', { src: c.logo, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' });
      img.onload = () => logo.replaceChildren(img);
      img.onerror = () => img.remove();
    }
    const ci = c.country ? country(c.country) : null;
    const meta = [ci && `${ci.flag} ${ci.name}`.trim(), c.groups.join(', '), c.quality, c.geo && 'Geo-blocked', c.httpOnly && 'HTTP']
      .filter(Boolean).join(' · ');
    const star = el('button', {
      className: 'star' + (favorites.has(c.url) ? ' on' : ''),
      textContent: favorites.has(c.url) ? '★' : '☆',
      title: 'Toggle favorite',
      ariaLabel: 'Toggle favorite',
    });
    star.addEventListener('click', (e) => { e.stopPropagation(); toggleFavorite(c); });
    const li = el('li', { className: 'channel' + (current === c ? ' active' : ''), title: c.name },
      el('span', { className: 'num', textContent: i + 1 }),
      logo,
      el('div', { className: 'info' },
        el('div', { className: 'name', textContent: c.name }),
        el('div', { className: 'meta', textContent: meta })),
      star);
    li.dataset.url = c.url;
    li.addEventListener('click', () => select(c));
    return li;
  }

  function refreshRows() {
    for (const li of listEl.children) {
      const url = li.dataset.url;
      if (!url) continue;
      li.classList.toggle('active', current && current.url === url);
      const star = li.querySelector('.star');
      const on = favorites.has(url);
      star.classList.toggle('on', on);
      star.textContent = on ? '★' : '☆';
    }
  }

  function toggleFavorite(c) {
    if (favorites.has(c.url)) favorites.delete(c.url); else favorites.add(c.url);
    store.set('favorites', [...favorites]);
    if (prefs.tab === 'fav') applyFilters(); else refreshRows();
    updateNowPlaying();
  }

  // ---------- playback ----------
  function showOverlay(text, { spinner = false, actions = false, link = null } = {}) {
    overlay.hidden = false;
    const box = overlayText;
    box.replaceChildren();
    if (spinner) box.append(el('div', { className: 'spinner' }));
    box.append(text);
    if (link) box.append(el('br'), el('a', { href: link, target: '_blank', rel: 'noopener', textContent: link }));
    overlayActions.hidden = !actions;
  }
  const hideOverlay = () => { overlay.hidden = true; };

  function stop() {
    clearTimeout(loadTimer);
    if (hls) { hls.destroy(); hls = null; }
    video.removeAttribute('src');
    video.load();
  }

  function fail(msg) {
    clearTimeout(loadTimer);
    if (hls) { hls.destroy(); hls = null; }
    video.removeAttribute('src');
    video.load();
    showOverlay(msg || "This channel isn't working right now. It may be offline or blocked in your region.", { actions: true });
  }

  function select(c, { autoplay = true } = {}) {
    current = c;
    store.set('lastUrl', c.url);
    updateNowPlaying();
    refreshRows();
    scrollToCurrent();
    if (autoplay) {
      recent = [c.url, ...recent.filter((u) => u !== c.url)].slice(0, MAX_RECENT);
      store.set('recent', recent);
      play(c);
    } else {
      stop();
      showOverlay(`Ready: ${c.name}`, { actions: false });
      overlayActions.hidden = false;
      $('retryBtn').textContent = 'Play';
    }
  }

  function play(c) {
    stop();
    $('retryBtn').textContent = 'Retry';
    triedRecover = false;

    if (IS_HTTPS && c.httpOnly) {
      showOverlay('This channel only offers an insecure (HTTP) stream, which browsers block on secure pages. You can open it in a player such as VLC:',
        { actions: true, link: c.url });
      return;
    }

    showOverlay(`Tuning in to ${c.name}…`, { spinner: true });
    loadTimer = setTimeout(() => fail('This channel is taking too long to load. It may be offline.'), LOAD_TIMEOUT_MS);

    const tryPlay = () => video.play().catch(() => {
      // Autoplay blocked: let the user press play on the native controls.
      clearTimeout(loadTimer);
      hideOverlay();
    });

    // Safari's built-in HLS player doesn't need CORS headers, so prefer it on Apple devices.
    const hlsJsOk = !!window.Hls && Hls.isSupported();
    const nativeHls = !!video.canPlayType('application/vnd.apple.mpegurl');
    if (!hlsJsOk || (nativeHls && /Apple/.test(navigator.vendor))) {
      video.src = c.url;
      tryPlay();
      return;
    }

    hls = new Hls({ enableWorker: true, lowLatencyMode: false, backBufferLength: 30 });
    hls.on(Hls.Events.MANIFEST_PARSED, tryPlay);
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !triedRecover) {
        triedRecover = true;
        hls.recoverMediaError();
        return;
      }
      fail();
    });
    hls.loadSource(c.url);
    hls.attachMedia(video);
  }

  video.addEventListener('playing', () => { clearTimeout(loadTimer); hideOverlay(); });
  video.addEventListener('error', () => { if (current && !hls && video.getAttribute('src')) fail(); });

  function updateNowPlaying() {
    const c = current;
    $('npName').textContent = c ? c.name : 'No channel selected';
    const ci = c && c.country ? country(c.country) : null;
    $('npMeta').textContent = c ? [ci && `${ci.flag} ${ci.name}`.trim(), c.groups.join(', '), c.quality].filter(Boolean).join(' · ') : '';
    const logo = $('npLogo');
    if (c && c.logo) { logo.src = c.logo; logo.hidden = false; logo.onerror = () => { logo.hidden = true; }; }
    else logo.hidden = true;
    favBtn.disabled = !c;
    const on = c && favorites.has(c.url);
    favBtn.classList.toggle('on', !!on);
    favBtn.textContent = on ? '★' : '☆';
    document.title = c ? `${c.name} · Free TV` : 'Free TV';
    if ('mediaSession' in navigator && c) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({ title: c.name, artist: 'Free TV', artwork: c.logo ? [{ src: c.logo }] : [] });
      } catch { /* unsupported */ }
    }
  }

  function scrollToCurrent() {
    const idx = current ? view.indexOf(current) : -1;
    if (idx < 0) return;
    while (rendered <= idx) renderMore();
    const li = listEl.children[idx];
    if (li && window.matchMedia('(min-width: 861px)').matches) li.scrollIntoView({ block: 'nearest' });
  }

  function flashOsd(text) {
    osd.textContent = text;
    osd.hidden = false;
    clearTimeout(flashOsd.t);
    flashOsd.t = setTimeout(() => { osd.hidden = true; }, 2000);
  }

  function step(delta) {
    if (!view.length) return;
    let idx = current ? view.indexOf(current) : -1;
    idx = idx < 0 ? (delta > 0 ? 0 : view.length - 1) : (idx + delta + view.length) % view.length;
    const c = view[idx];
    flashOsd(`${idx + 1}  ${c.name}`);
    select(c);
  }

  function jumpTo(n) {
    const c = view[n - 1];
    if (c) { flashOsd(`${n}  ${c.name}`); select(c); }
    else flashOsd(`No channel ${n}`);
  }

  // ---------- controls ----------
  $('prevBtn').addEventListener('click', () => step(-1));
  $('nextBtn').addEventListener('click', () => step(1));
  $('skipBtn').addEventListener('click', () => step(1));
  $('retryBtn').addEventListener('click', () => current && select(current));
  favBtn.addEventListener('click', () => current && toggleFavorite(current));

  for (const tab of document.querySelectorAll('.tab')) {
    tab.classList.toggle('active', tab.dataset.tab === prefs.tab);
    tab.addEventListener('click', () => {
      prefs.tab = tab.dataset.tab;
      savePrefs();
      for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t === tab);
      applyFilters();
    });
  }

  let searchTimer;
  searchEl.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(applyFilters, 150); });
  countryEl.addEventListener('change', () => { prefs.country = countryEl.value; savePrefs(); applyFilters(); });
  categoryEl.addEventListener('change', () => { prefs.category = categoryEl.value; savePrefs(); applyFilters(); });

  hideHttpEl.checked = prefs.hideHttp;
  hideGeoEl.checked = prefs.hideGeo;
  playlistUrlEl.value = prefs.playlist;
  hideHttpEl.addEventListener('change', () => { prefs.hideHttp = hideHttpEl.checked; savePrefs(); applyFilters(); });
  hideGeoEl.addEventListener('change', () => { prefs.hideGeo = hideGeoEl.checked; savePrefs(); applyFilters(); });
  $('reloadBtn').addEventListener('click', () => {
    prefs.playlist = playlistUrlEl.value.trim() || DEFAULT_PLAYLIST;
    playlistUrlEl.value = prefs.playlist;
    savePrefs();
    loadPlaylist();
  });
  $('resetUrlBtn').addEventListener('click', () => { playlistUrlEl.value = DEFAULT_PLAYLIST; $('reloadBtn').click(); });

  // Infinite scroll for the channel list.
  new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting) && rendered < view.length) renderMore();
  }, { root: null, rootMargin: '600px' }).observe($('sentinel'));
  listEl.addEventListener('scroll', () => {
    if (rendered < view.length && listEl.scrollTop + listEl.clientHeight > listEl.scrollHeight - 600) renderMore();
  });

  // Keyboard remote.
  let digits = '';
  let digitTimer;
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    const typing = t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement;
    if (e.key === 'Escape' && t === searchEl) { searchEl.blur(); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.key) {
      case 'ArrowUp': case 'PageUp': e.preventDefault(); step(-1); break;
      case 'ArrowDown': case 'PageDown': e.preventDefault(); step(1); break;
      case 'f': case 'F': toggleFullscreen(); break;
      case 'm': case 'M': video.muted = !video.muted; flashOsd(video.muted ? 'Muted' : 'Sound on'); break;
      case '/': e.preventDefault(); searchEl.focus(); break;
      default:
        if (/^[0-9]$/.test(e.key)) {
          digits = (digits + e.key).slice(-5);
          flashOsd(digits);
          clearTimeout(digitTimer);
          digitTimer = setTimeout(() => { const n = parseInt(digits, 10); digits = ''; if (n) jumpTo(n); }, 1200);
        }
    }
  });

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (player.requestFullscreen) player.requestFullscreen().catch(() => {});
    else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
  }

  // Swipe left/right on the video to change channel.
  let touchStart = null;
  player.addEventListener('touchstart', (e) => {
    const p = e.changedTouches[0];
    touchStart = { x: p.clientX, y: p.clientY, t: Date.now() };
  }, { passive: true });
  player.addEventListener('touchend', (e) => {
    if (!touchStart) return;
    const p = e.changedTouches[0];
    const dx = p.clientX - touchStart.x;
    const dy = p.clientY - touchStart.y;
    const fast = Date.now() - touchStart.t < 600;
    touchStart = null;
    if (fast && Math.abs(dx) > 60 && Math.abs(dy) < 50) step(dx < 0 ? 1 : -1);
  }, { passive: true });

  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('previoustrack', () => step(-1));
      navigator.mediaSession.setActionHandler('nexttrack', () => step(1));
    } catch { /* unsupported */ }
  }

  // ---------- install / offline ----------
  let installEvent = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e;
    $('installBtn').hidden = false;
  });
  $('installBtn').addEventListener('click', async () => {
    if (!installEvent) return;
    installEvent.prompt();
    await installEvent.userChoice.catch(() => {});
    installEvent = null;
    $('installBtn').hidden = true;
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  loadPlaylist();
})();
