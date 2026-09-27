'use strict';
/**
 * Vortex Client Launcher -- Hauptprozess.
 *
 * Fenster (rahmenlos, eigene Titelleiste), alle Schnittstellen zur
 * Oberflaeche (IPC) und der Lebenszyklus der App. Die eigentliche Arbeit
 * steckt in den Modulen daneben.
 */
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const core = require('./core');
const settings = require('./settings');
const instances = require('./instances');
const accounts = require('./accounts');
const servers = require('./servers');
const modrinth = require('./modrinth');
const launch = require('./launch');
const java = require('./java');
const updater = require('./updater');
const config = require('./config');
const vortexfiles = require('./vortexfiles');
const admin = require('./admin');
const skins = require('./skins');
const media = require('./media');
const mrpack = require('./mrpack');
const discord = require('./discord');
const news = require('./news');

const { paths, log, notify } = core;

// Nur ein Launcher gleichzeitig -- ein zweiter Start holt das Fenster nach vorn.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const w = core.getMainWindow();
    if (w) { w.show(); if (w.isMinimized()) w.restore(); w.focus(); }
  });
}

function createWindow() {
  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 1060, minHeight: 680,
    frame: false, show: false,
    backgroundColor: '#0E0B16',
    title: 'Vortex Client',
    icon: path.join(paths.assetsRoot(), 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'renderer', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  core.setMainWindow(win);
  win.once('ready-to-show', () => win.show());
  win.on('maximize', () => core.send('window-state', { maximized: true }));
  win.on('unmaximize', () => core.send('window-state', { maximized: false }));
  // Links nie im Launcher oeffnen, sondern im Browser (nur https).
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      event.preventDefault();
      win.setFullScreen(!win.isFullScreen());
    }
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  return win;
}

// ---------------------------------------------------------------------------
// IPC -- jede Antwort hat die Form { ok, ...daten } oder { ok:false, error }
// ---------------------------------------------------------------------------

function friendly(error) {
  const msg = String(error?.message || error || 'Unknown error');
  if (/gui\.closed|user\.cancel/i.test(msg)) return 'Sign-in was cancelled.';
  if (/error\.auth\.xsts\.userNotFound|no xbox/i.test(msg)) return 'This Microsoft account has no Xbox profile. Sign in once on minecraft.net first.';
  if (/error\.auth\.minecraft\.entitlements|does not own/i.test(msg)) return 'This Microsoft account does not own Minecraft: Java Edition.';
  if (/ENOTFOUND|EAI_AGAIN|fetch failed|network/i.test(msg)) return 'No connection to the internet (or the service is down).';
  return msg;
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      const result = await fn(...args);
      return { ok: true, ...(result && typeof result === 'object' && !Array.isArray(result) ? result : { value: result }) };
    } catch (error) {
      log(`${channel}: ${error?.stack || error}`, 'debug');
      return { ok: false, error: friendly(error) };
    }
  });
}

function versionsOverview() { return instances.allVersions().map(instances.summary); }

function adminVisible() {
  const acc = accounts.currentSummary();
  const names = config.admins.map(n => String(n).toLowerCase());
  return admin.hasToken() || Boolean(acc && (names.includes(acc.username.toLowerCase()) || names.includes(String(acc.uuid).toLowerCase())));
}

/** Vortex-Dateien aus dem Admin-Bereich holen und die Oberflaeche informieren. */
async function refreshVortexFiles(quiet = true) {
  const r = await vortexfiles.refresh(v => instances.packagedEntries(v));
  for (const u of r.updated) notify('success', `${u.name} ${u.newVersion} for Minecraft ${u.version} downloaded.`);
  if (r.updated.length) {
    for (const v of new Set(r.updated.map(u => u.version))) {
      try { if (core.exists(paths.instanceRoot(v))) instances.syncBundled(v); } catch (_) {}
    }
  }
  if (r.updated.length || !quiet) core.send('versions', versionsOverview());
  return r;
}

function fullState() {
  return {
    appVersion: app.getVersion(),
    settings: settings.get(),
    system: settings.systemInfo(),
    account: accounts.currentSummary(),
    accounts: accounts.list(),
    versions: versionsOverview(),
    servers: servers.list(),
    sessions: launch.sessionList(),
    launching: launch.isLaunching(),
    update: updater.get(),
    dataRoot: paths.dataRoot,
    adminVisible: adminVisible(),
    discordAvailable: discord.available(),
    website: config.website,
    lastCrash: launch.lastCrash()
  };
}

