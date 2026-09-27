'use strict';
/* =========================================================================
   Vortex Client Launcher -- Oberflaeche.
   Spricht nur mit window.vortex (preload.js). Jede Antwort hat die Form
   { ok:true, ... } oder { ok:false, error } -- call() macht daraus Werte
   bzw. Fehler, damit nie wieder etwas "still" scheitert.
   Texte: t('English') -> aktuelle Sprache (shared/i18n.js),
          tr(meldung)   -> uebersetzt Meldungen aus dem Hauptprozess.
   ========================================================================= */
(() => {
  const api = window.vortex;
  const I18N = window.VortexI18n;
  const t = (key, ...args) => I18N.t(key, ...args);
  const tr = msg => I18N.tr(msg);
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (name, cls = '') => `<svg class="${cls}"><use href="#i-${name}"/></svg>`;
  const debounce = (fn, ms) => { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); }; };

  async function call(promise) {
    const res = await promise;
    if (!res || res.ok === false) throw new Error(tr(res?.error || 'Something went wrong.'));
    return res;
  }

  const fmtNum = n => {
    n = Number(n) || 0;
    if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`;
    return String(n);
  };
  const fmtGb = mb => { const gb = mb / 1024; return `${Number.isInteger(gb) ? gb : gb.toFixed(2).replace(/0$/, '')} GB`; };
  const fmtSize = b => (b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b ? `${Math.max(1, Math.round(b / 1024))} KB` : t('Folder'));
  const fmtDate = ts => (ts ? new Date(ts).toLocaleString(I18N.locale(), { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  function timeAgo(ts) {
    if (!ts) return t('Never');
    const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 60) return t('Just now');
    if (s < 3600) return t('{0} min ago', Math.floor(s / 60));
    if (s < 86400) return t('{0} h ago', Math.floor(s / 3600));
    const d = Math.floor(s / 86400);
    return d === 1 ? t('Yesterday') : d < 30 ? t('{0} days ago', d) : new Date(ts).toLocaleDateString(I18N.locale());
  }
  const stripFormat = x => String(x || '').replace(/§./g, '').replace(/\s+/g, ' ').trim();

  // -----------------------------------------------------------------------
  // Zustand
  // -----------------------------------------------------------------------
  const newDiscover = () => ({ query: '', page: 0, sort: 'relevance', results: [], hasNext: false, loaded: false, token: 0 });
  const S = {
    appVersion: '', settings: {}, system: {}, account: null, accounts: [], versions: [], servers: [],
    sessions: [], update: { status: 'idle' }, dataRoot: '', website: '', adminVisible: false, discordAvailable: false,
    page: 'home', progress: { stage: 'idle' }, starting: false,
    contentVersion: null, avatars: {}, status: {},
    mods: [], packs: [], shaders: { shaders: [], iris: null },
    modUpdates: {},            // version -> [{file, name, current, latest}]
    discover: { mods: newDiscover(), packs: newDiscover(), shaders: newDiscover() },
    news: null, lastCrash: null, worlds: [], openBackups: new Set(), shots: [],
    skins: { profile: null, library: [], preview: null, loaded: false },
    admin: { status: null, overview: null, staged: [], busy: false }
  };
  const selected = () => S.settings.selectedVersion;
  const versionInfo = v => S.versions.find(x => x.version === v) || null;
  const busyStages = new Set(['auth', 'prepare', 'java', 'download']);
  const isBusy = () => S.starting || busyStages.has(S.progress.stage);
  const mySession = () => S.account && S.sessions.find(s => s.accountId === S.account.id);

  // -----------------------------------------------------------------------
  // Toasts & Dialoge
  // -----------------------------------------------------------------------
  function toast(type, message, actions = []) {
    const root = $('#toasts');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    const ic = type === 'success' ? 'check' : type === 'error' ? 'alert' : 'info';
    el.innerHTML = `${icon(ic)}<div class="t-body"><div>${esc(message)}</div>${actions.length ? '<div class="t-actions"></div>' : ''}</div><button class="icon-btn" style="width:24px;height:24px" title="${esc(t('Close'))}">${icon('x')}</button>`;
    for (const a of actions) {
      const b = document.createElement('button');
      b.className = 'btn small ghost';
      b.textContent = a.label;
      b.onclick = () => { a.run(); close(); };
      $('.t-actions', el).append(b);
    }
    const close = () => { if (!el.isConnected) return; el.classList.add('out'); setTimeout(() => el.remove(), 250); };
    $('.icon-btn', el).onclick = close;
    root.append(el);
    while (root.children.length > 4) root.firstElementChild.remove();
    setTimeout(close, type === 'error' ? 9000 : actions.length ? 10000 : 4500);
  }
  const fail = e => toast('error', e?.message || String(e));

  let modalClose = null;
  function openModal(html, { wide = false, onClose } = {}) {
    const root = $('#modalRoot');
    root.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog">${html}</div>`;
    root.hidden = false;
    const close = () => { root.hidden = true; root.innerHTML = ''; document.removeEventListener('keydown', key); modalClose = null; if (onClose) onClose(); };
    const key = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', key);
    root.onclick = e => { if (e.target === root) close(); };
    modalClose = close;
    return { el: $('.modal', root), close };
  }

  function confirmDialog({ title, text, ok = t('Confirm'), danger = false }) {
    return new Promise(resolve => {
      let done = false;
      const { el, close } = openModal(`<h3>${esc(title)}</h3><p>${esc(text)}</p><div class="row-btns"><button class="btn ghost" data-r="0">${esc(t('Cancel'))}</button><button class="btn ${danger ? 'danger' : ''}" data-r="1">${esc(ok)}</button></div>`,
        { onClose: () => { if (!done) resolve(false); } });
      el.addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (b) { done = true; resolve(b.dataset.r === '1'); close(); } });
      el.addEventListener('keydown', e => { if (e.key === 'Enter') { done = true; resolve(true); close(); } });
      $('[data-r="1"]', el).focus();
    });
  }

  /** Button waehrend einer Aktion sperren und Spinner zeigen. */
  async function busy(btn, fn) {
    if (!btn || btn.disabled) return undefined;
    const html = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>${btn.classList.contains('icon-btn') ? '' : `<span>${esc(btn.textContent.trim())}</span>`}`;
    try { return await fn(); } catch (e) { fail(e); return undefined; } finally { if (btn.isConnected) { btn.disabled = false; btn.innerHTML = html; } }
  }

  // -----------------------------------------------------------------------
  // Konsole
  // -----------------------------------------------------------------------
  const MAX_LINES = 1500;
  const lines = [];
  let consoleFilter = 'all';
  const consoleBody = $('#consoleBody');
  const lineMatches = l => consoleFilter === 'all' || (consoleFilter === 'game' ? l.level === 'game' || l.level === 'error' : l.level === 'error' || l.level === 'warn');
  function lineEl(l) {
    const d = document.createElement('div');
    d.className = `ln ${l.level}`;
    d.innerHTML = `<time>${new Date(l.time).toLocaleTimeString([], { hour12: false })}</time>${esc(l.level === 'game' ? l.text : tr(l.text))}`;
    return d;
  }
  function addLines(batch) {
    if (!Array.isArray(batch) || !batch.length) return;
    const stick = consoleBody.scrollHeight - consoleBody.scrollTop - consoleBody.clientHeight < 40;
    const frag = document.createDocumentFragment();
    for (const l of batch) {
      lines.push(l);
      if (lineMatches(l)) frag.append(lineEl(l));
      if (l.level === 'error' && !$('#console').classList.contains('open')) $('#consoleBadge').hidden = false;
    }
    consoleBody.append(frag);
    if (lines.length > MAX_LINES) {
      lines.splice(0, lines.length - MAX_LINES);
      while (consoleBody.childElementCount > MAX_LINES) consoleBody.firstElementChild.remove();
    }
    if (stick) consoleBody.scrollTop = consoleBody.scrollHeight;
  }
  function redrawConsole() {
    consoleBody.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const l of lines) if (lineMatches(l)) frag.append(lineEl(l));
    consoleBody.append(frag);
    consoleBody.scrollTop = consoleBody.scrollHeight;
  }
  function setConsole(open) {
    $('#console').classList.toggle('open', open);
    $('#console').setAttribute('aria-hidden', String(!open));
    $('#consoleToggle').classList.toggle('on', open);
    if (open) { $('#consoleBadge').hidden = true; consoleBody.scrollTop = consoleBody.scrollHeight; }
  }
  $('#consoleToggle').onclick = () => setConsole(!$('#console').classList.contains('open'));
  $('#consoleClose').onclick = () => setConsole(false);
  $('#consoleClear').onclick = () => { lines.length = 0; consoleBody.innerHTML = ''; };
  $('#consoleCopy').onclick = async () => {
    const text = lines.filter(lineMatches).map(l => `[${new Date(l.time).toLocaleTimeString([], { hour12: false })}] ${l.text}`).join('\n');
    try { await navigator.clipboard.writeText(text); toast('success', t('Console copied to the clipboard.')); } catch (e) { fail(e); }
  };
  $('#consoleFile').onclick = () => call(api.open('log')).catch(fail);
  $('#consoleFilter').onclick = e => {
    const b = e.target.closest('button[data-value]');
    if (!b) return;
    consoleFilter = b.dataset.value;
    $$('#consoleFilter button').forEach(x => x.classList.toggle('active', x === b));
    redrawConsole();
  };

  // -----------------------------------------------------------------------
  // Navigation
  // -----------------------------------------------------------------------
  function showPage(page) {
    if (!$(`#page-${page}`)) return;
    if (page === 'admin') $('#navAdmin').hidden = false;
    S.page = page;
    $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === page));
    $$('.page').forEach(p => p.classList.toggle('active', p.id === `page-${page}`));
    $('.content').scrollTop = 0;
    renderPage(page, true);
  }
  $$('.nav-item').forEach(n => n.addEventListener('click', () => showPage(n.dataset.page)));
  document.addEventListener('click', e => {
    const go = e.target.closest('[data-goto]');
    if (go) { showPage(go.dataset.goto); return; }
    const ext = e.target.closest('[data-external]');
    if (ext) call(api.openExternal(ext.dataset.external)).catch(fail);
  });

  function renderPage(page, entering = false) {
    switch (page) {
      case 'home': renderHome(); if (entering) { refreshStatuses(S.servers.slice(0, 3)); loadNews(); } break;
      case 'versions': renderVersions(); break;
      case 'mods': renderChips(); if (entering) loadMods(); break;
      case 'packs': renderChips(); if (entering) loadPacks(); break;
      case 'shaders': renderChips(); if (entering) loadShaders(); break;
      case 'worlds': renderChips(); if (entering) loadWorlds(); break;
      case 'shots': renderChips(); if (entering) loadShots(); break;
      case 'servers': renderServers(); if (entering) refreshStatuses(S.servers); break;
      case 'skins': if (entering) enterSkins(); break;
      case 'settings': renderSettings(); break;
      case 'admin': if (entering) loadAdmin(); else renderAdmin(); break;
    }
    if (page !== 'skins') pauseSkinViewer();
  }

  // Tabs (Mods / Packs / Shaders)
  $$('[data-tabs]').forEach(group => {
    const kind = group.dataset.tabs;
    group.addEventListener('click', e => {
      const tab = e.target.closest('.tab');
      if (!tab) return;
      $$('.tab', group).forEach(x => x.classList.toggle('active', x === tab));
      $$(`[data-panel^="${kind}-"]`).forEach(p => p.classList.toggle('active', p.dataset.panel === `${kind}-${tab.dataset.tab}`));
      if (tab.dataset.tab === 'discover' && !S.discover[kind].loaded) runSearch(kind, true);
      if (tab.dataset.tab === 'discover') setTimeout(() => $(`#${kind}Query`).focus(), 30);
    });
  });
  const discoverActive = kind => $(`[data-panel="${kind}-discover"]`).classList.contains('active');

  // -----------------------------------------------------------------------
  // Titelleiste
  // -----------------------------------------------------------------------
  $('#wbMin').onclick = () => api.window.minimize();
  $('#wbMax').onclick = () => api.window.maximize();
  $('#wbClose').onclick = () => api.window.close();
  $('.titlebar').addEventListener('dblclick', e => { if (!e.target.closest('.window-buttons')) api.window.maximize(); });
  api.window.onState(s => { $('#wbMax').title = s?.maximized ? t('Restore') : t('Maximize'); });

  function renderTitlebar() {
    const el = $('#titlebarStatus');
    if (isBusy()) el.textContent = tr(S.progress.label || 'Starting Minecraft…');
    else if (S.sessions.length) el.textContent = S.sessions.map(s => `Minecraft ${s.version} · ${s.username}`).join('   |   ');
    else el.textContent = '';
  }

  // -----------------------------------------------------------------------
  // Konto
  // -----------------------------------------------------------------------
  async function avatarFor(acc, force = false) {
    if (!acc) return null;
    if (!force && acc.id in S.avatars) return S.avatars[acc.id];
    S.avatars[acc.id] = S.avatars[acc.id] || null;
    try { const r = await call(api.account.avatar(acc.id)); S.avatars[acc.id] = r.avatar || null; } catch (_) {}
    return S.avatars[acc.id];
  }
  const avatarHtml = acc => {
    const src = acc && S.avatars[acc.id];
    return `<div class="avatar">${src ? `<img src="${esc(src)}" alt="" />` : icon('user')}</div>`;
  };

  let accountMenuOpen = false;
  function renderAccount() {
    const root = $('#account');
    if (!S.account) {
      root.innerHTML = `<button class="account-signin" id="signIn">${icon('user')}${esc(t('Sign in with Microsoft'))}</button>`;
      $('#signIn').onclick = e => login(e.currentTarget);
      return;
    }
    const acc = S.account;
    const playing = S.sessions.some(s => s.accountId === acc.id);
    root.innerHTML = `
      <button class="account-btn" id="accBtn">${avatarHtml(acc)}
        <span class="account-name"><strong>${esc(acc.username)}</strong><span>${playing ? `<i class="dot on"></i>${esc(t('Playing'))}` : esc(t('Microsoft account'))}</span></span>
        ${icon('chevron')}
      </button>
      <div class="account-menu" id="accMenu" ${accountMenuOpen ? '' : 'hidden'}>
        <p>${esc(t('ACCOUNTS'))}</p>
        ${S.accounts.map(a => `
          <div class="acc-row" data-id="${esc(a.id)}">
            ${avatarHtml(a)}<span>${esc(a.username)}</span>
            ${a.id === acc.id ? icon('check', 'tick') : ''}
            <button class="icon-btn rm" data-remove="${esc(a.id)}" title="${esc(t('Sign out'))}">${icon('trash')}</button>
          </div>`).join('')}
        <button class="acc-add" id="accAdd">${icon('plus')}${esc(t('Add another account'))}</button>
      </div>`;
    $('#accBtn').onclick = e => { e.stopPropagation(); accountMenuOpen = !accountMenuOpen; $('#accMenu').hidden = !accountMenuOpen; };
    $('#accMenu').onclick = async e => {
      e.stopPropagation();
      const rm = e.target.closest('[data-remove]');
      if (rm) {
        const a = S.accounts.find(x => x.id === rm.dataset.remove);
        if (!a || !(await confirmDialog({ title: t('Sign out?'), text: t('{0} will be removed from this launcher. You can sign in again at any time.', a.username), ok: t('Sign out'), danger: true }))) return;
        try { applyAccounts(await call(api.account.remove(a.id))); toast('info', t('{0} signed out.', a.username)); } catch (err) { fail(err); }
        return;
      }
      if (e.target.closest('#accAdd')) { accountMenuOpen = false; login(e.target.closest('#accAdd')); return; }
      const row = e.target.closest('.acc-row');
      if (row && row.dataset.id !== acc.id) {
        try { applyAccounts(await call(api.account.select(row.dataset.id))); accountMenuOpen = false; renderAccount(); } catch (err) { fail(err); }
      }
    };
    for (const a of S.accounts) if (!(a.id in S.avatars)) avatarFor(a).then(src => { if (src) renderAccount(); });
  }
  document.addEventListener('click', () => {
    if (accountMenuOpen) { accountMenuOpen = false; const m = $('#accMenu'); if (m) m.hidden = true; }
    const vp = $('#vpMenu'); if (vp && !vp.hidden) vp.hidden = true;
  });

  function applyAccounts(r) {
    if (!r) return;
    const before = S.account?.id;
    S.account = r.account || null;
    S.accounts = r.accounts || [];
    if (typeof r.adminVisible === 'boolean') { S.adminVisible = r.adminVisible; $('#navAdmin').hidden = !S.adminVisible && S.page !== 'admin'; }
    renderAccount();
    renderHome();
    if (S.page === 'skins' && before !== S.account?.id) enterSkins();
  }

  async function login(btn) {
    toast('info', t('A Microsoft sign-in window opens. Finish the sign-in there.'));
    await busy(btn, async () => {
      const r = await call(api.account.login());
      applyAccounts(r);
      toast('success', t('Signed in as {0}.', r.account.username));
    });
  }

  // -----------------------------------------------------------------------
  // Home
  // -----------------------------------------------------------------------
  const FALLBACK_NEWS = [
    'Launcher 2.0: completely rebuilt, new design in the Vortex colours.',
    'New Vortex versions are downloaded automatically.',
    'Skins, shaders, worlds with backups, screenshots and mod updates.',
    'Crash analysis explains what went wrong.'
  ];

  function versionTag(info) {
    if (!info?.vortex) return { text: 'Fabric', plain: true };
    return { text: `Vortex ${info.clientVersion || ''}`.trim(), plain: false };
  }

  function renderHome() {
    const v = selected();
    const info = versionInfo(v);
    const tag = versionTag(info);
    $('#vpValue').textContent = v || '—';
    $('#vpTag').textContent = tag.text;
    $('#vpTag').classList.toggle('plain', tag.plain);

    const running = mySession();
    if (running) {
      $('#heroEyebrow').textContent = `MINECRAFT ${running.version} · ${t('RUNNING')}`;
      $('#heroTitle').innerHTML = t('Have fun, {0}.', `<em>${esc(running.username)}</em>`);
      $('#heroSub').textContent = t('The launcher stays in the background. Close Minecraft or press stop to end the session.');
    } else if (info?.vortex) {
      $('#heroEyebrow').textContent = `VORTEX CLIENT ${info.clientVersion || ''}${info.addonVersion ? ` · ADDON ${info.addonVersion}` : ''}`;
      $('#heroTitle').innerHTML = S.account ? t('Ready when you are,<br>{0}.', `<em>${esc(S.account.username)}</em>`) : t('Ready when <em>you</em> are.');
      $('#heroSub').textContent = info.addonVersion
        ? t('Minecraft {0} with Fabric, the Vortex Client, the Plus Addon and your mods — set up in one click.', v)
        : t('Minecraft {0} with Fabric, the Vortex Client and your mods — set up in one click.', v);
    } else {
      $('#heroEyebrow').textContent = `MINECRAFT ${v || ''} · FABRIC`;
      $('#heroTitle').innerHTML = t('Play {0}.', `<em>${esc(v || '')}</em>`);
      $('#heroSub').textContent = t('A plain Fabric instance with its own mods folder. The Vortex Client is only available for Vortex versions.');
    }
    renderPlay();
    renderVersionMenu();
    renderQuickServers();
    renderInstanceCard();
    renderNews();
    renderCrashBanner();
  }

  function renderPlay() {
    const btn = $('#playBtn');
    const running = mySession();
    const b = isBusy();
    btn.classList.toggle('busy', b);
    btn.classList.toggle('running', !b && Boolean(running));
    const pct = S.progress.percent;
    btn.classList.toggle('indet', b && (pct == null));
    $('#playFill').style.width = b && pct != null ? `${pct}%` : '0%';
    $('#stopBtn').hidden = !running;
    if (b) {
      $('#playLabel').textContent = pct != null ? `${pct}%` : t('STARTING');
      $('#playSub').textContent = tr(S.progress.label || 'Preparing…');
    } else if (running) {
      $('#playLabel').textContent = t('RUNNING');
      $('#playSub').textContent = `Minecraft ${running.version} · ${running.username}`;
    } else if (!S.account) {
      $('#playLabel').textContent = t('SIGN IN');
      $('#playSub').textContent = t('Microsoft account needed');
    } else {
      const info = versionInfo(selected());
      $('#playLabel').textContent = t('PLAY');
      $('#playSub').textContent = info && !info.installed ? t('Minecraft {0} · first start downloads the game', selected()) : `Minecraft ${selected()}`;
    }
    $('#vpButton').disabled = b;
    renderTitlebar();
  }

  async function play(serverId = null, version = selected()) {
    if (isBusy()) return;
    if (!S.account) { login($('#playBtn')); return; }
    if (mySession()) return;
    S.starting = true;
    S.progress = { stage: 'auth', label: 'Checking your account', percent: null };
    renderPlay();
    try {
      await call(api.launch.start(version, serverId));
    } catch (e) {
      toast('error', e.message, [{ label: t('Open console'), run: () => setConsole(true) }]);
      S.progress = { stage: 'idle' };
    } finally {
      S.starting = false;
      renderPlay();
      renderAccount();
    }
  }
  $('#playBtn').onclick = () => { if (!mySession()) play(); };
  $('#stopBtn').onclick = async () => {
    const s = mySession();
    if (!s || !(await confirmDialog({ title: t('Stop Minecraft?'), text: t('Minecraft {0} ({1}) is closed immediately. Unsaved progress in singleplayer can be lost.', s.version, s.username), ok: t('Stop'), danger: true }))) return;
    call(api.launch.stop(s.id)).catch(fail);
  };

  // Versionsauswahl
  function renderVersionMenu() {
    $('#vpMenu').innerHTML = S.versions.map(x => `
      <button class="vp-item" data-v="${esc(x.version)}">
        <b>${esc(x.version)}</b>
        <span>${x.vortex ? `Vortex ${esc(x.clientVersion || '')}${x.addonVersion ? ' + Addon' : ''}` : 'Fabric'}${x.installed ? '' : ` · ${esc(t('not downloaded'))}`}</span>
        ${x.version === selected() ? icon('check', 'tick') : ''}
      </button>`).join('');
  }
  $('#vpButton').onclick = e => { e.stopPropagation(); if (!isBusy()) $('#vpMenu').hidden = !$('#vpMenu').hidden; };
  $('#vpMenu').onclick = e => {
    e.stopPropagation();
    const item = e.target.closest('[data-v]');
    if (!item) return;
    $('#vpMenu').hidden = true;
    selectVersion(item.dataset.v);
  };
  async function selectVersion(v) {
    try {
      const r = await call(api.versions.select(v));
      S.settings = r.settings;
      S.contentVersion = v;
      renderHome();
      if (S.page === 'versions') renderVersions();
      updateNavBadge();
    } catch (e) { fail(e); }
  }

  // Schnell beitreten
  function serverStatusLine(s) {
    const st = S.status[s.id] || s.status;
    if (!st) return `<i class="dot"></i>${esc(t('Checking…'))}`;
    if (!st.online) return `<i class="dot off"></i>${esc(t('Offline'))}`;
    return `<i class="dot on"></i>${esc(t('{0} / {1} online', fmtNum(st.players?.online), fmtNum(st.players?.max)))}`;
  }
  const favHtml = s => {
    const st = S.status[s.id] || s.status;
    return st?.favicon ? `<div class="fav"><img src="${esc(st.favicon)}" alt="" /></div>` : `<div class="fav">${icon('server')}</div>`;
  };
  function renderQuickServers() {
    $('#quickServers').innerHTML = S.servers.slice(0, 3).map(s => `
      <div class="qs">${favHtml(s)}
        <div class="qs-body"><strong>${esc(s.name)}</strong><span>${serverStatusLine(s)}</span></div>
        <button class="btn small" data-join="${esc(s.id)}">${icon('play')}${esc(t('Join'))}</button>
      </div>`).join('') || `<p class="muted small">${esc(t('No servers yet.'))}</p>`;
  }
  document.addEventListener('click', e => {
    const j = e.target.closest('[data-join]');
    if (!j) return;
    if (mySession()) { toast('info', t('You are already playing with this account. Close Minecraft first or switch accounts.')); return; }
    play(j.dataset.join);
  });

  function renderInstanceCard() {
    const v = selected();
    const info = versionInfo(v);
    if (!info) { $('#instanceCard').innerHTML = ''; return; }
    const sub = info.vortex ? `Vortex ${esc(info.clientVersion || '')}${info.addonVersion ? ` + Addon ${esc(info.addonVersion)}` : ''}` : esc(t('Fabric instance'));
    $('#instanceCard').innerHTML = `
      <div class="inst-top"><div class="inst-badge">${esc(v)}</div><div><strong>Minecraft ${esc(v)}</strong><span>${sub}</span></div></div>
      <div class="stats">
        <div class="stat"><span>${esc(t('MODS'))}</span><b>${info.modCount}</b></div>
        <div class="stat"><span>${esc(t('PLAYED'))}</span><b style="font-size:13px">${esc(timeAgo(info.lastPlayed))}</b></div>
        <div class="stat"><span>${esc(t('STATUS'))}</span><b style="font-size:13px">${esc(info.installed ? t('Ready') : t('Not downloaded'))}</b></div>
      </div>
      <div class="row-btns">
        <button class="btn small ghost" data-open="instance">${icon('folder')}${esc(t('Folder'))}</button>
        <button class="btn small ghost" data-goto="worlds">${icon('map')}${esc(t('Worlds'))}</button>
        <button class="btn small ghost" data-goto="mods">${icon('cube')}${esc(t('Mods'))}</button>
      </div>`;
  }
  document.addEventListener('click', e => {
    const o = e.target.closest('[data-open]');
    if (o) call(api.open(o.dataset.open, o.dataset.version || selected())).catch(fail);
  });

  // News
  async function loadNews() {
    try { S.news = (await call(api.news())).items; } catch (_) { S.news = S.news || []; }
    renderNews();
  }
  function renderNews() {
    $('#newsVersion').textContent = `v${S.appVersion}`;
    const items = S.news || [];
    if (!items.length) { $('#newsList').innerHTML = FALLBACK_NEWS.map(n => `<li><span>${esc(t(n))}</span></li>`).join(''); return; }
    const label = { news: t('NEWS'), update: t('UPDATE'), launcher: 'LAUNCHER' };
    $('#newsList').innerHTML = items.slice(0, 5).map(n => `
      <li><span><i class="nk ${esc(n.kind)}">${esc(label[n.kind] || '')}</i><b>${esc(n.title)}</b>
        ${(n.lines || []).slice(0, 2).map(l => `<small>${esc(tr(l))}</small>`).join('')}
        <small>${esc(timeAgo(n.date))}</small></span></li>`).join('');
  }

  // Absturz-Hinweis
  function renderCrashBanner() {
    const c = S.lastCrash;
    const show = Boolean(c) && !c.dismissed;
    $('#crashBanner').hidden = !show;
    if (!show) return;
    $('#crashBannerTitle').textContent = t('Minecraft {0} crashed', c.version);
    $('#crashBannerText').textContent = c.findings?.[0] ? tr(c.findings[0].title) : '';
  }
  $('#crashBannerOpen').onclick = () => { if (S.lastCrash) showCrash(S.lastCrash); };
  $('#crashBannerClose').onclick = () => { if (S.lastCrash) S.lastCrash.dismissed = true; renderCrashBanner(); };

  function showCrash(a) {
    const findings = a.findings || [];
    const { el, close } = openModal(`
      <h3>${icon('alert')} ${esc(t('Why Minecraft {0} crashed', a.version))}</h3>
      <p>${esc(a.code != null ? t('Exit code {0}.', a.code) : '')} ${esc(t('The launcher checked the crash report and the log:'))}</p>
      <div class="findings">${findings.map((f, i) => `
        <div class="finding ${f.severity === 'warn' ? 'warn' : ''}">${icon(f.severity === 'warn' ? 'info' : 'alert')}
          <div><strong>${esc(tr(f.title))}</strong><p>${esc(tr(f.detail || ''))}</p>
          ${f.actions?.length ? `<div class="row-btns">${f.actions.map((ac, j) => `<button class="btn small ${j ? 'ghost' : ''}" data-f="${i}" data-a="${j}">${esc(tr(ac.label))}</button>`).join('')}</div>` : ''}</div>
        </div>`).join('')}</div>
      ${a.excerpt ? `<details class="excerpt"><summary>${esc(t('Show crash report excerpt'))}</summary><pre>${esc(a.excerpt)}</pre></details>` : ''}
      <div class="row-btns">
        <button class="btn ghost" data-x="console">${icon('terminal')}${esc(t('Console'))}</button>
        ${a.report ? `<button class="btn ghost" data-x="reports">${icon('folder')}${esc(t('Crash reports'))}</button>` : ''}
        <span class="grow"></span>
        <button class="btn" data-x="close">${esc(t('Close'))}</button>
      </div>`, { wide: true });
    el.addEventListener('click', async e => {
      const x = e.target.closest('[data-x]');
      if (x) {
        if (x.dataset.x === 'console') { close(); setConsole(true); }
        if (x.dataset.x === 'reports') call(api.open('crashes', a.version)).catch(fail);
        if (x.dataset.x === 'close') close();
        return;
      }
      const b = e.target.closest('[data-f]');
      if (!b) return;
      const action = findings[+b.dataset.f]?.actions?.[+b.dataset.a];
      if (action) await busy(b, () => runCrashAction(action, a.version, close));
    });
  }

  async function runCrashAction(action, version, close) {
    switch (action.type) {
      case 'disableMod':
        await call(api.mods.toggle(version, action.file));
        toast('success', t('Mod disabled. Press Play to try again.'));
        refreshVersions();
        break;
      case 'installMod': {
        const r = await call(api.mods.install(action.project, version));
        toast('success', r.installed.length ? t('{0} installed.', action.project) : t('{0} is already installed.', action.project));
        refreshVersions();
        break;
      }
      case 'checkUpdates':
        close(); S.contentVersion = version; showPage('mods'); await checkModUpdates(null, version); break;
      case 'openMods': close(); S.contentVersion = version; showPage('mods'); break;
      case 'openCrash': await call(api.open('crashes', version)); break;
      case 'moreRam': {
        const next = Math.min((S.system.maxAllowedMb || 8192), (S.settings.memoryMax || 4096) + 1024);
        await saveSettings({ memoryMax: next });
        toast('success', t('Minecraft now gets {0}.', fmtGb(S.settings.memoryMax)));
        break;
      }
      case 'lessRam': {
        await saveSettings({ memoryMax: Math.max(2048, (S.settings.memoryMax || 4096) - 1024) });
        toast('success', t('Minecraft now gets {0}.', fmtGb(S.settings.memoryMax)));
        break;
      }
      case 'javaAuto': await saveSettings({ javaPath: '' }); toast('success', t('Java is chosen automatically again.')); break;
      default: break;
    }
  }

  // -----------------------------------------------------------------------
  // Versionen
  // -----------------------------------------------------------------------
  function renderVersions() {
    $('#versionGrid').innerHTML = S.versions.map(x => {
      const sel = x.version === selected();
      const badges = [
        x.vortex ? '<span class="badge v">VORTEX</span>' : '<span class="badge">FABRIC</span>',
        x.addonVersion ? '<span class="badge v">ADDON</span>' : '',
        x.clientSource === 'online' || x.addonSource === 'online' ? `<span class="badge w" title="${esc(t('Downloaded from the Vortex team'))}">${esc(t('UPDATED'))}</span>` : '',
        x.custom ? `<span class="badge b">${esc(t('CUSTOM'))}</span>` : '',
        x.installed ? `<span class="badge ok">${esc(t('READY'))}</span>` : `<span class="badge">${esc(t('NOT DOWNLOADED'))}</span>`
      ].join('');
      const sub = x.vortex ? `Vortex Client ${esc(x.clientVersion || '')}${x.addonVersion ? ` · Addon ${esc(x.addonVersion)}` : ''}` : esc(t('Fabric with your own mods'));
      return `
        <article class="card vcard ${sel ? 'selected' : ''}">
          <div class="v-num">${esc(x.version)}</div>
          <div class="v-sub">${sub}</div>
          <div class="badges">${badges}</div>
          <div class="muted small" style="margin-bottom:14px">${esc(t('{0} mods', x.modCount))}${x.disabledCount ? ` · ${esc(t('{0} off', x.disabledCount))}` : ''} · ${esc(t('played {0}', timeAgo(x.lastPlayed).toLowerCase()))}</div>
          <div class="row-btns">
            ${sel ? `<button class="btn small done">${icon('check')}${esc(t('Selected'))}</button>` : `<button class="btn small" data-vselect="${esc(x.version)}">${esc(t('Select'))}</button>`}
            <button class="icon-btn" title="${esc(t('Open folder'))}" data-open="instance" data-version="${esc(x.version)}">${icon('folder')}</button>
            <button class="icon-btn" title="${esc(t('Export as modpack'))}" data-vexport="${esc(x.version)}">${icon('upload')}</button>
            <button class="icon-btn" title="${esc(t('Check & repair'))}" data-vrepair="${esc(x.version)}">${icon('refresh')}</button>
            ${x.custom ? `<button class="icon-btn" title="${esc(t('Remove from list'))}" data-vremove="${esc(x.version)}">${icon('trash')}</button>` : ''}
          </div>
        </article>`;
    }).join('');
  }
  $('#versionGrid').addEventListener('click', async e => {
    const s = e.target.closest('[data-vselect]');
    if (s) { await selectVersion(s.dataset.vselect); toast('success', t('Minecraft {0} selected.', s.dataset.vselect)); return; }
    const r = e.target.closest('[data-vrepair]');
    if (r) { await busy(r, async () => { const res = await call(api.versions.repair(r.dataset.vrepair)); S.versions = res.versions; }); renderVersions(); return; }
    const x = e.target.closest('[data-vexport]');
    if (x) { exportDialog(x.dataset.vexport); return; }
    const d = e.target.closest('[data-vremove]');
    if (d) {
      const v = d.dataset.vremove;
      if (!(await confirmDialog({ title: t('Remove {0}?', v), text: t('The version disappears from the list. Its folder with worlds and mods stays on your PC.'), ok: t('Remove'), danger: true }))) return;
      try { const res = await call(api.versions.remove(v)); S.versions = res.versions; S.settings = res.settings; renderVersions(); renderHome(); } catch (err) { fail(err); }
    }
  });
  $('#addVersionForm').onsubmit = async e => {
    e.preventDefault();
    const input = $('#addVersionInput');
    const v = input.value.trim();
    if (!v) { input.focus(); return; }
    await busy($('button', e.target), async () => {
      const r = await call(api.versions.add(v));
      S.versions = r.versions;
      S.settings.selectedVersion = r.version;
      input.value = '';
      toast('success', t('Minecraft {0} added and selected. The first start downloads it.', r.version));
      renderVersions(); renderHome();
    });
  };

  function exportDialog(version) {
    const { el, close } = openModal(`
      <h3>${esc(t('Export Minecraft {0}', version))}</h3>
      <p>${esc(t('Creates a .mrpack file you can share. Friends import it here or in any Modrinth-compatible launcher. Mods from Modrinth are only linked; Vortex files are not included.'))}</p>
      <label class="opt"><span class="switch"><input type="checkbox" id="exCfg" checked /><i></i></span>${esc(t('Mod settings (config folder)'))}</label>
      <label class="opt"><span class="switch"><input type="checkbox" id="exOpt" /><i></i></span>${esc(t('Minecraft options (keybinds, video)'))}</label>
      <label class="opt"><span class="switch"><input type="checkbox" id="exRp" /><i></i></span>${esc(t('Resource packs'))}</label>
      <label class="opt"><span class="switch"><input type="checkbox" id="exSh" /><i></i></span>${esc(t('Shader packs'))}</label>
      <div class="row-btns" style="margin-top:16px"><button class="btn ghost" data-c>${esc(t('Cancel'))}</button><button class="btn" data-go>${icon('upload')}${esc(t('Export'))}</button></div>`);
    $('[data-c]', el).onclick = close;
    $('[data-go]', el).onclick = e => busy(e.currentTarget, async () => {
      const r = await call(api.pack.export(version, { config: $('#exCfg').checked, options: $('#exOpt').checked, resourcePacks: $('#exRp').checked, shaders: $('#exSh').checked }));
      if (r.canceled) return;
      close();
      toast('success', t('Exported: {0} mods linked, {1} files included.', r.linked, r.overrides));
    });
  }

  async function importPack(file = null) {
    const btn = $('#importPack');
    await busy(btn, async () => {
      toast('info', t('Importing the modpack… this can take a moment.'));
      const r = await call(api.pack.import(file));
      if (r.canceled) return;
      S.versions = r.versions;
      renderVersions(); renderVersionMenu();
      toast('success', t('Modpack imported into Minecraft {0}: {1} files.', r.version, r.added), [{ label: t('Select'), run: () => selectVersion(r.version) }]);
      if (r.failed?.length) toast('error', t('{0} files could not be downloaded.', r.failed.length));
    });
  }
  $('#importPack').onclick = () => importPack();

  // -----------------------------------------------------------------------
  // Inhalte: Instanz-Auswahl
  // -----------------------------------------------------------------------
  const contentVersion = () => (S.versions.some(x => x.version === S.contentVersion) ? S.contentVersion : selected());
  function renderChips() {
    const cv = contentVersion();
    $$('[data-instance-chip]').forEach(chip => {
      chip.innerHTML = `<span class="muted small">${esc(t('Instance'))}</span><select class="select">${S.versions.map(x => `<option value="${esc(x.version)}" ${x.version === cv ? 'selected' : ''}>Minecraft ${esc(x.version)}${x.vortex ? ' · Vortex' : ''}</option>`).join('')}</select>`;
      $('select', chip).onchange = ev => {
        S.contentVersion = ev.target.value;
        renderChips();
        for (const k of Object.keys(S.discover)) S.discover[k] = newDiscover();
        renderPage(S.page, true);
        for (const k of ['mods', 'packs', 'shaders']) if (S.page === k && discoverActive(k)) runSearch(k, true);
      };
    });
  }

  const emptyHtml = (ic, title, text) => `<div class="empty">${icon(ic)}<strong>${esc(title)}</strong>${esc(text)}</div>`;
  const skeletons = n => Array.from({ length: n }, () => '<div class="skeleton"></div>').join('');

  // -----------------------------------------------------------------------
  // Mods
  // -----------------------------------------------------------------------
  async function loadMods() {
    const v = contentVersion();
    try { S.mods = (await call(api.mods.list(v))).mods; } catch (e) { S.mods = []; fail(e); }
    renderMods();
  }
  const SRC_LABEL = { vortex: 'VORTEX', addon: 'ADDON', bundled: 'INCLUDED', modrinth: 'MODRINTH', local: 'LOCAL' };
  function renderMods() {
    const v = contentVersion();
    const updates = S.modUpdates[v] || [];
    const f = $('#modsFilter').value.trim().toLowerCase();
    const list = S.mods.filter(m => !f || `${m.name} ${m.file} ${m.description}`.toLowerCase().includes(f));
    $('#modsCount').textContent = S.mods.length;
    $('#modsUpdateBanner').hidden = !updates.length;
    $('#modsUpdateText').textContent = updates.length === 1 ? t('1 update available.') : t('{0} updates available.', updates.length);
    if (!S.mods.length) { $('#modsList').innerHTML = emptyHtml('cube', t('No mods yet'), t('Find mods under “Discover” or add your own .jar files.')); return; }
    if (!list.length) { $('#modsList').innerHTML = emptyHtml('search', t('Nothing found'), t('No installed mod matches your filter.')); return; }
    $('#modsList').innerHTML = list.map(m => {
      const img = m.icon || m.iconUrl;
      const upd = updates.find(u => u.file === m.file);
      const lockTitle = m.source === 'addon' ? t('Switch the addon on or off in Settings') : t('Managed by the Vortex launcher');
      return `
      <div class="item ${m.enabled ? '' : 'off'}" data-file="${esc(m.file)}">
        <div class="icon ${m.icon ? 'pixel' : ''}">${img ? `<img src="${esc(img)}" alt="" loading="lazy" />` : icon('cube')}</div>
        <div class="item-body">
          <div class="item-title"><strong>${esc(m.name)}</strong><span class="ver">${esc(m.version)}</span><span class="src ${m.source}">${esc(t(SRC_LABEL[m.source] || ''))}</span>${upd ? `<span class="upd-chip">${icon('arrow-up')}${esc(upd.latest)}</span>` : ''}</div>
          <div class="item-desc">${esc(m.description || m.file)}${m.authors?.length ? ` · ${esc(t('by {0}', m.authors.slice(0, 2).join(', ')))}` : ''}</div>
        </div>
        <div class="item-actions">
          ${upd ? `<button class="btn small" data-update title="${esc(`${upd.current} → ${upd.latest}`)}">${icon('download')}${esc(t('Update'))}</button>` : ''}
          ${m.managed
            ? `<span class="lock" title="${esc(lockTitle)}">${icon('lock')}</span>`
            : `<label class="switch" title="${esc(m.enabled ? t('Disable') : t('Enable'))}"><input type="checkbox" data-toggle ${m.enabled ? 'checked' : ''} /><i></i></label>
               <button class="icon-btn" data-remove title="${esc(t('Move to recycle bin'))}">${icon('trash')}</button>`}
        </div>
      </div>`;
    }).join('');
  }
  $('#modsFilter').addEventListener('input', renderMods);
  $('#modsList').addEventListener('change', async e => {
    if (!e.target.matches('[data-toggle]')) return;
    const file = e.target.closest('.item').dataset.file;
    e.target.disabled = true;
    try { await call(api.mods.toggle(contentVersion(), file)); } catch (err) { fail(err); }
    delete S.modUpdates[contentVersion()];
    await loadMods();
    refreshVersions();
  });
  $('#modsList').addEventListener('click', async e => {
    const up = e.target.closest('[data-update]');
    if (up) {
      const file = up.closest('.item').dataset.file;
      await busy(up, () => applyModUpdates([file]));
      return;
    }
    const b = e.target.closest('[data-remove]');
    if (!b) return;
    const m = S.mods.find(x => x.file === b.closest('.item').dataset.file);
    if (!m || !(await confirmDialog({ title: t('Remove {0}?', m.name), text: t('The file is moved to the recycle bin, so you can restore it if needed.'), ok: t('Remove'), danger: true }))) return;
    try { await call(api.mods.remove(contentVersion(), m.file)); toast('success', t('{0} removed.', m.name)); } catch (err) { fail(err); }
    const v = contentVersion();
    if (S.modUpdates[v]) S.modUpdates[v] = S.modUpdates[v].filter(u => u.file !== m.file);
    await loadMods();
    refreshVersions();
    updateNavBadge();
    S.discover.mods.results.forEach(r => { if (r.projectId === m.projectId) r.installed = false; });
    renderResults('mods');
  });
  $('#modsImport').onclick = e => busy(e.currentTarget, async () => {
    const r = await call(api.mods.importFiles(contentVersion()));
    reportImport(r);
  });
  function reportImport(r) {
    if (r.added?.length) toast('success', r.added.length === 1 ? t('1 mod added.') : t('{0} mods added.', r.added.length));
    if (r.skipped?.length) toast('info', t('Skipped: {0}', r.skipped.map(tr).join(', ')));
    loadMods();
    refreshVersions();
  }
  $('#modsFolder').onclick = () => call(api.open('mods', contentVersion())).catch(fail);

  async function checkModUpdates(btn, version = contentVersion()) {
    const run = async () => {
      const r = await call(api.mods.checkUpdates(version));
      S.modUpdates[version] = r.updates;
      if (!r.updates.length) toast('success', t('All mods are up to date.'));
      if (S.page === 'mods') { await loadMods(); }
      updateNavBadge();
    };
    return btn ? busy(btn, run) : run().catch(fail);
  }
  $('#modsCheckUpdates').onclick = e => checkModUpdates(e.currentTarget);
  async function applyModUpdates(files) {
    const v = contentVersion();
    const r = await call(api.mods.applyUpdates(v, files));
    if (r.updated.length) toast('success', r.updated.length === 1 ? t('{0} updated to {1}.', r.updated[0].name, r.updated[0].version) : t('{0} mods updated.', r.updated.length));
    if (r.failed.length) toast('error', t('Could not update: {0}', r.failed.join(', ')));
    const doneNames = new Set(r.updated.map(d => d.name));
    S.modUpdates[v] = (S.modUpdates[v] || []).filter(u => !doneNames.has(u.name));
    await loadMods();
    refreshVersions();
    updateNavBadge();
  }
  $('#modsUpdateAll').onclick = e => busy(e.currentTarget, () => applyModUpdates(null));
  $('#modsPerformance').onclick = async e => {
    const btn = e.currentTarget;
    if (!(await confirmDialog({ title: t('Install the performance pack?'), text: t('Installs Sodium, Lithium and Entity Culling for Minecraft {0}. They make the game noticeably faster. If a Vortex module misbehaves afterwards, disable Sodium first.', contentVersion()), ok: t('Install') }))) return;
    await busy(btn, async () => {
      const r = await call(api.mods.performance(contentVersion()));
      toast('success', t('Installed: {0}', r.installed.join(', ')));
      if (r.unavailable.length) toast('info', t('Not available for this version yet: {0}', r.unavailable.join(', ')));
      await loadMods();
      refreshVersions();
    });
  };
  function updateNavBadge() {
    const n = (S.modUpdates[selected()] || []).length;
    const el = $('#modsUpdateBadge');
    el.hidden = !n;
    el.textContent = String(n);
  }

  // -----------------------------------------------------------------------
  // Resource Packs & Shader
  // -----------------------------------------------------------------------
  async function loadPacks() {
    try { S.packs = (await call(api.packs.list(contentVersion()))).packs; } catch (e) { S.packs = []; fail(e); }
    renderFileList('packs');
  }
  async function loadShaders() {
    try { S.shaders = await call(api.shaders.list(contentVersion())); } catch (e) { S.shaders = { shaders: [], iris: null }; fail(e); }
    renderIris();
    renderFileList('shaders');
  }
  function renderFileList(kind) {
    const items = kind === 'packs' ? S.packs : S.shaders.shaders;
    $(`#${kind}Count`).textContent = items.length;
    const root = $(`#${kind}List`);
    if (!items.length) {
      root.innerHTML = kind === 'packs'
        ? emptyHtml('image', t('No resource packs yet'), t('Find packs under “Discover” or drop .zip files into the folder.'))
        : emptyHtml('sun', t('No shaders yet'), t('Find shaders under “Discover” or drop .zip files into the folder.'));
      return;
    }
    root.innerHTML = items.map(p => `
      <div class="item" data-file="${esc(p.file)}">
        <div class="icon">${icon(p.folder ? 'folder' : kind === 'packs' ? 'image' : 'sun')}</div>
        <div class="item-body"><div class="item-title"><strong>${esc(p.name)}</strong></div><div class="item-desc">${esc(p.file)} · ${fmtSize(p.size)}</div></div>
        <div class="item-actions"><button class="icon-btn" data-remove title="${esc(t('Move to recycle bin'))}">${icon('trash')}</button></div>
      </div>`).join('');
  }
  for (const kind of ['packs', 'shaders']) {
    $(`#${kind}List`).addEventListener('click', async e => {
      const b = e.target.closest('[data-remove]');
      if (!b) return;
      const file = b.closest('.item').dataset.file;
      if (!(await confirmDialog({ title: kind === 'packs' ? t('Remove resource pack?') : t('Remove shader?'), text: t('{0} is moved to the recycle bin.', file), ok: t('Remove'), danger: true }))) return;
      try { await call((kind === 'packs' ? api.packs : api.shaders).remove(contentVersion(), file)); toast('success', t('Removed.')); } catch (err) { fail(err); }
      kind === 'packs' ? loadPacks() : loadShaders();
    });
  }
  $('#packsFolder').onclick = () => call(api.open('resourcepacks', contentVersion())).catch(fail);
  $('#shadersFolder').onclick = () => call(api.open('shaderpacks', contentVersion())).catch(fail);

  function renderIris() {
    const card = $('#irisCard');
    const iris = S.shaders.iris;
    if (iris && iris.enabled) {
      card.className = 'iris-card ok';
      card.innerHTML = `<div class="ic">${icon('check')}</div><div class="t"><strong>${esc(t('Iris {0} is installed', iris.version))}</strong><p>${esc(t('Shaders are ready. Choose one in Minecraft under Options → Video Settings → Shader Packs.'))}</p></div>`;
      return;
    }
    card.className = 'iris-card';
    card.innerHTML = `<div class="ic">${icon('sun')}</div><div class="t"><strong>${esc(iris ? t('Iris is disabled') : t('Shaders need Iris'))}</strong><p>${esc(t('Iris loads shader packs. It also installs Sodium, which it needs. If a Vortex module misbehaves with Sodium, disable both again.'))}</p></div>
      <button class="btn" id="irisInstall">${icon('download')}${esc(iris ? t('Enable Iris') : t('Install Iris'))}</button>`;
    $('#irisInstall').onclick = e => busy(e.currentTarget, async () => {
      if (iris) {
        const mods = (await call(api.mods.list(contentVersion()))).mods;
        const m = mods.find(x => x.id === 'iris');
        if (m && !m.enabled) await call(api.mods.toggle(contentVersion(), m.file));
      } else {
        const r = await call(api.shaders.iris(contentVersion()));
        if (r.unavailable?.length) throw new Error(t('Iris is not available for Minecraft {0} yet.', contentVersion()));
      }
      toast('success', t('Iris is ready.'));
      await loadShaders();
      refreshVersions();
    });
  }

  // Modrinth-Suche (Mods, Packs, Shader)
  const searchFn = { mods: api.mods.search, packs: api.packs.search, shaders: api.shaders.search };
  const installFn = { mods: api.mods.install, packs: api.packs.install, shaders: api.shaders.install };
  const projectPath = { mods: 'mod', packs: 'resourcepack', shaders: 'shader' };
  async function runSearch(kind, reset) {
    const d = S.discover[kind];
    const token = ++d.token;
    if (reset) { d.page = 0; d.results = []; $(`#${kind}Results`).innerHTML = skeletons(6); $(`#${kind}More`).hidden = true; }
    try {
      const r = await call(searchFn[kind](d.query, contentVersion(), d.page, d.sort));
      if (token !== d.token) return;
      d.results = reset ? r.results : d.results.concat(r.results);
      d.hasNext = r.hasNext;
      d.loaded = true;
    } catch (e) {
      if (token !== d.token) return;
      $(`#${kind}Results`).innerHTML = emptyHtml('alert', t('Modrinth could not be reached'), e.message);
      return;
    }
    renderResults(kind);
  }
  function renderResults(kind) {
    const d = S.discover[kind];
    const root = $(`#${kind}Results`);
    if (!d.loaded) return;
    if (!d.results.length) {
      root.innerHTML = emptyHtml('search', t('No results'), d.query ? t('Nothing on Modrinth for Minecraft {0} matching “{1}”.', contentVersion(), d.query) : t('Nothing on Modrinth for Minecraft {0}.', contentVersion()));
      $(`#${kind}More`).hidden = true;
      return;
    }
    const fallbackIcon = kind === 'mods' ? 'cube' : kind === 'packs' ? 'image' : 'sun';
    root.innerHTML = d.results.map(r => `
      <article class="result" data-id="${esc(r.projectId)}">
        <div class="icon">${r.iconUrl ? `<img src="${esc(r.iconUrl)}" alt="" loading="lazy" />` : icon(fallbackIcon)}</div>
        <div class="result-body">
          <strong>${esc(r.title)}</strong><span class="by">${esc(t('by {0}', r.author || t('unknown')))}</span>
          <p>${esc(r.description)}</p>
          <div class="result-foot">
            <div class="meta"><span>${icon('download')}${fmtNum(r.downloads)}</span><span>${icon('users')}${fmtNum(r.follows)}</span>${r.categories.slice(0, 2).map(c => `<span>${esc(c)}</span>`).join('')}</div>
            <button class="icon-btn" title="${esc(t('Open on Modrinth'))}" data-external="https://modrinth.com/${projectPath[kind]}/${esc(r.slug)}">${icon('external')}</button>
            ${r.installed ? `<button class="btn small done">${icon('check')}${esc(t('Installed'))}</button>` : `<button class="btn small" data-install>${icon('download')}${esc(t('Install'))}</button>`}
          </div>
        </div>
      </article>`).join('');
    $(`#${kind}More`).hidden = !d.hasNext;
  }
  for (const kind of ['mods', 'packs', 'shaders']) {
    const d = () => S.discover[kind];
    $(`#${kind}Query`).addEventListener('input', debounce(e => { d().query = e.target.value.trim(); runSearch(kind, true); }, 400));
    $(`#${kind}Sort`).onchange = e => { d().sort = e.target.value; runSearch(kind, true); };
    $(`#${kind}More`).onclick = e => busy(e.currentTarget, async () => { d().page += 1; await runSearch(kind, false); });
    $(`#${kind}Results`).addEventListener('click', async e => {
      const b = e.target.closest('[data-install]');
      if (!b) return;
      const r = d().results.find(x => x.projectId === b.closest('.result').dataset.id);
      if (!r) return;
      await busy(b, async () => {
        const v = contentVersion();
        const res = await call(installFn[kind](r.projectId, v));
        if (kind === 'mods') {
          const extra = res.installed.length > 1 ? t(' (+{0} required)', res.installed.length - 1) : '';
          toast('success', res.installed.length ? t('{0} installed{1}.', r.title, extra) : t('{0} is already installed.', r.title));
          if (res.missing?.length) toast('info', t('{0} dependency could not be found for {1}.', res.missing.length, v));
          loadMods();
        } else if (kind === 'packs') {
          toast('success', res.already ? t('{0} is already there.', r.title) : t('{0} installed. Enable it in Minecraft → Options → Resource Packs.', r.title));
          loadPacks();
        } else {
          toast('success', res.already ? t('{0} is already there.', r.title) : t('{0} installed. Enable it in Minecraft → Options → Video Settings → Shader Packs.', r.title));
          loadShaders();
        }
        r.installed = true;
        refreshVersions();
      });
      renderResults(kind);
    });
  }

  // -----------------------------------------------------------------------
  // Welten
  // -----------------------------------------------------------------------
  async function loadWorlds() {
    $('#worldList').innerHTML = skeletons(3);
    try { S.worlds = (await call(api.worlds.list(contentVersion()))).worlds; } catch (e) { S.worlds = []; fail(e); }
    renderWorlds();
  }
  function renderWorlds() {
    const root = $('#worldList');
    const real = S.worlds.filter(w => !w.missing);
    $('#worldsSummary').textContent = real.length ? t('{0} worlds · {1}', real.length, fmtSize(real.reduce((a, w) => a + w.size, 0))) : '';
    $('#worldsBackupAll').disabled = !real.length;
    if (!S.worlds.length) { root.innerHTML = emptyHtml('map', t('No worlds yet'), t('Worlds you create in singleplayer show up here.')); return; }
    root.innerHTML = S.worlds.map(w => {
      const open = S.openBackups.has(w.folder);
      return `
      <div class="world ${w.missing ? 'missing' : ''}" data-folder="${esc(w.folder)}">
        <div class="world-main">
          <div class="world-icon">${w.icon ? `<img src="${esc(w.icon)}" alt="" />` : icon('map')}</div>
          <div class="world-body">
            <strong>${esc(w.name)}</strong>
            <div class="meta">${w.missing ? `<span>${esc(t('Deleted — only backups left'))}</span>` : `<span>${esc(t('Played {0}', timeAgo(w.lastPlayed).toLowerCase()))}</span><span>${fmtSize(w.size)}</span>`}
              ${w.backups.length ? `<button class="bk-toggle ${open ? 'open' : ''}" data-bk>${esc(w.backups.length === 1 ? t('1 backup') : t('{0} backups', w.backups.length))}${icon('chevron')}</button>` : `<span>${esc(t('No backups'))}</span>`}</div>
          </div>
          <div class="item-actions">
            ${w.missing ? '' : `<button class="btn small" data-wbackup>${icon('save')}${esc(t('Back up'))}</button>
            <button class="icon-btn" data-wdelete title="${esc(t('Move to recycle bin'))}">${icon('trash')}</button>`}
          </div>
        </div>
        ${open && w.backups.length ? `<div class="world-backups">${w.backups.map(b => `
          <div class="bk" data-id="${esc(b.id)}">${icon('history')}
            <span class="when">${esc(fmtDate(b.createdAt))} <span class="muted">· ${esc(b.reason === 'manual' ? t('manual') : b.reason === 'before update' ? t('before update') : t('before restore'))} · ${fmtSize(b.size)}</span></span>
            <button class="btn small ghost" data-restore>${esc(t('Restore'))}</button>
            <button class="icon-btn" data-bdelete title="${esc(t('Delete backup'))}">${icon('trash')}</button>
          </div>`).join('')}</div>` : ''}
      </div>`;
    }).join('');
  }
  $('#worldList').addEventListener('click', async e => {
    const w = e.target.closest('.world');
    if (!w) return;
    const folder = w.dataset.folder;
    const world = S.worlds.find(x => x.folder === folder);
    const v = contentVersion();
    if (e.target.closest('[data-bk]')) { S.openBackups.has(folder) ? S.openBackups.delete(folder) : S.openBackups.add(folder); renderWorlds(); return; }
    const bb = e.target.closest('[data-wbackup]');
    if (bb) {
      await busy(bb, async () => { await call(api.worlds.backup(v, folder)); toast('success', t('Backup of “{0}” created.', world.name)); S.openBackups.add(folder); });
      loadWorlds();
      return;
    }
    if (e.target.closest('[data-wdelete]')) {
      if (!(await confirmDialog({ title: t('Delete “{0}”?', world.name), text: t('The world is moved to the recycle bin. Backups stay.'), ok: t('Delete'), danger: true }))) return;
      try { await call(api.worlds.remove(v, folder)); toast('success', t('World moved to the recycle bin.')); } catch (err) { fail(err); }
      loadWorlds();
      return;
    }
    const bk = e.target.closest('.bk');
    if (!bk) return;
    if (e.target.closest('[data-restore]')) {
      if (S.sessions.some(s => s.version === v)) { toast('error', t('Close Minecraft first.')); return; }
      if (!(await confirmDialog({ title: t('Restore this backup?'), text: world.missing ? t('The world is brought back from this backup.') : t('The current state of “{0}” is backed up first, then replaced by this backup.', world.name), ok: t('Restore') }))) return;
      await busy(e.target.closest('[data-restore]'), async () => { await call(api.worlds.restore(v, bk.dataset.id)); toast('success', t('World restored.')); });
      loadWorlds();
      return;
    }
    if (e.target.closest('[data-bdelete]')) {
      if (!(await confirmDialog({ title: t('Delete backup?'), text: t('This backup is deleted permanently.'), ok: t('Delete'), danger: true }))) return;
      try { await call(api.worlds.deleteBackup(v, bk.dataset.id)); } catch (err) { fail(err); }
      loadWorlds();
    }
  });
  $('#worldsBackupAll').onclick = e => busy(e.currentTarget, async () => {
    const v = contentVersion();
    for (const w of S.worlds.filter(x => !x.missing)) await call(api.worlds.backup(v, w.folder));
    toast('success', t('All worlds backed up.'));
    loadWorlds();
  });
  $('#worldsBackups').onclick = () => call(api.open('backups', contentVersion())).catch(fail);
  $('#worldsFolder').onclick = () => call(api.open('saves', contentVersion())).catch(fail);

  // -----------------------------------------------------------------------
  // Screenshots
  // -----------------------------------------------------------------------
  let shotObserver = null;
  async function loadShots() {
    try { S.shots = (await call(api.shots.list(contentVersion()))).shots; } catch (e) { S.shots = []; fail(e); }
    renderShots();
  }
  function renderShots() {
    const root = $('#shotGrid');
    if (shotObserver) shotObserver.disconnect();
    if (!S.shots.length) { root.innerHTML = emptyHtml('camera', t('No screenshots yet'), t('Press F2 in Minecraft to take one.')); return; }
    root.innerHTML = S.shots.map((s, i) => `<div class="shot" data-i="${i}"><img alt="" /><div class="cap">${esc(fmtDate(s.takenAt))}</div></div>`).join('');
    const v = contentVersion();
    shotObserver = new IntersectionObserver(entries => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        shotObserver.unobserve(en.target);
        const s = S.shots[+en.target.dataset.i];
        call(api.shots.thumb(v, s.file)).then(r => {
          const img = $('img', en.target);
          if (r.data && img) { img.src = r.data; img.onload = () => img.classList.add('loaded'); }
        }).catch(() => {});
      }
    }, { root: $('.content'), rootMargin: '300px' });
    $$('.shot', root).forEach(el => shotObserver.observe(el));
  }
  $('#shotGrid').addEventListener('click', e => { const s = e.target.closest('.shot'); if (s) openLightbox(+s.dataset.i); });
  $('#shotsFolder').onclick = () => call(api.open('screenshots', contentVersion())).catch(fail);

  let lbIndex = -1;
  async function openLightbox(i) {
    const lb = $('#lightbox');
    if (i < 0 || i >= S.shots.length) return;
    lbIndex = i;
    const s = S.shots[i];
    lb.hidden = false;
    lb.innerHTML = `<div class="lb-img"><span class="spinner"></span></div>
      <button class="icon-btn lb-close" data-lb="close" title="${esc(t('Close'))}">${icon('x')}</button>
      ${i > 0 ? `<button class="lb-nav prev" data-lb="prev">${icon('left')}</button>` : ''}
      ${i < S.shots.length - 1 ? `<button class="lb-nav next" data-lb="next">${icon('right')}</button>` : ''}
      <div class="lb-bar"><span>${esc(fmtDate(s.takenAt))} · ${fmtSize(s.size)}</span>
        <button class="btn small ghost" data-lb="copy">${icon('copy')}${esc(t('Copy'))}</button>
        <button class="btn small ghost" data-lb="show">${icon('folder')}${esc(t('Show in folder'))}</button>
        <button class="btn small danger" data-lb="delete">${icon('trash')}${esc(t('Delete'))}</button></div>`;
    try {
      const r = await call(api.shots.full(contentVersion(), s.file));
      if (lbIndex === i && r.data) $('.lb-img', lb).innerHTML = `<img src="${r.data}" alt="" />`;
    } catch (e) { fail(e); }
  }
  function closeLightbox() { $('#lightbox').hidden = true; $('#lightbox').innerHTML = ''; lbIndex = -1; }
  $('#lightbox').addEventListener('click', async e => {
    const b = e.target.closest('[data-lb]');
    if (!b) { if (e.target === $('#lightbox') || e.target.classList.contains('lb-img')) closeLightbox(); return; }
    const s = S.shots[lbIndex];
    const v = contentVersion();
    switch (b.dataset.lb) {
      case 'close': closeLightbox(); break;
      case 'prev': openLightbox(lbIndex - 1); break;
      case 'next': openLightbox(lbIndex + 1); break;
      case 'copy': try { await call(api.shots.copy(v, s.file)); toast('success', t('Screenshot copied.')); } catch (err) { fail(err); } break;
      case 'show': call(api.shots.show(v, s.file)).catch(fail); break;
      case 'delete':
        try {
          await call(api.shots.remove(v, s.file));
          S.shots.splice(lbIndex, 1);
          renderShots();
          if (S.shots.length) openLightbox(Math.min(lbIndex, S.shots.length - 1)); else closeLightbox();
        } catch (err) { fail(err); }
        break;
      default: break;
    }
  });

  // -----------------------------------------------------------------------
  // Skins
  // -----------------------------------------------------------------------
  let viewer = null, viewerLoading = null, stageObserver = null;
  function loadSkinview() {
    if (window.skinview3d) return Promise.resolve();
    if (!viewerLoading) {
      viewerLoading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'vendor/skinview3d.bundle.js';
        s.onload = resolve;
        s.onerror = () => reject(new Error('3D preview could not be loaded.'));
        document.head.append(s);
      });
    }
    return viewerLoading;
  }
  async function ensureViewer() {
    await loadSkinview();
    const stage = $('#skinStage');
    if (!viewer) {
      viewer = new window.skinview3d.SkinViewer({ canvas: $('#skinCanvas'), width: stage.clientWidth || 320, height: stage.clientHeight || 380 });
      viewer.zoom = 0.85;
      viewer.fov = 40;
      viewer.controls.enableZoom = false;
      viewer.autoRotate = false;
      viewer.animation = new window.skinview3d.IdleAnimation();
      stageObserver = new ResizeObserver(() => { if (viewer && stage.clientWidth) viewer.setSize(stage.clientWidth, stage.clientHeight); });
      stageObserver.observe(stage);
    }
    viewer.renderPaused = false;
    return viewer;
  }
  function pauseSkinViewer() { if (viewer) viewer.renderPaused = true; }
  $('#skinAnim').onclick = e => {
    const b = e.target.closest('button[data-value]');
    if (!b || !viewer || !window.skinview3d) return;
    $$('#skinAnim button').forEach(x => x.classList.toggle('active', x === b));
    const A = { idle: 'IdleAnimation', walk: 'WalkingAnimation', run: 'RunningAnimation' }[b.dataset.value];
    viewer.animation = new window.skinview3d[A]();
  };

  async function enterSkins() {
    renderSkinStage();
    renderSkinGrid();
    try { S.skins.library = (await call(api.skins.library())).skins; } catch (e) { fail(e); }
    renderSkinGrid();
    if (!S.account) { S.skins.profile = null; renderSkinStage(); return; }
    try {
      S.skins.profile = await call(api.skins.profile());
      S.skins.profileError = null;
    } catch (e) { S.skins.profile = null; S.skins.profileError = e.message; }
    renderSkinStage();
  }

  /** Neutrale Vortex-Puppe als Platzhalter (Mojangs Standard-Skins duerfen wir nicht mitliefern). */
  let mannequin = null;
  function mannequinSkin() {
    if (mannequin) return mannequin;
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    const fill = (col, x, y, w, h) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
    fill('#3a3452', 0, 0, 32, 16);                      // Kopf (alle Seiten)
    fill('#2d2742', 16, 16, 24, 16);                    // Koerper
    fill('#8b5cf6', 20, 20, 8, 12);                     // Brust vorne
    fill('#3b82f6', 23, 22, 2, 8);
    fill('#241f36', 40, 16, 16, 16); fill('#241f36', 32, 48, 16, 16);   // Arme
    fill('#1b1729', 0, 16, 16, 16); fill('#1b1729', 16, 48, 16, 16);    // Beine
    fill('#a78bfa', 9, 11, 2, 1); fill('#a78bfa', 13, 11, 2, 1);        // Augen
    mannequin = c.toDataURL();
    return mannequin;
  }

  async function showOnStage(dataUrl, variant, cape) {
    try {
      const v = await ensureViewer();
      await v.loadSkin(dataUrl || mannequinSkin(), { model: variant === 'slim' ? 'slim' : 'default' });
      if (cape) await v.loadCape(cape); else v.resetCape();
      $('#skinStageEmpty').hidden = true;
    } catch (e) {
      $('#skinStageEmpty').hidden = false;
      $('#skinStageEmpty').textContent = e.message;
    }
  }

  function renderSkinStage() {
    const p = S.skins.profile;
    const prev = S.skins.preview && S.skins.library.find(x => x.id === S.skins.preview);
    const actions = $('#skinStageActions');
    if (!S.account) {
      $('#skinName').textContent = t('Not signed in');
      $('#skinState').textContent = t('Sign in to change your skin.');
      actions.innerHTML = `<button class="btn" id="skinSignIn">${icon('user')}${esc(t('Sign in with Microsoft'))}</button>`;
      $('#skinSignIn').onclick = e => login(e.currentTarget);
      $('#capeList').innerHTML = '';
      if (prev) showOnStage(prev.data, prev.variant, null); else showOnStage(null, 'classic', null);
      return;
    }
    const activeCape = p?.capes?.find(c => c.active);
    if (prev) {
      $('#skinName').textContent = prev.name;
      $('#skinState').textContent = t('Preview — not applied yet');
      actions.innerHTML = `<button class="btn" data-sa="apply">${icon('check')}${esc(t('Use this skin'))}</button><button class="btn ghost" data-sa="back">${esc(t('Back to current'))}</button>`;
      showOnStage(prev.data, prev.variant, activeCape?.data);
    } else {
      $('#skinName').textContent = p?.name || S.account.username;
      $('#skinState').textContent = S.skins.profileError ? tr(S.skins.profileError) : p ? (p.skin ? (p.skin.variant === 'slim' ? t('Current skin · slim arms') : t('Current skin · classic arms')) : t('Default skin')) : t('Loading…');
      actions.innerHTML = p ? `<button class="btn ghost" data-sa="save">${icon('save')}${esc(t('Save to library'))}</button><button class="btn ghost" data-sa="reset">${icon('refresh')}${esc(t('Reset to default'))}</button>` : '';
      if (p) showOnStage(p.skin?.data || null, p.skin?.variant, activeCape?.data);
    }
    const capes = p?.capes || [];
    $('#capeList').innerHTML = capes.length ? `<button class="cape ${activeCape ? '' : 'active'}" data-cape="" title="${esc(t('No cape'))}"><span class="none">${esc(t('No cape'))}</span></button>` + capes.map(c => `<button class="cape ${c.active ? 'active' : ''}" data-cape="${esc(c.id)}" title="${esc(c.alias)}"><canvas width="10" height="16" data-capeimg="${esc(c.id)}"></canvas></button>`).join('') : '';
    for (const c of capes) drawCape($(`[data-capeimg="${c.id}"]`), c.data);
  }
  $('#skinStageActions').addEventListener('click', async e => {
    const b = e.target.closest('[data-sa]');
    if (!b) return;
    const a = b.dataset.sa;
    if (a === 'back') { S.skins.preview = null; renderSkinStage(); renderSkinGrid(); return; }
    await busy(b, async () => {
      if (a === 'apply') {
        const r = await call(api.skins.apply(S.skins.preview));
        S.skins.profile = r.profile; S.skins.preview = null;
        toast('success', t('Skin changed. Other players see it after rejoining.'));
        await avatarFor(S.account, true); renderAccount();
      } else if (a === 'reset') {
        if (!(await confirmDialog({ title: t('Reset your skin?'), text: t('Your skin goes back to a default Minecraft skin. Save it to the library first if you want to keep it.'), ok: t('Reset'), danger: true }))) return;
        const r = await call(api.skins.reset());
        S.skins.profile = r.profile;
        toast('success', t('Skin reset.'));
        await avatarFor(S.account, true); renderAccount();
      } else if (a === 'save') {
        const r = await call(api.skins.saveCurrent());
        S.skins.library = r.skins;
        toast('success', t('Saved to your library.'));
      }
      renderSkinStage(); renderSkinGrid();
    });
  });
  $('#capeList').addEventListener('click', async e => {
    const b = e.target.closest('[data-cape]');
    if (!b || b.classList.contains('active')) return;
    await busy(b, async () => {
      const r = await call(api.skins.setCape(b.dataset.cape || null));
      S.skins.profile = r.profile;
      toast('success', b.dataset.cape ? t('Cape changed.') : t('Cape hidden.'));
    });
    renderSkinStage();
  });

  function drawCape(canvas, dataUrl) {
    if (!canvas || !dataUrl) return;
    const img = new Image();
    img.onload = () => { const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false; const sx = img.width / 64; ctx.drawImage(img, 1 * sx, 1 * sx, 10 * sx, 16 * sx, 0, 0, 10, 16); };
    img.src = dataUrl;
  }

  /** Flache Vorderansicht eines Skins (16x32 Pixel) auf ein Canvas zeichnen. */
  function drawSkinFront(canvas, dataUrl, variant) {
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, 16, 32);
      const legacy = img.height === 32;
      const k = img.width / 64;
      const arm = variant === 'slim' ? 3 : 4;
      const part = (sx, sy, w, h, dx, dy, flip = false) => {
        if (!flip) { ctx.drawImage(img, sx * k, sy * k, w * k, h * k, dx, dy, w, h); return; }
        ctx.save(); ctx.translate(dx + w, dy); ctx.scale(-1, 1); ctx.drawImage(img, sx * k, sy * k, w * k, h * k, 0, 0, w, h); ctx.restore();
      };
      part(8, 8, 8, 8, 4, 0); part(40, 8, 8, 8, 4, 0);                   // Kopf + Hut
      part(20, 20, 8, 12, 4, 8);                                           // Koerper
      part(44, 20, arm, 12, 4 - arm, 8);                                   // rechter Arm
      part(4, 20, 4, 12, 4, 20);                                           // rechtes Bein
      if (legacy) { part(44, 20, arm, 12, 12, 8, true); part(4, 20, 4, 12, 8, 20, true); }
      else {
        part(36, 52, arm, 12, 12, 8); part(20, 52, 4, 12, 8, 20);          // linker Arm/Bein
        part(20, 36, 8, 12, 4, 8); part(44, 36, arm, 12, 4 - arm, 8);      // Ueberzuege
        part(52, 52, arm, 12, 12, 8); part(4, 36, 4, 12, 4, 20); part(4, 52, 4, 12, 8, 20);
      }
    };
    img.src = dataUrl;
  }

  function renderSkinGrid() {
    const root = $('#skinGrid');
    const lib = S.skins.library;
    if (!lib.length) { root.innerHTML = emptyHtml('shirt', t('Your skin library is empty'), t('Add a PNG skin, copy one from a player, or save your current skin.')); return; }
    root.innerHTML = lib.map(s => `
      <div class="skin-card ${S.skins.preview === s.id ? 'previewing' : ''}" data-id="${esc(s.id)}" title="${esc(t('Click to preview'))}">
        <button class="icon-btn rm" data-srm title="${esc(t('Delete'))}">${icon('trash')}</button>
        <canvas width="16" height="32"></canvas>
        <strong>${esc(s.name)}</strong>
        <div class="row"><button class="variant" data-svar title="${esc(t('Switch arm width'))}">${esc(s.variant === 'slim' ? t('SLIM') : t('CLASSIC'))}</button></div>
        <button class="btn small" data-sapply ${S.account ? '' : 'disabled'}>${esc(t('Use'))}</button>
      </div>`).join('');
    $$('.skin-card', root).forEach(card => { const s = lib.find(x => x.id === card.dataset.id); drawSkinFront($('canvas', card), s.data, s.variant); });
  }
  $('#skinGrid').addEventListener('click', async e => {
    const card = e.target.closest('.skin-card');
    if (!card) return;
    const id = card.dataset.id;
    const s = S.skins.library.find(x => x.id === id);
    if (e.target.closest('[data-srm]')) {
      if (!(await confirmDialog({ title: t('Delete “{0}”?', s.name), text: t('The skin is removed from your library.'), ok: t('Delete'), danger: true }))) return;
      try { S.skins.library = (await call(api.skins.remove(id))).skins; if (S.skins.preview === id) S.skins.preview = null; } catch (err) { fail(err); }
      renderSkinGrid(); renderSkinStage();
      return;
    }
    if (e.target.closest('[data-svar]')) {
      try { S.skins.library = (await call(api.skins.update(id, { variant: s.variant === 'slim' ? 'classic' : 'slim' }))).skins; } catch (err) { fail(err); }
      renderSkinGrid(); if (S.skins.preview === id) renderSkinStage();
      return;
    }
    const ap = e.target.closest('[data-sapply]');
    if (ap) {
      await busy(ap, async () => {
        const r = await call(api.skins.apply(id));
        S.skins.profile = r.profile; S.skins.preview = null;
        toast('success', t('Skin changed. Other players see it after rejoining.'));
        await avatarFor(S.account, true); renderAccount();
      });
      renderSkinStage(); renderSkinGrid();
      return;
    }
    S.skins.preview = S.skins.preview === id ? null : id;
    renderSkinStage(); renderSkinGrid();
  });
  $('#skinAdd').onclick = e => busy(e.currentTarget, async () => {
    const r = await call(api.skins.importFile());
    if (!r.added?.length) return;
    S.skins.library = r.skins;
    S.skins.preview = r.added[0].id;
    (r.errors || []).forEach(x => toast('error', tr(x)));
    renderSkinGrid(); renderSkinStage();
  });
  $('#skinPlayerForm').onsubmit = e => {
    e.preventDefault();
    const name = $('#skinPlayer').value.trim();
    if (!name) { $('#skinPlayer').focus(); return; }
    busy($('button', e.target), async () => {
      const r = await call(api.skins.importPlayer(name));
      S.skins.library = r.skins; S.skins.preview = r.added.id;
      $('#skinPlayer').value = '';
      renderSkinGrid(); renderSkinStage();
    });
  };
  $('#skinSaveCurrent').onclick = e => busy(e.currentTarget, async () => {
    if (!S.account) throw new Error(t('Sign in with your Microsoft account first.'));
    const r = await call(api.skins.saveCurrent());
    S.skins.library = r.skins;
    toast('success', t('Saved to your library.'));
    renderSkinGrid();
  });
  $('#skinsFolder').onclick = () => call(api.open('skins')).catch(fail);

  // -----------------------------------------------------------------------
  // Server
  // -----------------------------------------------------------------------
  function pingClass(ms) { if (ms == null) return ''; return ms < 60 ? 'p4' : ms < 120 ? 'p3' : ms < 250 ? 'p2' : 'p1'; }
  function renderServers() {
    $('#serverList').innerHTML = S.servers.map(s => {
      const st = S.status[s.id] || s.status;
      const motd = st ? stripFormat(typeof st.description === 'string' ? st.description : '') : t('Checking…');
      return `
      <div class="server ${s.official ? 'official' : ''}" data-id="${esc(s.id)}">
        ${favHtml(s)}
        <div class="server-body">
          <div class="top"><strong>${esc(s.name)}</strong>${s.official ? `<span class="badge v">${esc(t('OFFICIAL'))}</span>` : ''}<code>${esc(s.address)}</code></div>
          <div class="motd">${esc(tr(motd))}</div>
        </div>
        <div class="server-meta">
          ${st ? (st.online
            ? `<b>${fmtNum(st.players?.online)} / ${fmtNum(st.players?.max)}</b><span><span class="ping ${pingClass(st.latency)}"><i></i><i></i><i></i><i></i></span> ${st.latency ?? '?'} ms</span>`
            : `<b style="color:var(--err)">${esc(t('Offline'))}</b><span>${esc(t('not reachable'))}</span>`)
            : '<span class="spinner" style="border-top-color:var(--violet-2)"></span>'}
        </div>
        <div class="item-actions">
          <button class="btn small" data-join="${esc(s.id)}">${icon('play')}${esc(t('Join'))}</button>
          ${s.official ? '' : `<button class="icon-btn" data-sremove title="${esc(t('Remove'))}">${icon('trash')}</button>`}
        </div>
      </div>`;
    }).join('');
  }
  async function refreshStatuses(list, force = false) {
    await Promise.all(list.map(async s => {
      try { S.status[s.id] = (await call(api.servers.status(s.id, force))).status; } catch (_) { S.status[s.id] = { online: false }; }
      if (S.page === 'servers') renderServers();
      if (S.page === 'home') renderQuickServers();
    }));
  }
  $('#serversRefresh').onclick = e => busy(e.currentTarget, () => refreshStatuses(S.servers, true));
  $('#serverList').addEventListener('click', async e => {
    const b = e.target.closest('[data-sremove]');
    if (!b) return;
    const s = S.servers.find(x => x.id === b.closest('.server').dataset.id);
    if (!s || !(await confirmDialog({ title: t('Remove {0}?', s.name), text: t('{0} is removed from your list.', s.address), ok: t('Remove'), danger: true }))) return;
    try { S.servers = (await call(api.servers.remove(s.id))).servers; delete S.status[s.id]; renderServers(); } catch (err) { fail(err); }
  });
  $('#addServerForm').onsubmit = async e => {
    e.preventDefault();
    const name = $('#serverName').value.trim();
    const address = $('#serverAddress').value.trim();
    if (!name) { $('#serverName').focus(); return; }
    if (!address) { $('#serverAddress').focus(); return; }
    await busy($('button', e.target), async () => {
      const r = await call(api.servers.add({ name, address }));
      S.servers = r.servers;
      $('#serverName').value = ''; $('#serverAddress').value = '';
      renderServers();
      refreshStatuses([r.server]);
    });
  };

  // -----------------------------------------------------------------------
  // Einstellungen
  // -----------------------------------------------------------------------
  async function saveSettings(patch, quiet = true) {
    try {
      const r = await call(api.settings.set(patch));
      S.settings = r.settings;
      if (!quiet) toast('success', t('Saved.'));
      return true;
    } catch (e) { fail(e); renderSettings(); return false; }
  }
  const ram = $('#setRam');
  function ramPaint() {
    const p = ((ram.value - ram.min) / (ram.max - ram.min)) * 100;
    ram.style.setProperty('--p', `${p}%`);
    $('#setRamOut').textContent = fmtGb(Number(ram.value));
  }
  function renderSettings() {
    const c = S.settings;
    ram.max = String(Math.max(2048, Math.min(16384, Math.floor((S.system.maxAllowedMb || 8192) / 256) * 256)));
    ram.value = String(c.memoryMax || 4096);
    ramPaint();
    $('#setWidth').value = c.width || 1280;
    $('#setHeight').value = c.height || 720;
    $('#setFullscreen').checked = Boolean(c.fullscreen);
    $('#setWidth').disabled = $('#setHeight').disabled = Boolean(c.fullscreen);
    $('#setJvm').value = c.jvmArgs || '';
    $('#setAddon').checked = c.includeAddon !== false;
    $('#setConsoleCrash').checked = c.showConsoleOnCrash !== false;
    $('#setAutoBackup').checked = c.autoBackup !== false;
    $('#setAutoUpdate').checked = Boolean(c.autoUpdateMods);
    $('#setDiscord').checked = S.discordAvailable && c.discord !== false;
    $('#setDiscord').disabled = !S.discordAvailable;
    $('#discordInfo').textContent = S.discordAvailable ? t('Shows "Playing Vortex Client" in your Discord status.') : t('Not set up in this launcher build (the owner adds a Discord application ID).');
    $$('#setAfter button').forEach(b => b.classList.toggle('active', b.dataset.value === c.afterLaunch));
    $$('#setLanguage button').forEach(b => b.classList.toggle('active', b.dataset.value === (c.language || 'auto')));
    $('#dataPath').textContent = S.dataRoot || t('Launcher data');
    $('#javaInfo').textContent = c.javaPath
      ? t('Custom: {0}', c.javaPath)
      : t('Automatic: the right Java is downloaded when needed (Java 25 for Minecraft 26.x, 21 for 1.20.5+).');
    $('#javaAuto').hidden = !c.javaPath;
    renderUpdate();
  }
  ram.addEventListener('input', ramPaint);
  ram.addEventListener('change', () => saveSettings({ memoryMax: Number(ram.value) }));
  for (const id of ['setWidth', 'setHeight']) {
    $(`#${id}`).addEventListener('change', e => {
      const n = Number.parseInt(e.target.value, 10);
      if (!Number.isFinite(n)) { renderSettings(); return; }
      saveSettings(id === 'setWidth' ? { width: n } : { height: n }).then(renderSettings);
    });
  }
  $('#setFullscreen').onchange = e => saveSettings({ fullscreen: e.target.checked }).then(renderSettings);
  $('#setJvm').onchange = e => saveSettings({ jvmArgs: e.target.value.trim() });
  $('#setConsoleCrash').onchange = e => saveSettings({ showConsoleOnCrash: e.target.checked });
  $('#setAutoBackup').onchange = e => saveSettings({ autoBackup: e.target.checked });
  $('#setAutoUpdate').onchange = e => saveSettings({ autoUpdateMods: e.target.checked });
  $('#setDiscord').onchange = e => saveSettings({ discord: e.target.checked });
  $('#setAddon').onchange = async e => {
    const on = e.target.checked;
    if (await saveSettings({ includeAddon: on })) {
      toast('success', on ? t('Vortex Plus Addon is loaded from the next start.') : t('Vortex Plus Addon switched off.'));
      refreshVersions();
    }
  };
  $('#setAfter').onclick = e => {
    const b = e.target.closest('button[data-value]');
    if (b) saveSettings({ afterLaunch: b.dataset.value }).then(renderSettings);
  };
  $('#setLanguage').onclick = async e => {
    const b = e.target.closest('button[data-value]');
    if (!b || b.dataset.value === S.settings.language) return;
    if (await saveSettings({ language: b.dataset.value })) api.window.reload();
  };
  $('#javaPick').onclick = e => busy(e.currentTarget, async () => {
    const r = await call(api.settings.pickJava());
    if (r.canceled) return;
    S.settings = r.settings;
    toast('success', t('Java {0} selected.', r.major));
    renderSettings();
  });
  $('#javaAuto').onclick = () => saveSettings({ javaPath: '' }).then(() => { renderSettings(); toast('success', t('Java is chosen automatically again.')); });
  $('#openData').onclick = () => call(api.open('data')).catch(fail);
  $('#openLog').onclick = () => call(api.open('log')).catch(fail);
  $('#websiteBtn').onclick = () => call(api.openExternal(S.website)).catch(fail);
  $('#vortexRefresh').onclick = e => busy(e.currentTarget, async () => {
    const r = await call(api.vortexRefresh());
    S.versions = r.versions;
    if (r.error) throw new Error(t('The Vortex update server could not be reached.'));
    if (!r.updated.length) toast('success', t('Vortex is up to date.'));
    renderVersionMenu();
  });

  // Updates
  function renderUpdate() {
    const u = S.update || {};
    const btn = $('#updBtn');
    const bar = $('#updBar');
    $('#updateDot').hidden = !['available', 'ready'].includes(u.status);
    $('#updTitle').textContent = `Vortex Client Launcher ${S.appVersion}`;
    bar.hidden = u.status !== 'downloading';
    $('i', bar).style.width = `${u.progress || 0}%`;
    btn.disabled = ['checking', 'downloading'].includes(u.status);
    const texts = {
      idle: [t('Updates are checked automatically.'), t('Check for updates')],
      checking: [t('Checking for updates…'), t('Checking…')],
      latest: [t('You are on the latest version.'), t('Check again')],
      available: [t('Version {0} is available.', u.available), t('Download update')],
      downloading: [t('Downloading version {0}… {1}%', u.available, u.progress || 0), t('Downloading…')],
      ready: [t('Version {0} is ready. The launcher restarts to install it.', u.available), t('Restart & install')],
      unavailable: [t('No update information found right now.'), t('Try again')],
      dev: [t('Development start: updates are only checked in the installed app.'), t('Check for updates')]
    };
    if (u.portable && u.status === 'available') texts.available = [t('Version {0} is available. The portable version is updated by downloading it again.', u.available), t('Open download page')];
    if (u.status === 'available') texts.available[1] = u.portable ? t('Open download page') : t('Update now');
    const [text, label] = texts[u.status] || texts.idle;
    $('#updText').textContent = u.error && u.status === 'available' ? tr(u.error) : text;
    btn.textContent = label;
    // Hinweis in der Seitenleiste
    const pill = $('#updatePill');
    const show = ['available', 'downloading', 'ready'].includes(u.status);
    pill.hidden = !show;
    if (show) {
      $('#upTitle').textContent = u.status === 'downloading' ? t('Updating…') : u.status === 'ready' ? t('Restarting…') : t('New update');
      $('#upSub').textContent = u.status === 'downloading' ? `${u.progress || 0}%` : `v${S.appVersion} → v${u.available}`;
      $('#upBtn').hidden = u.status !== 'available';
      $('#upBtnLabel').textContent = u.portable ? t('Download') : t('Update');
      $('#upBar').hidden = u.status !== 'downloading';
      $('i', $('#upBar')).style.width = `${u.progress || 0}%`;
    }
  }
  async function updateNow() {
    try { S.update = (await call(api.update.now())).update; } catch (e) { fail(e); }
    renderUpdate();
  }
  $('#upBtn').onclick = updateNow;
  $('#updBtn').onclick = async () => {
    const st = S.update?.status;
    try {
      if (st === 'available') { await updateNow(); return; }
      if (st === 'ready') { await call(api.update.install()); return; }
      S.update = { ...S.update, status: 'checking' }; renderUpdate(); S.update = (await call(api.update.check())).update;
    } catch (e) { fail(e); }
    renderUpdate();
  };

  // -----------------------------------------------------------------------
  // Admin
  // -----------------------------------------------------------------------
  async function loadAdmin() {
    S.admin.loading = true;
    renderAdmin();
    try {
      S.admin.status = await call(api.admin.status());
      if (S.admin.status.signedIn && S.admin.status.canWrite) S.admin.overview = await call(api.admin.overview());
    } catch (e) { S.admin.error = e.message; }
    S.admin.loading = false;
    renderAdmin();
  }

  function renderAdmin() {
    const body = $('#adminBody');
    const head = $('#adminHeadTools');
    const A = S.admin;
    head.innerHTML = '';
    if (A.loading && !A.status) { body.innerHTML = skeletons(2); return; }
    const st = A.status || {};
    if (!st.signedIn) {
      body.innerHTML = `
        <div class="admin-grid">
          <section class="card token-card">
            <h3>${icon('key')}${esc(t('Sign in with your GitHub token'))}</h3>
            <p class="muted">${esc(t('Uploads are stored as a release in {0}. Only someone with write access to this repository can publish.', st.repo || ''))}</p>
            <ol>
              <li>${t('Open <b>GitHub → Settings → Developer settings → Fine-grained tokens</b>.')}</li>
              <li>${t('Repository access: only <code>{0}</code>. Permission: <b>Contents → Read and write</b>.', esc(st.repo || ''))}</li>
              <li>${t('Copy the token and paste it here. It is stored encrypted on this PC only.')}</li>
            </ol>
            <form class="token-form" id="tokenForm">
              <input id="tokenInput" type="password" placeholder="github_pat_…" autocomplete="off" spellcheck="false" />
              <button class="btn" type="submit">${icon('check')}${esc(t('Sign in'))}</button>
              <button class="btn ghost" type="button" data-external="https://github.com/settings/personal-access-tokens/new">${icon('external')}${esc(t('Create token'))}</button>
            </form>
          </section>
        </div>`;
      $('#tokenForm').onsubmit = e => {
        e.preventDefault();
        const token = $('#tokenInput').value.trim();
        if (!token) return;
        busy($('button[type=submit]', e.target), async () => {
          S.admin.status = await call(api.admin.signIn(token));
          toast('success', t('Signed in to GitHub.'));
          S.adminVisible = true; $('#navAdmin').hidden = false;
          await loadAdmin();
        });
      };
      return;
    }
    head.innerHTML = `<button class="btn ghost" id="adminReload">${icon('refresh')}${esc(t('Reload'))}</button>${A.overview?.releaseUrl ? `<button class="btn ghost" data-external="${esc(A.overview.releaseUrl)}">${icon('external')}GitHub</button>` : ''}`;
    $('#adminReload').onclick = e => busy(e.currentTarget, loadAdmin);
    const ov = A.overview;
    body.innerHTML = `
      <div class="admin-grid">
        <div class="admin-status"><i class="dot ${st.canWrite ? 'on' : 'off'}"></i>
          <span>${st.canWrite ? t('Signed in as <b>{0}</b> · can publish to <code>{1}</code>', esc(st.login || '?'), esc(st.repo)) : esc(tr(st.error || t('This token cannot write to the repository.')))}${st.isPrivate ? ` · <b style="color:var(--warn)">${esc(t('The repository is private — players cannot download!'))}</b>` : ''}</span>
          <button class="btn small ghost" id="adminSignOut">${esc(t('Sign out'))}</button>
        </div>
        ${st.canWrite ? `
        <section class="card">
          <h3 style="margin-bottom:12px">${icon('upload')}${esc(t('Publish new files'))}</h3>
          <div class="dropzone" id="adminDrop">${icon('upload')}<strong>${esc(t('Drop Vortex jars here'))}</strong><span>${esc(t('Client, addon or Fabric API — the launcher reads the mod ID and version from the jar.'))}</span>
            <div style="margin-top:12px"><button class="btn ghost" id="adminPick">${icon('folder')}${esc(t('Choose files'))}</button></div></div>
          <div class="staged" id="adminStaged"></div>
        </section>
        ${(ov?.versions || []).map(v => `
          <section class="card av-card">
            <div class="av-head"><strong>Minecraft ${esc(v.version)}</strong><span class="grow"></span></div>
            <div class="av-row head"><span>${esc(t('FILE'))}</span><span>${esc(t('IN LAUNCHER'))}</span><span>${esc(t('ONLINE'))}</span><span>${esc(t('UPLOADED'))}</span><span></span></div>
            ${v.files.map(f => `
              <div class="av-row"><span class="nm"><span class="src ${f.kind === 'client' ? 'vortex' : f.kind === 'addon' ? 'addon' : 'bundled'}">${esc(f.kind.toUpperCase())}</span><strong>${esc(f.name)}</strong></span>
                <span>${esc(f.bundled || '—')}</span>
                <span>${f.online ? `<b style="color:${f.active === 'online' ? 'var(--ok)' : 'var(--dim)'}">${esc(f.online)}</b>` : '—'}</span>
                <span class="muted">${esc(f.uploadedAt ? fmtDate(f.uploadedAt) : '—')}</span>
                <span>${f.online ? `<button class="btn small ghost" data-unpub="${esc(v.version)}|${esc(f.id)}">${esc(t('Remove online'))}</button>` : ''}</span>
              </div>`).join('')}
          </section>`).join('')}
        <section class="card">
          <h3 style="margin-bottom:12px">${icon('news')}${esc(t('News for all players'))}</h3>
          <form class="news-admin" id="newsForm">
            <input id="newsTitle" placeholder="${esc(t('Title, e.g. Vortex 4.7 is out!'))}" maxlength="100" />
            <textarea id="newsBody" placeholder="${esc(t('Text (one point per line)'))}" maxlength="1500"></textarea>
            <div class="row-btns"><button class="btn" type="submit">${icon('upload')}${esc(t('Publish news'))}</button></div>
          </form>
          <div class="news-admin" style="margin-top:12px" id="newsAdminList">${(ov?.news || []).map(n => `
            <div class="news-item"><div><strong>${esc(n.title)}</strong><p>${esc(n.body)}</p><span class="muted small">${esc(fmtDate(n.date))}</span></div>
              <button class="icon-btn" data-delnews="${esc(n.id)}" title="${esc(t('Delete'))}">${icon('trash')}</button></div>`).join('')}</div>
        </section>` : ''}
      </div>`;
    $('#adminSignOut').onclick = async () => {
      if (!(await confirmDialog({ title: t('Sign out of GitHub?'), text: t('The token is removed from this PC.'), ok: t('Sign out'), danger: true }))) return;
      S.admin.status = await call(api.admin.signOut()).catch(() => ({ signedIn: false }));
      S.admin.overview = null;
      renderAdmin();
    };
    if (!st.canWrite) return;
    renderStaged();
    $('#adminPick').onclick = e => busy(e.currentTarget, async () => { stageJars((await call(api.admin.pickJars())).jars); });
    const drop = $('#adminDrop');
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    $('#adminBody').onclick = adminClicks;
    $('#newsForm').onsubmit = e => {
      e.preventDefault();
      const title = $('#newsTitle').value.trim();
      if (!title) { $('#newsTitle').focus(); return; }
      busy($('button[type=submit]', e.target), async () => {
        const r = await call(api.admin.postNews(title, $('#newsBody').value));
        S.admin.overview.news = r.news;
        toast('success', t('News published.'));
        renderAdmin();
      });
    };
  }

  async function adminClicks(e) {
    const un = e.target.closest('[data-unpub]');
    if (un) {
      const [v, id] = un.dataset.unpub.split('|');
      if (!(await confirmDialog({ title: t('Remove the online file?'), text: t('Players fall back to the version included in the launcher (if there is one).'), ok: t('Remove'), danger: true }))) return;
      await busy(un, async () => { await call(api.admin.unpublish(v, id)); toast('success', t('Removed.')); await loadAdmin(); });
      return;
    }
    const dn = e.target.closest('[data-delnews]');
    if (dn) {
      await busy(dn, async () => { const r = await call(api.admin.deleteNews(dn.dataset.delnews)); S.admin.overview.news = r.news; renderAdmin(); });
    }
  }

  function stageJars(jars) {
    for (const j of jars || []) {
      if (S.admin.staged.some(x => x.path === j.path)) continue;
      S.admin.staged.push({ ...j, target: j.guess || selected() });
    }
    renderStaged();
  }
  function renderStaged() {
    const root = $('#adminStaged');
    if (!root) return;
    const knownVersions = [...new Set([...(S.admin.overview?.versions || []).map(v => v.version), ...S.versions.map(v => v.version)])];
    root.innerHTML = S.admin.staged.map((j, i) => j.error
      ? `<div class="item"><div class="icon">${icon('alert')}</div><div class="item-body"><strong>${esc(j.file)}</strong><div class="err">${esc(tr(j.error))}</div></div><button class="icon-btn" data-unstage="${i}">${icon('x')}</button></div>`
      : `<div class="item" data-i="${i}">
          <div class="icon pixel">${j.icon ? `<img src="${esc(j.icon)}" alt="" />` : icon('cube')}</div>
          <div class="item-body"><div class="item-title"><strong>${esc(j.name)}</strong><span class="ver">${esc(j.cleanVersion)}</span><span class="src ${j.kind === 'client' ? 'vortex' : j.kind === 'addon' ? 'addon' : 'bundled'}">${esc(j.kind.toUpperCase())}</span></div>
            <div class="item-desc">${esc(j.file)} · ${fmtSize(j.size)}${j.minecraft ? ` · ${esc(t('needs Minecraft {0}', j.minecraft))}` : ''}</div></div>
          <span class="muted small">${esc(t('for'))}</span>
          <input class="mc" list="adminVersions" value="${esc(j.target)}" data-target="${i}" />
          <button class="btn small" data-pub="${i}">${icon('upload')}${esc(t('Publish'))}</button>
          <button class="icon-btn" data-unstage="${i}">${icon('x')}</button>
        </div>`).join('') + `<datalist id="adminVersions">${knownVersions.map(v => `<option value="${esc(v)}"></option>`).join('')}</datalist>`;
    root.onclick = async e => {
      const rm = e.target.closest('[data-unstage]');
      if (rm) { S.admin.staged.splice(+rm.dataset.unstage, 1); renderStaged(); return; }
      const pb = e.target.closest('[data-pub]');
      if (!pb) return;
      const j = S.admin.staged[+pb.dataset.pub];
      const target = $(`[data-target="${pb.dataset.pub}"]`, root).value.trim();
      await busy(pb, async () => {
        const r = await call(api.admin.publish(j.path, target));
        toast('success', t('{0} {1} is now live for Minecraft {2}. All launchers download it within 30 minutes or at the next Play.', r.published.name, r.published.newVersion, r.published.version));
        S.admin.staged = S.admin.staged.filter(x => x !== j);
        await loadAdmin();
      });
    };
    root.oninput = e => { const inp = e.target.closest('[data-target]'); if (inp) S.admin.staged[+inp.dataset.target].target = inp.value; };
  }

  // -----------------------------------------------------------------------
  // Drag & Drop (Jars, Skins, Modpacks)
  // -----------------------------------------------------------------------
  let dragDepth = 0;
  const dropKind = () => ({ admin: ['jar', t('Drop jars to publish'), t('They are checked before anything is uploaded.')],
    skins: ['png', t('Drop skins to add them'), t('64×64 PNG skins')] }[S.page] || ['any', t('Drop to add'), t('.jar → mods of the selected instance · .mrpack → import modpack · .png → skin library')]);
  window.addEventListener('dragenter', e => {
    if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
    e.preventDefault();
    dragDepth++;
    const [, title, text] = dropKind();
    $('#dropTitle').textContent = title; $('#dropText').textContent = text;
    $('#dropOverlay').hidden = false;
  });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#dropOverlay').hidden = true; });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', async e => {
    e.preventDefault();
    dragDepth = 0;
    $('#dropOverlay').hidden = true;
    const files = [...(e.dataTransfer?.files || [])].map(f => api.pathForFile(f)).filter(Boolean);
    if (!files.length) return;
    const jars = files.filter(f => /\.jar$/i.test(f));
    const pngs = files.filter(f => /\.png$/i.test(f));
    const packs = files.filter(f => /\.mrpack$/i.test(f));
    try {
      if (S.page === 'admin' && jars.length) { stageJars((await call(api.admin.inspect(jars))).jars); return; }
      if (pngs.length) {
        const r = await call(api.skins.importPaths(pngs));
        S.skins.library = r.skins;
        toast('success', t('{0} skin(s) added to your library.', r.added.length));
        if (S.page !== 'skins') showPage('skins'); else renderSkinGrid();
      }
      if (packs.length) await importPack(packs[0]);
      if (jars.length && S.page !== 'admin') {
        const v = S.page === 'mods' ? contentVersion() : (S.contentVersion || selected());
        reportImport(await call(api.mods.importPaths(v, jars)));
        if (S.page !== 'mods') toast('info', t('Added to Minecraft {0}.', v));
      }
    } catch (err) { fail(err); }
  });

  // -----------------------------------------------------------------------
  // Daten nachladen
  // -----------------------------------------------------------------------
  const refreshVersions = debounce(async () => {
    try { S.versions = (await call(api.versions.list())).versions; } catch (_) { return; }
    applyVersions();
  }, 150);
  function applyVersions() {
    if (S.page === 'versions') renderVersions();
    if (S.page === 'home') renderHome(); else renderVersionMenu();
  }

  // -----------------------------------------------------------------------
  // Ereignisse aus dem Hauptprozess
  // -----------------------------------------------------------------------
  api.on.log(addLines);
  api.on.notify(n => { if (n) toast(n.type === 'error' ? 'error' : n.type === 'success' ? 'success' : 'info', tr(n.message)); });
  api.on.progress(p => {
    S.progress = p || { stage: 'idle' };
    if (S.progress.stage === 'running' || S.progress.stage === 'started') S.starting = false;
    renderPlay();
  });
  api.on.sessions(list => {
    const had = S.sessions.length;
    S.sessions = Array.isArray(list) ? list : [];
    renderPlay(); renderAccount(); renderTitlebar();
    if (S.page === 'home') renderHome();
    if (had && !S.sessions.length) { refreshVersions(); if (S.page === 'worlds') loadWorlds(); if (S.page === 'shots') loadShots(); }
  });
  api.on.crash(c => {
    if (!c) return;
    const a = c.analysis || { version: c.version, code: c.code, findings: [], report: null };
    S.lastCrash = a;
    renderCrashBanner();
    if (S.settings.showConsoleOnCrash !== false) showCrash(a);
    else toast('error', t('Minecraft {0} crashed (exit code {1}).', c.version, c.code), [{ label: t('Show analysis'), run: () => showCrash(a) }]);
  });
  api.on.accounts(applyAccounts);
  api.on.versions(list => { if (Array.isArray(list)) { S.versions = list; applyVersions(); } });
  let announced = null;
  api.on.update(u => {
    S.update = u || S.update;
    renderUpdate();
    if (S.update.status === 'available' && announced !== S.update.available) {
      announced = S.update.available;
      toast('info', t('New launcher update: version {0}.', S.update.available), [{ label: S.update.portable ? t('Download') : t('Update now'), run: updateNow }]);
    }
  });

  document.addEventListener('keydown', e => {
    if (!$('#lightbox').hidden) {
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') openLightbox(lbIndex - 1);
      if (e.key === 'ArrowRight') openLightbox(lbIndex + 1);
      return;
    }
    if (e.key === 'Escape' && !modalClose) { setConsole(false); $('#vpMenu').hidden = true; }
    if (e.ctrlKey && e.key === '`') setConsole(!$('#console').classList.contains('open'));
    if (e.ctrlKey && e.shiftKey && (e.key === 'A' || e.key === 'a')) { e.preventDefault(); showPage('admin'); }
  });

  // -----------------------------------------------------------------------
  // Start
  // -----------------------------------------------------------------------
  async function init() {
    try {
      const st = await call(api.state());
      Object.assign(S, {
        appVersion: st.appVersion, settings: st.settings, system: st.system, account: st.account, accounts: st.accounts || [],
        versions: st.versions || [], servers: st.servers || [], sessions: st.sessions || [], update: st.update || S.update,
        dataRoot: st.dataRoot, website: st.website, adminVisible: st.adminVisible, discordAvailable: st.discordAvailable,
        lastCrash: st.lastCrash || null
      });
      if (st.launching) S.progress = { stage: 'prepare', label: 'Starting Minecraft…', percent: null };
      for (const s of S.servers) if (s.status) S.status[s.id] = s.status;
    } catch (e) {
      fail(e);
    }
    I18N.setLanguage(S.settings.language || 'auto');
    I18N.translateDom(document.body);
    document.documentElement.lang = I18N.lang();
    $('#navAdmin').hidden = !S.adminVisible;
    S.contentVersion = selected();
    renderAccount();
    renderHome();
    renderSettings();
    refreshStatuses(S.servers.slice(0, 3));
    loadNews();
    setTimeout(() => $('#splash').classList.add('done'), 450);
    // Updates der Mods im Hintergrund pruefen (nur Anzeige)
    setTimeout(() => { if (S.versions.some(v => v.version === selected())) api.mods.checkUpdates(selected()).then(r => { if (r?.ok) { S.modUpdates[selected()] = r.updates; updateNavBadge(); } }).catch(() => {}); }, 4000);
  }
  init();
})();
