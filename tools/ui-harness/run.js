'use strict';
/**
 * UI-Pruefstand fuer den Launcher OHNE Electron: der echte Hauptprozess
 * (src/main/main.js) laeuft in Node mit einem nachgebauten "electron"-Modul,
 * die echte Oberflaeche (index.html + preload.js + app.js) in Chromium
 * (Playwright). IPC geht ueber page.exposeBinding -- also echte Handler,
 * echte Dateien (in einem Temp-Ordner), nur ohne Fenster-Rahmen.
 *
 *   node tools/ui-harness/run.js <szenario.js> [ausgabeordner]
 *
 * Das Szenario exportiert async ({ page, shot, data, invoke, sleep }) => {}.
 * Braucht: npm install --omit=dev, globales playwright.
 */
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..', '..');
const scenarioFile = path.resolve(process.argv[2] || '');
const outDir = path.resolve(process.argv[3] || path.join(os.tmpdir(), 'vx-ui'));
fs.mkdirSync(outDir, { recursive: true });
const tmp = process.env.VX_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'vx-ui-data-'));
process.env.APPDATA = tmp;

// ---------------------------------------------------------------- electron
const handlers = new Map();
const listeners = new Map();
let pageRef = null;
const sendQueue = [];
function toPage(channel, value) {
  if (!pageRef) { sendQueue.push([channel, value]); return; }
  pageRef.evaluate(([c, v]) => window.__vxEmit && window.__vxEmit(c, v), [channel, value]).catch(() => {});
}
class Emitter {
  constructor() { this._l = {}; }
  on(e, f) { (this._l[e] ||= []).push(f); return this; }
  once(e, f) { return this.on(e, f); }
  emit(e, ...a) { for (const f of this._l[e] || []) f(...a); }
  removeListener() { return this; }
}
class BrowserWindow extends Emitter {
  constructor(opts) {
    super();
    this.opts = opts;
    this.webContents = Object.assign(new Emitter(), {
      send: toPage, setWindowOpenHandler() {}, isDestroyed: () => false, openDevTools() {}, reload() {}
    });
    BrowserWindow.all.push(this);
  }
  loadFile(f) { this.file = f; return Promise.resolve(); }
  show() {} focus() {} restore() {} minimize() {} maximize() {} unmaximize() {} close() {}
  isMinimized() { return false; } isMaximized() { return false; } isFullScreen() { return false; } setFullScreen() {}
  isDestroyed() { return false; } isVisible() { return true; } setProgressBar() {} flashFrame() {}
  static getAllWindows() { return BrowserWindow.all; }
  static getFocusedWindow() { return BrowserWindow.all[0] || null; }
}
BrowserWindow.all = [];
const app = Object.assign(new Emitter(), {
  getPath: () => tmp,
  getVersion: () => require(path.join(ROOT, 'package.json')).version,
  getName: () => 'Vortex Client',
  getAppPath: () => ROOT,
  isPackaged: false,
  whenReady: () => Promise.resolve(),
  isReady: () => true,
  requestSingleInstanceLock: () => true,
  hasSingleInstanceLock: () => true,
  setAsDefaultProtocolClient: () => true,
  setAppUserModelId() {},
  quit() {}, exit() {}, relaunch() {},
  commandLine: { appendSwitch() {} },
  getLocale: () => 'de-DE'
});
const electron = {
  app,
  BrowserWindow,
  ipcMain: {
    handle: (ch, fn) => handlers.set(ch, fn),
    on: (ch, fn) => listeners.set(ch, fn),
    removeHandler: ch => handlers.delete(ch)
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showSaveDialog: async () => ({ canceled: true }),
    showMessageBox: async () => ({ response: 0 })
  },
  shell: {
    openExternal: async () => {}, openPath: async () => '', showItemInFolder() {},
    trashItem: async p => fs.rmSync(p, { recursive: true, force: true })
  },
  Menu: { setApplicationMenu() {}, buildFromTemplate: () => ({ popup() {} }) },
  protocol: { registerSchemesAsPrivileged() {}, handle() {} },
  net: { fetch: (...a) => fetch(...a) },
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }), createFromBuffer: () => ({ isEmpty: () => true, toPNG: () => Buffer.alloc(0) }) },
  powerMonitor: new Emitter(),
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) },
  clipboard: { writeText() {}, readText: () => '', writeImage() {} },
  Notification: class { static isSupported() { return false; } show() {} on() {} },
  autoUpdater: new Emitter()
};
const load = Module._load;
Module._load = function (req) {
  if (req === 'electron') return electron;
  return load.apply(this, arguments);
};

