'use strict';
// Bilder fuer das Werbevideo (englische Oberflaeche, echte Seiten)
const path = require('path');
const fs = require('fs');
const V = '26.2';
exports.before = async ({ root }) => {
  const core = require(path.join(root, 'src', 'main', 'core'));
  const settings = require(path.join(root, 'src', 'main', 'settings'));
  settings.set({ selectedVersion: V, language: 'en', wallpaper: 'cherry', wallpaperMotion: true });
  const mods = core.paths.modsRoot(V);
  fs.mkdirSync(mods, { recursive: true });
  for (const n of ['sodium-fabric-0.8.2.jar', 'iris-1.10.8.jar', 'xaeros-minimap-25.jar', 'zoomify-2.15.jar']) fs.writeFileSync(path.join(mods, n), 'x');
};
exports.run = async ({ page, shot, sleep }) => {
  await sleep(1500);
  await shot('home');
  await page.click('#vpButton'); await sleep(500); await shot('home-versions'); await page.click('#vpButton'); await sleep(300);
  await page.click('[data-page="versions"]'); await sleep(700); await shot('versions');
  await page.click('[data-page="mods"]'); await sleep(900);
  if (await page.$('#pbNew')) {
    await page.click('#pbNew'); await page.fill('#ndName', 'PvP'); await page.click('.modal [data-go]'); await sleep(700);
    await page.click('#pbNew'); await page.fill('#ndName', 'Survival'); await page.click('.modal [data-go]'); await sleep(700);
    const pvp = await page.$('.pb-chip[data-pid="pvp"]'); if (pvp) { await pvp.click(); await sleep(800); }
  }
  await sleep(6000);
  await shot('mods-profiles');
  await page.click('[data-page="settings"]'); await sleep(700); await shot('settings');
  await page.evaluate(() => { const el = document.querySelector('#wallpaperGrid, .wp-grid, [id*="allpaper"]'); if (el) el.scrollIntoView({ block: 'center' }); }); await sleep(600); await shot('settings-wallpaper');
  await page.click('[data-page="servers"]'); await sleep(700); await shot('servers');
  for (const pg of ['hosting', 'friends', 'shaders']) { const el = await page.$(`[data-page="${pg}"]`); if (el) { await el.click(); await sleep(900); await shot(pg); } }
  await page.click('[data-page="home"]'); await sleep(1800); await shot('home-2');
};