function registerIpc() {
  // Fenster
  ipcMain.on('win:minimize', () => core.getMainWindow()?.minimize());
  ipcMain.on('win:maximize', () => { const w = core.getMainWindow(); if (w) w.isMaximized() ? w.unmaximize() : w.maximize(); });
  ipcMain.on('win:close', () => core.getMainWindow()?.close());

  handle('state', () => fullState());

  // Konten
  const accountState = () => ({ account: accounts.currentSummary(), accounts: accounts.list(), adminVisible: adminVisible() });
  handle('account:login', async () => { await accounts.login(); return accountState(); });
  handle('account:select', id => { accounts.select(id); return accountState(); });
  handle('account:remove', id => { accounts.remove(id); return accountState(); });
  handle('account:avatar', async id => ({ avatar: await accounts.avatar(id) }));

  // Versionen
  handle('versions:list', () => ({ versions: versionsOverview() }));
  handle('versions:select', v => { instances.requireVersion(v); return { settings: settings.set({ selectedVersion: v }) }; });
  handle('versions:add', async v => { const added = await instances.addVersion(v); settings.set({ selectedVersion: added }); return { version: added, versions: versionsOverview() }; });
  handle('versions:remove', v => { instances.removeCustomVersion(v); if (settings.get().selectedVersion === v) settings.set({ selectedVersion: instances.allVersions()[0] }); return { versions: versionsOverview(), settings: settings.get() }; });
  handle('versions:repair', async v => { const r = await instances.prepare(v); notify('success', `Minecraft ${r.version} checked: Fabric ${r.loaderVersion}, ${r.copied} file(s) updated.`); return { versions: versionsOverview() }; });

  // Spielen
  handle('launch:start', async (version, serverId) => launch.start({ version, serverId }));
  handle('launch:stop', id => ({ stopped: launch.stop(id) }));

  // Mods
  handle('mods:list', v => {
    // Vortex-Dateien schon vor dem ersten Start einrichten, damit die Liste nicht leer ist.
    if (instances.bundledVersions().includes(v)) { try { instances.syncBundled(v); } catch (e) { log(`Vortex files for ${v}: ${e.message}`, 'warn'); } }
    return { mods: instances.listMods(v) };
  });
  handle('mods:toggle', (v, f) => instances.toggleMod(v, f));
  handle('mods:remove', async (v, f) => { await instances.removeMod(v, f); return {}; });
  handle('mods:search', (q, v, page, sort) => modrinth.search('mod', q, v, page, sort));
  handle('mods:install', (id, v) => modrinth.installMod(id, v));
  handle('mods:import', async v => {
    instances.requireVersion(v);
    const pick = await dialog.showOpenDialog(core.getMainWindow(), { title: 'Add mods', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Fabric mods', extensions: ['jar'] }] });
    if (pick.canceled) return { added: [], skipped: [] };
    return instances.importMods(v, pick.filePaths);
  });

  handle('mods:importPaths', (v, list) => {
    instances.requireVersion(v);
    const files = (Array.isArray(list) ? list : []).map(String).filter(f => /\.jar$/i.test(f)).slice(0, 50);
    return instances.importMods(v, files);
  });

  // Resource Packs
  handle('packs:list', v => ({ packs: instances.listPacks(v) }));
  handle('packs:remove', async (v, f) => { await instances.removePack(v, f); return {}; });
  handle('packs:search', (q, v, page, sort) => modrinth.search('pack', q, v, page, sort));
  handle('packs:install', (id, v) => modrinth.installPack(id, v));

  // Server
  handle('servers:list', () => ({ servers: servers.list() }));
  handle('servers:add', s => ({ server: servers.add(s || {}), servers: servers.list() }));
  handle('servers:remove', id => { servers.remove(id); return { servers: servers.list() }; });
  handle('servers:status', (id, force) => servers.status(id, force).then(status => ({ status })));

  // Einstellungen
  handle('settings:set', patch => {
    const before = settings.get();
    const next = settings.set(patch || {});
    // Addon an/aus: gleich in allen vorhandenen Vortex-Instanzen umsetzen.
    if (before.includeAddon !== next.includeAddon) {
      for (const v of instances.bundledVersions()) {
        try { if (core.exists(paths.instanceRoot(v))) instances.syncBundled(v); } catch (_) {}
      }
    }
    if (before.discord !== next.discord) {
      const run = launch.sessionList()[0];
      discord.update(run ? { state: 'playing', version: run.version, client: instances.bundleInfo(run.version).clientVersion, since: run.startedAt } : { state: 'launcher' });
    }
    return { settings: next };
  });
  handle('settings:pickJava', async () => {
    const pick = await dialog.showOpenDialog(core.getMainWindow(), { title: 'Choose java.exe', properties: ['openFile'], filters: [{ name: 'Java', extensions: process.platform === 'win32' ? ['exe'] : ['*'] }] });
    if (pick.canceled || !pick.filePaths[0]) return { canceled: true };
    const info = await java.inspect(pick.filePaths[0]);
    if (!info.ok) throw new Error(info.error || 'That is not a working Java.');
    return { settings: settings.set({ javaPath: info.binary }), major: info.major };
  });
  handle('settings:inspectJava', async p => java.inspect(p));

  // Ordner & Logs
  handle('open', async (what, version) => {
    let target = null;
    switch (what) {
      case 'data': target = paths.dataRoot; break;
      case 'instance': target = paths.instanceRoot(instances.requireVersion(version)); break;
      case 'mods': target = paths.modsRoot(instances.requireVersion(version)); break;
      case 'resourcepacks': target = paths.resourcePacksRoot(instances.requireVersion(version)); break;
      case 'shaderpacks': target = paths.shaderPacksRoot(instances.requireVersion(version)); break;
      case 'screenshots': target = path.join(paths.instanceRoot(instances.requireVersion(version)), 'screenshots'); break;
      case 'crashes': target = paths.crashReportsRoot(instances.requireVersion(version)); break;
      case 'log': target = paths.launchLog; break;
      case 'saves': target = media.savesRoot(instances.requireVersion(version)); break;
      case 'backups': target = media.backupsRoot(instances.requireVersion(version)); break;
      case 'skins': target = path.join(paths.dataRoot, 'skins'); break;
      default: throw new Error('Unknown folder.');
    }
    if (what !== 'log') core.ensureDir(target);
    const err = await shell.openPath(target);
    if (err) throw new Error(err);
    return {};
  });
  handle('openExternal', async url => {
    if (!/^https:\/\//i.test(String(url || ''))) throw new Error('Only https links can be opened.');
    await shell.openExternal(String(url));
    return {};
  });

  // Vortex-Dateien (fuer alle)
  handle('vortex:refresh', async () => { const r = await refreshVortexFiles(false); return { updated: r.updated, error: r.error || null, versions: versionsOverview() }; });

  // Admin-Bereich
  handle('admin:status', () => admin.status());
  handle('admin:signIn', token => admin.signIn(token));
  handle('admin:signOut', () => admin.signOut());
  handle('admin:overview', () => {
    const packaged = {};
    for (const v of instances.packagedVersions()) packaged[v] = instances.packagedEntries(v);
    return admin.overview(packaged);
  });
  handle('admin:pickJars', async () => {
    const pick = await dialog.showOpenDialog(core.getMainWindow(), { title: 'Choose Vortex jars', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Fabric mods', extensions: ['jar'] }] });
    if (pick.canceled) return { jars: [] };
    return { jars: pick.filePaths.map(f => { try { return admin.inspectJar(f); } catch (e) { return { path: f, file: path.basename(f), error: e.message }; } }) };
  });
  handle('admin:inspect', paths_ => ({ jars: (Array.isArray(paths_) ? paths_ : []).slice(0, 20).map(f => { try { return admin.inspectJar(f); } catch (e) { return { path: f, file: path.basename(String(f)), error: e.message }; } }) }));
  handle('admin:publish', async (file, version) => { const r = await admin.publish(file, version); void refreshVortexFiles(false); return r; });
  handle('admin:unpublish', async (version, id) => { await admin.unpublish(version, id); void refreshVortexFiles(false); return {}; });
  handle('admin:postNews', (title, body) => admin.postNews(title, body));
  handle('admin:deleteNews', id => admin.deleteNews(id));

  // Mod-Updates & Pakete
  handle('mods:checkUpdates', v => modrinth.checkUpdates(v));
  handle('mods:applyUpdates', (v, files) => modrinth.applyUpdates(v, Array.isArray(files) ? files : null));
  handle('mods:performance', v => modrinth.installPerformancePack(v));

  // Shader
  handle('shaders:list', v => media.listShaders(v));
  handle('shaders:remove', (v, f) => media.removeShader(v, f));
  handle('shaders:search', (q, v, page, sort) => modrinth.search('shader', q, v, page, sort));
  handle('shaders:install', (id, v) => modrinth.installShader(id, v));
  handle('shaders:iris', v => modrinth.installIris(v));

  // Skins
  handle('skins:profile', () => skins.profile());
  handle('skins:library', () => ({ skins: skins.library() }));
  handle('skins:importFile', async () => {
    const pick = await dialog.showOpenDialog(core.getMainWindow(), { title: 'Choose a skin', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Skin (PNG)', extensions: ['png'] }] });
    if (pick.canceled) return { added: [] };
    const added = [], errors = [];
    for (const f of pick.filePaths) { try { added.push(skins.importFile(f)); } catch (e) { errors.push(`${path.basename(f)}: ${e.message}`); } }
    if (!added.length && errors.length) throw new Error(errors[0]);
    return { added, errors, skins: skins.library() };
  });
  handle('skins:importPaths', list => {
    const added = [];
    for (const f of (Array.isArray(list) ? list : []).slice(0, 20)) added.push(skins.importFile(f));
    return { added, skins: skins.library() };
  });
  handle('skins:importPlayer', async name => ({ added: await skins.importPlayer(name), skins: skins.library() }));
  handle('skins:saveCurrent', async () => ({ added: await skins.saveCurrent(), skins: skins.library() }));
  handle('skins:update', (id, patch) => { skins.update(id, patch || {}); return { skins: skins.library() }; });
  handle('skins:remove', id => { skins.remove(id); return { skins: skins.library() }; });
  handle('skins:apply', async id => ({ profile: await skins.apply(id) }));
  handle('skins:reset', async () => ({ profile: await skins.reset() }));
  handle('skins:setCape', async id => ({ profile: await skins.setCape(id || null) }));

  // Welten & Backups
  handle('worlds:list', async v => ({ worlds: await media.listWorlds(v) }));
  handle('worlds:backup', (v, folder) => media.backupWorld(v, folder, 'manual'));
  handle('worlds:restore', (v, id) => media.restoreBackup(v, id));
  handle('worlds:deleteBackup', (v, id) => media.deleteBackup(v, id));
  handle('worlds:delete', (v, folder) => media.deleteWorld(v, folder));

  // Screenshots
  handle('shots:list', v => ({ shots: media.listScreenshots(v) }));
  handle('shots:thumb', (v, f) => ({ data: media.thumbnail(v, f) }));
  handle('shots:full', (v, f) => ({ data: media.fullImage(v, f) }));
  handle('shots:copy', (v, f) => media.copyScreenshot(v, f));
  handle('shots:show', (v, f) => media.showScreenshot(v, f));
  handle('shots:delete', (v, f) => media.deleteScreenshot(v, f));

  // Modpack Export/Import
  handle('pack:export', async (v, opts) => {
    const ver = instances.requireVersion(v);
    const pick = await dialog.showSaveDialog(core.getMainWindow(), { title: 'Export instance', defaultPath: `Vortex-${ver}.mrpack`, filters: [{ name: 'Modrinth modpack', extensions: ['mrpack'] }] });
    if (pick.canceled || !pick.filePath) return { canceled: true };
    const r = await mrpack.exportPack(ver, pick.filePath, opts || {});
    shell.showItemInFolder(pick.filePath);
    return r;
  });
  handle('pack:import', async filePath => {
    let file = filePath;
    if (!file) {
      const pick = await dialog.showOpenDialog(core.getMainWindow(), { title: 'Import modpack', properties: ['openFile'], filters: [{ name: 'Modrinth modpack', extensions: ['mrpack'] }] });
      if (pick.canceled || !pick.filePaths[0]) return { canceled: true };
      file = pick.filePaths[0];
    }
    if (!/\.mrpack$/i.test(String(file))) throw new Error('Choose a .mrpack file.');
    const r = await mrpack.importPack(file);
    return { ...r, versions: versionsOverview() };
  });

  // News
  handle('news:get', async () => ({ items: await news.get() }));
  handle('crash:last', () => ({ analysis: launch.lastCrash() }));

  // Updates
  handle('update:check', async () => ({ update: await updater.check() }));
  handle('update:download', async () => ({ update: await updater.download() }));
  handle('update:install', () => { updater.install(); return {}; });
}

process.on('uncaughtException', e => core.appendFileLog(paths.crashLog, `uncaughtException: ${e?.stack || e}`));
process.on('unhandledRejection', e => core.appendFileLog(paths.crashLog, `unhandledRejection: ${e?.stack || e}`));

app.whenReady().then(() => {
  if (!app.hasSingleInstanceLock()) return;
  core.ensureDir(paths.dataRoot);
  accounts.load();
  updater.setup();
  registerIpc();
  createWindow();
  log(`Vortex Client Launcher ${app.getVersion()} started.`);
  // Einmalige Wartung im Hintergrund -- NICHT jede Sekunde wie frueher.
  setTimeout(() => {
    try { instances.maintainAll(); } catch (e) { log(`Maintenance: ${e.message}`, 'warn'); }
    void accounts.refreshAllQuietly().then(() => core.send('accounts', { account: accounts.currentSummary(), accounts: accounts.list(), adminVisible: adminVisible() }));
    void refreshVortexFiles().catch(() => {});
    discord.update({ state: 'launcher' });
  }, 1500);
  // Neue Vortex-Dateien alle 30 Minuten pruefen
  setInterval(() => { void refreshVortexFiles().catch(() => {}); }, 30 * 60 * 1000);
  updater.startBackground();
});

app.on('window-all-closed', () => { updater.stopBackground(); discord.stop(); app.quit(); });