// Netz aus dem Hauptprozess (Updates, Freunde, News ...) gezielt abschalten,
// damit der Pruefstand reproduzierbar ist. Erlaubt: nichts.
if (!process.env.VX_NET) {
  global.fetch = async () => { throw new Error('fetch failed (ui-harness offline)'); };
}

async function main() {
  // Vorbereitung durch das Szenario (Dateien anlegen) vor dem Start
  const scenario = require(scenarioFile);
  if (scenario.before) await scenario.before({ data: tmp, root: ROOT });
  require(path.join(ROOT, 'src', 'main', 'main.js'));
  await new Promise(r => setTimeout(r, 300));
  const win = BrowserWindow.all[0];
  if (!win) throw new Error('No window was created.');

  const { chromium } = require(require.resolve('playwright', { paths: [require('child_process').execSync('npm root -g').toString().trim()] }));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: Number(process.env.VX_W || 1280), height: Number(process.env.VX_H || 800) }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.stack || e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.exposeBinding('__vxInvoke', async (_src, ch, args) => {
    const fn = handlers.get(ch);
    if (!fn) return { ok: false, error: `ui-harness: no handler for ${ch}` };
    return fn({ sender: win.webContents }, ...(args || []));
  });
  await page.exposeBinding('__vxSend', async (_src, ch, args) => { const fn = listeners.get(ch); if (fn) fn({ sender: win.webContents }, ...(args || [])); });
  const preload = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'preload.js'), 'utf8');
  await page.addInitScript(`(() => {
    const subs = {};
    window.__vxEmit = (c, v) => (subs[c] || []).forEach(f => f({}, v));
    const electron = {
      contextBridge: { exposeInMainWorld: (k, v) => { window[k] = v; } },
      ipcRenderer: {
        invoke: (c, ...a) => window.__vxInvoke(c, a),
        send: (c, ...a) => window.__vxSend(c, a),
        on: (c, f) => { (subs[c] ||= []).push(f); },
        removeListener: (c, f) => { subs[c] = (subs[c] || []).filter(x => x !== f); }
      },
      webUtils: { getPathForFile: () => '' }
    };
    const require = n => { if (n === 'electron') return electron; throw new Error('preload require ' + n); };
    ${preload}
  })();`);
  pageRef = page;
  await page.goto('file://' + win.file);
  for (const [c, v] of sendQueue.splice(0)) toPage(c, v);
  await page.waitForTimeout(900);

  let n = 0;
  const shot = async (name, opts = {}) => {
    const f = path.join(outDir, `${String(++n).padStart(2, '0')}-${name}.png`);
    await page.screenshot({ path: f, ...opts });
    return f;
  };
  const invoke = (ch, ...args) => handlers.get(ch)({ sender: win.webContents }, ...args);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let failed = null;
  try {
    await scenario.run({ page, shot, data: tmp, invoke, sleep, root: ROOT });
  } catch (e) { failed = e; }
  if (errors.length) console.log('PAGE ERRORS:\n' + errors.join('\n'));
  await browser.close();
  if (failed) { console.error('SCENARIO FAILED:', failed.stack || failed); process.exit(1); }
  console.log(`UI HARNESS OK -> ${outDir}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
