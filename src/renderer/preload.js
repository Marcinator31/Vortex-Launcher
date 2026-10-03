'use strict';
// Die einzige Bruecke zwischen Oberflaeche und Hauptprozess. Die Oberflaeche
// sieht nur diese Funktionen -- kein Node, kein Dateisystem.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const on = channel => cb => {
  const listener = (_e, value) => cb(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('vortex', {
  window: {
    minimize: () => ipcRenderer.send('win:minimize'),
    maximize: () => ipcRenderer.send('win:maximize'),
    close: () => ipcRenderer.send('win:close'),
    reload: () => ipcRenderer.send('win:reload'),
    onState: on('window-state')
  },
  /** Pfad einer per Drag & Drop abgelegten Datei (fuer Jars/Skins/Modpacks). */
  pathForFile: file => { try { return webUtils.getPathForFile(file) || ''; } catch (_) { return ''; } },
  state: () => call('state'),
  account: {
    login: () => call('account:login'),
    select: id => call('account:select', id),
    remove: id => call('account:remove', id),
    avatar: id => call('account:avatar', id)
  },
  versions: {
    list: () => call('versions:list'),
    select: v => call('versions:select', v),
    add: v => call('versions:add', v),
    remove: v => call('versions:remove', v),
    repair: v => call('versions:repair', v)
  },
  launch: {
    start: (version, serverId, address, opts) => call('launch:start', version, serverId || null, address || null, opts || null),
    stop: id => call('launch:stop', id)
  },
  mods: {
    list: v => call('mods:list', v),
    toggle: (v, f) => call('mods:toggle', v, f),
    remove: (v, f) => call('mods:remove', v, f),
    search: (q, v, page, sort) => call('mods:search', q, v, page, sort),
    install: (id, v) => call('mods:install', id, v),
    importFiles: v => call('mods:import', v),
    importPaths: (v, list) => call('mods:importPaths', v, list),
    checkUpdates: v => call('mods:checkUpdates', v),
    applyUpdates: (v, files) => call('mods:applyUpdates', v, files || null),
    performance: v => call('mods:performance', v),
    transfer: (from, to, opts) => call('mods:transfer', from, to, opts || {}),
    transferSkip: (from, to) => call('mods:transferSkip', from, to)
  },
  packs: {
    list: v => call('packs:list', v),
    remove: (v, f) => call('packs:remove', v, f),
    search: (q, v, page, sort) => call('packs:search', q, v, page, sort),
    install: (id, v) => call('packs:install', id, v)
  },
  shaders: {
    list: v => call('shaders:list', v),
    remove: (v, f) => call('shaders:remove', v, f),
    search: (q, v, page, sort) => call('shaders:search', q, v, page, sort),
    install: (id, v) => call('shaders:install', id, v),
    iris: v => call('shaders:iris', v)
  },
  worlds: {
    list: v => call('worlds:list', v),
    backup: (v, folder) => call('worlds:backup', v, folder),
    restore: (v, id) => call('worlds:restore', v, id),
    deleteBackup: (v, id) => call('worlds:deleteBackup', v, id),
    remove: (v, folder) => call('worlds:delete', v, folder)
  },
  hosting: {
    state: () => call('hosting:state'),
    start: (v, folder, opts) => call('hosting:start', v, folder, opts || {}),
    stop: () => call('hosting:stop'),
    restart: () => call('hosting:restart'),
    console: () => call('hosting:console'),
    command: text => call('hosting:command', text),
    getSettings: (v, folder) => call('hosting:getSettings', v, folder),
    setSettings: (v, folder, patch) => call('hosting:setSettings', v, folder, patch || {}),
    player: (name, action) => call('hosting:player', name, action),
    banned: () => call('hosting:banned')
  },
  plugins: {
    search: (q, v, page, sort) => call('plugins:search', q, v, page, sort),
    install: (id, v) => call('plugins:install', id, v),
    list: v => call('plugins:list', v),
    remove: (v, file) => call('plugins:remove', v, file),
    openFolder: v => call('plugins:openFolder', v)
  },
  shots: {
    list: v => call('shots:list', v),
    thumb: (v, f) => call('shots:thumb', v, f),
    full: (v, f) => call('shots:full', v, f),
    copy: (v, f) => call('shots:copy', v, f),
    show: (v, f) => call('shots:show', v, f),
    remove: (v, f) => call('shots:delete', v, f)
  },
  skins: {
    profile: () => call('skins:profile'),
    library: () => call('skins:library'),
    importFile: () => call('skins:importFile'),
    importPaths: list => call('skins:importPaths', list),
    importPlayer: name => call('skins:importPlayer', name),
    saveCurrent: () => call('skins:saveCurrent'),
    update: (id, patch) => call('skins:update', id, patch),
    remove: id => call('skins:remove', id),
    apply: id => call('skins:apply', id),
    reset: () => call('skins:reset'),
    setCape: id => call('skins:setCape', id || null)
  },
  pack: {
    export: (v, opts) => call('pack:export', v, opts),
    import: file => call('pack:import', file || null)
  },
  servers: {
    list: () => call('servers:list'),
    add: s => call('servers:add', s),
    remove: id => call('servers:remove', id),
    status: (id, force) => call('servers:status', id, Boolean(force)),
    favorite: (id, value) => call('servers:favorite', id, Boolean(value))
  },
  settings: {
    set: patch => call('settings:set', patch),
    pickJava: () => call('settings:pickJava'),
    inspectJava: p => call('settings:inspectJava', p)
  },
  crash: { report: () => call('crash:report') },
  logs: { share: (version, what) => call('logs:share', version, what) },
  friends: {
    status: () => call('friends:status'),
    req: (op, args) => call('friends:req', op, args || {}),
    face: uuid => call('friends:face', uuid),
    reconnect: () => call('friends:reconnect'),
    syncProfile: () => call('friends:syncProfile')
  },
  music: { tracks: () => call('music:tracks'), folder: () => call('music:folder') },
  importer: {
    scan: () => call('import:scan'),
    folder: () => call('import:folder'),
    run: (id, version, opts) => call('import:run', id, version, opts)
  },
  perf: {
    info: v => call('perf:info', v),
    renderDistance: (v, n) => call('perf:renderDistance', v, n)
  },
  admin: {
    status: () => call('admin:status'),
    signIn: token => call('admin:signIn', token),
    signOut: () => call('admin:signOut'),
    overview: () => call('admin:overview'),
    pickJars: () => call('admin:pickJars'),
    inspect: paths => call('admin:inspect', paths),
    publish: (file, version) => call('admin:publish', file, version),
    unpublish: (version, id) => call('admin:unpublish', version, id),
    promote: (version, id) => call('admin:promote', version, id),
    postNews: (title, body) => call('admin:postNews', title, body),
    deleteNews: id => call('admin:deleteNews', id),
    stats: () => call('admin:stats')
  },
  betatest: {
    view: () => call('betatest:view'),
    rebuild: () => call('betatest:rebuild'),
    check: (id, value) => call('betatest:check', id, value),
    report: (id, text, attachLog) => call('betatest:report', id, text, attachLog),
    resolve: id => call('betatest:resolve', id),
    send: () => call('betatest:send')
  },
  vortexRefresh: () => call('vortex:refresh'),
  news: () => call('news:get'),
  lastCrash: () => call('crash:last'),
  open: (what, version) => call('open', what, version),
  openExternal: url => call('openExternal', url),
  update: {
    check: () => call('update:check'),
    download: () => call('update:download'),
    install: () => call('update:install'),
    now: () => call('update:now')
  },
  on: {
    log: on('log'),
    notify: on('notify'),
    progress: on('progress'),
    sessions: on('sessions'),
    crash: on('crash'),
    accounts: on('accounts'),
    versions: on('versions'),
    update: on('update-state'),
    whatsnew: on('whatsnew'),
    join: on('join'),
    importProgress: on('import-progress'),
    friends: on('friends'),
    friendsNotify: on('friends-notify'),
    friendsOpen: on('friends-open'),
    betatest: on('betatest'),
    serverHistory: on('serverHistory'),
    repair: on('repair'),
    hosting: on('hosting'),
    hostingConsole: on('hosting-console')
  }
});
