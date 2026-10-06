'use strict';
exports.before = async ({ root }) => {
  const settings = require(require('path').join(root, 'src', 'main', 'settings'));
  settings.set({ language: 'de', wallpaperInterval: 30 });
};
exports.run = async ({ page, shot }) => {
  await page.waitForTimeout(2500);
  await shot('home-wallpaper');
  await page.click('#wpChip [data-wp="1"]');
  await page.waitForTimeout(2500);
  await shot('home-next');
  await page.click('[data-page="mods"]');
  await page.waitForTimeout(1200);
  await shot('mods-backdrop');
  await page.click('[data-page="settings"]');
  await page.waitForTimeout(800);
  await page.evaluate(() => document.querySelector('#setWallpaper').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(800);
  await shot('settings-wallpaper');
};
