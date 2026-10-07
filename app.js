/* Free TV — a channel browser and player for the iptv-org/iptv playlist. */
(() => {
  'use strict';

  const DEFAULT_PLAYLIST = 'https://iptv-org.github.io/iptv/index.m3u';
  // Same file, served from GitHub directly; used if the main address fails.
  const MIRROR_PLAYLIST = 'https://raw.githubusercontent.com/iptv-org/iptv/gh-pages/index.m3u';
  const FETCH_TIMEOUT_MS = 90000;
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
  const catsEl = $('cats');
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
  let loading = true;

  const favorites = new Set(store.get('favorites', []));
  let recent = store.get('recent', []);
  const prefs = Object.assign({
    tab: 'all',
    listCollapsed: false,
    country: '',
    category: '',
    hideHttp: false,
    hideGeo: false,
    playlist: DEFAULT_PLAYLIST,
  }, store.get('prefs', {}));
  // Older versions hid HTTP-only channels by default; show every channel again once.
  if (!(prefs.v >= 7)) { prefs.hideHttp = false; prefs.v = 7; store.set('prefs', prefs); }

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
  async function fetchText(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      if (!res.body || !res.body.getReader) return await res.text();
      // Stream the download so we can show progress on slow connections.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = '';
      let bytes = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        text += decoder.decode(value, { stream: true });
        countEl.textContent = `Downloading channel list… ${(bytes / 1048576).toFixed(1)} MB`;
      }
      return text + decoder.decode();
    } catch (err) {
      throw ctrl.signal.aborted ? new Error('timed out') : err;
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadPlaylist() {
    loading = true;
    countEl.textContent = 'Downloading channel list…';
    listEl.replaceChildren();
    const urls = prefs.playlist === DEFAULT_PLAYLIST ? [DEFAULT_PLAYLIST, MIRROR_PLAYLIST] : [prefs.playlist];
    let lastErr;
    channels = [];
    for (const url of urls) {
      try {
        channels = parseM3U(await fetchText(url));
        if (channels.length) break;
        lastErr = new Error('no channels found in playlist');
      } catch (err) {
        lastErr = err;
      }
    }
    loading = false;
    if (!channels.length) {
      countEl.textContent = '';
      const retry = el('button', { className: 'btn', textContent: 'Try again' });
      retry.addEventListener('click', loadPlaylist);
      listEl.replaceChildren(el('li', { className: 'empty' },
        `Couldn't download the channel list (${lastErr ? lastErr.message : 'unknown error'}). Check your internet connection and try again.`,
        el('br'), el('br'), retry));
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
    countryEl.value = cCounts.has(prefs.country) ? prefs.country : '';
    if (!gCounts.has(prefs.category)) prefs.category = '';
  }

  // ---------- filtering & rendering ----------
  function applyFilters() {
    if (loading) return;
    let base;
    if (prefs.tab === 'fav') base = channels.filter((c) => favorites.has(c.url));
    else if (prefs.tab === 'recent') base = recent.map((u) => byUrl.get(u)).filter(Boolean);
    else base = channels;

    const q = searchEl.value.trim().toLowerCase();
    const cc = countryEl.value;
    const cat = prefs.category;
    const matching = base.filter((c) =>
      (!q || c.search.includes(q)) &&
      (!cc || c.country === cc) &&
      (!prefs.hideHttp || !c.httpOnly) &&
      (!prefs.hideGeo || !c.geo));
    view = cat ? matching.filter((c) => c.groups.includes(cat)) : matching;
    renderCategories(matching);

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
    $('listToggleLabel').textContent = `Channels (${view.length.toLocaleString()})`;
    renderMore();
  }

  // Category chips, counted over the channels the other filters leave, so they only
  // offer categories that actually have something (e.g. for the chosen country).
  const CAT_ORDER = ['News', 'Sports', 'Movies', 'Series', 'Entertainment', 'Music', 'Kids', 'Documentary', 'General'];
  const CAT_ICONS = {
    News: '📰', Sports: '⚽', Movies: '🎬', Series: '📺', Entertainment: '🎭', Music: '🎵', Kids: '🧸',
    Documentary: '🌍', General: '📡', Religious: '⛪', Education: '🎓', Comedy: '😂', Culture: '🎨',
    Legislative: '🏛️', Animation: '🐭', Lifestyle: '✨', Classic: '🎞️', Shop: '🛍️', Outdoor: '🏕️',
    Business: '💼', Travel: '✈️', Family: '👪', Cooking: '🍳', Public: '📢', Auto: '🚗', Science: '🔬',
    Weather: '⛅', Relax: '🧘', Interactive: '🕹️', Undefined: '❔',
  };
  const catLabel = (g) => (g === 'Undefined' ? 'Other' : g);
  function renderCategories(list) {
    const counts = new Map();
    for (const c of list) for (const g of c.groups) counts.set(g, (counts.get(g) || 0) + 1);
    const rank = (g) => { const i = CAT_ORDER.indexOf(g); return i < 0 ? CAT_ORDER.length + (g === 'Undefined' ? 1 : 0) : i; };
    const groups = [...counts.keys()].sort((a, b) => rank(a) - rank(b) || counts.get(b) - counts.get(a));
    if (prefs.category && !counts.has(prefs.category)) groups.unshift(prefs.category);
    const chip = (value, label, n) => el('button', {
      className: `chip${prefs.category === value ? ' on' : ''}`,
      type: 'button',
      textContent: n == null ? label : `${label} ${n.toLocaleString()}`,
      onclick: () => {
        prefs.category = prefs.category === value ? '' : value;
        savePrefs();
        applyFilters();
      },
    });
    catsEl.replaceChildren(
      chip('', 'All', list.length),
      ...groups.map((g) => chip(g, `${CAT_ICONS[g] || '📺'} ${catLabel(g)}`, counts.get(g) || 0)),
    );
    // Keep the selected chip in view without scrolling the page.
    const on = catsEl.querySelector('.chip.on');
    if (on && on.offsetTop - catsEl.offsetTop === 0) catsEl.scrollLeft = Math.max(0, on.offsetLeft - catsEl.offsetLeft - 40);
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
    if (link) box.append(linkTools(link));
    overlayActions.hidden = !actions;
  }

  const IS_ANDROID = /Android/i.test(navigator.userAgent);

  // Open the system share sheet where the browser supports it, Android's share chooser
  // otherwise, and fall back to copying.
  async function shareText(title, text, fallback) {
    if (navigator.share) {
      try { await navigator.share({ title, text }); return; } catch (err) { if (err && err.name === 'AbortError') return; }
    }
    if (IS_ANDROID) {
      location.href = 'intent:#Intent;action=android.intent.action.SEND;type=text/plain;' +
        `S.android.intent.extra.TEXT=${encodeURIComponent(text)};end`;
      return;
    }
    fallback();
  }

  // Address of a stream plus buttons to copy it, share it, or hand it to VLC.
  function linkTools(url) {
    const field = el('input', { className: 'link-field', value: url, readOnly: true, ariaLabel: 'Stream address' });
    field.addEventListener('focus', () => field.select());
    const note = el('div', { className: 'link-note' });
    const flash = (msg) => { note.textContent = msg; clearTimeout(flash.t); flash.t = setTimeout(() => { note.textContent = ''; }, 2500); };

    const copy = el('button', { className: 'btn', textContent: 'Copy link' });
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(url);
        flash('Link copied');
      } catch {
        field.focus();
        field.select();
        flash(document.execCommand && document.execCommand('copy') ? 'Link copied' : 'Press and hold the link to copy it');
      }
    });

    const buttons = [copy];
    // Always offer Share: the system share sheet where the browser supports it,
    // Android's share chooser otherwise, and copying as the last resort.
    const share = el('button', { className: 'btn', textContent: 'Share' });
    share.addEventListener('click', () => shareText(current ? current.name : 'Free TV', url, () => copy.click()));
    buttons.push(share);
    if (IS_ANDROID) {
      const u = new URL(url);
      const intent = `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.slice(0, -1)};` +
        'package=org.videolan.vlc;type=video/*;' +
        `S.browser_fallback_url=${encodeURIComponent('https://play.google.com/store/apps/details?id=org.videolan.vlc')};end`;
      buttons.push(el('a', { className: 'btn', href: intent, textContent: 'Open in VLC' }));
    }
    return el('div', { className: 'link-tools' }, field, el('div', { className: 'link-buttons' }, ...buttons), note);
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
    showOverlay(msg || "This channel isn't working right now. It may be offline or blocked in your region. You can also try it in VLC:",
      { actions: true, link: current ? current.url : null });
  }

  function select(c, { autoplay = true } = {}) {
    current = c;
    store.set('lastUrl', c.url);
    updateNowPlaying();
    refreshRows();
    scrollToCurrent();
    // HTTP-only channels can't play here anyway, so go straight to the copy/share/VLC options.
    if (autoplay || (IS_HTTPS && c.httpOnly)) {
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
      showOverlay('This channel only offers an insecure (HTTP) stream, which browsers block on secure pages. You can open it in a player such as VLC instead:',
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

  // ---------- collapse the channel list ----------
  function setListCollapsed(collapsed) {
    prefs.listCollapsed = collapsed;
    savePrefs();
    $('listPane').classList.toggle('collapsed', collapsed);
    $('listBody').hidden = collapsed;
    $('listToggle').setAttribute('aria-expanded', String(!collapsed));
    $('listToggleText').textContent = collapsed ? 'Show' : 'Hide';
  }
  $('listToggle').addEventListener('click', () => {
    const collapse = !prefs.listCollapsed;
    setListCollapsed(collapse);
    if (!collapse) scrollToCurrent();
  });
  setListCollapsed(prefs.listCollapsed);

  // ---------- share the app ----------
  const APP_URL = location.origin + location.pathname;
  $('shareAppBtn').addEventListener('click', () => shareText('Free TV', `Free TV, free channels from around the world: ${APP_URL}`, async () => {
    try { await navigator.clipboard.writeText(APP_URL); flashOsd('App link copied'); } catch { flashOsd(APP_URL); }
  }));

  // ---------- install / offline ----------
  // The button is always shown (except inside the installed app): browsers that offer an
  // install prompt get it, everyone else gets the steps for "Add to Home screen".
  let installEvent = null;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  $('installBtn').hidden = standalone;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e;
  });
  window.addEventListener('appinstalled', () => { $('installBtn').hidden = true; });
  $('installBtn').addEventListener('click', async () => {
    if (installEvent) {
      installEvent.prompt();
      await installEvent.userChoice.catch(() => {});
      installEvent = null;
      return;
    }
    const ua = navigator.userAgent;
    const steps = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
      ? 'iPhone / iPad: open this page in Safari, tap the Share button (square with an arrow), then "Add to Home Screen".'
      : IS_ANDROID
        ? 'Android: open the browser menu (⋮ top right) and tap "Install app" or "Add to Home screen".'
        : 'Computer: in Chrome or Edge, click the install icon at the right end of the address bar, or open the menu (⋮) → "Cast, save and share" → "Install page as app".';
    alert(`To install Free TV:\n\n${steps}`);
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').then((reg) => reg.update()).catch(() => {});
    // When a newer version takes over, reload once so the page runs the new code.
    let reloaded = false;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded || (current && !video.paused)) return;
      reloaded = true;
      location.reload();
    });
  }

  loadPlaylist();
})();
