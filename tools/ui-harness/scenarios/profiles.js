'use strict';
// Mod-Profile: anlegen, wechseln, Startseiten-Auswahl, Menue, Loeschen.
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const V = '1.20.1';

exports.before = async ({ root }) => {
  const core = require(path.join(root, 'src', 'main', 'core'));
  const settings = require(path.join(root, 'src', 'main', 'settings'));
  core.writeJson(core.paths.customVersionsFile, [V]);
  settings.set({ selectedVersion: V, language: 'de' });
  const mods = core.paths.modsRoot(V);
  fs.mkdirSync(mods, { recursive: true });
  for (const n of ['sodium-fabric-0.5.13.jar', 'iris-1.7.2.jar', 'xaeros-minimap-24.jar', 'zoomify-2.13.jar.disabled']) fs.writeFileSync(path.join(mods, n), 'x');
  fs.mkdirSync(path.join(core.paths.instanceRoot(V), 'config'), { recursive: true });
  fs.writeFileSync(path.join(core.paths.instanceRoot(V), 'config', 'sodium-options.json'), '{}');
};

exports.run = async ({ page, shot, invoke }) => {
  await page.click('[data-page="mods"]').catch(async () => { await page.evaluate(() => document.querySelector('[data-page="mods"], [data-nav="mods"]')?.click()); });
  await page.waitForSelector('#profileBar .pb-chip');
  await shot('mods-standard');

  await page.click('#pbNew');
  await page.fill('#ndName', 'PvP');
  await shot('new-dialog');
  await page.click('.modal [data-go]');
  await page.waitForFunction(() => document.querySelectorAll('#profileBar .pb-chip').length === 2);
  await page.waitForTimeout(300);
  await shot('pvp-active');
  let st = await invoke('profiles:list', V);
  assert.strictEqual(st.active, 'pvp');
}
exports.run2 = exports.run;
exports.run = async (ctx) => {
  const { page, shot, invoke } = ctx;
  await exports.run2(ctx);
  // Startseite: Profilwahl taucht auf
  await page.click('[data-page="home"]');
  await page.waitForSelector('#profilePicker:not([hidden])');
  await page.click('#ppButton');
  await page.waitForSelector('#ppMenu:not([hidden]) [data-pid]');
  await page.waitForTimeout(400);
  await shot('home-profile-menu');
  await page.click('#ppButton'); await page.click('#vpButton'); await page.waitForTimeout(400); await shot('home-version-menu'); await page.click('#vpButton'); await page.click('#ppButton'); await page.waitForTimeout(200);
  await page.click('#ppMenu [data-pid="default"]');
  await page.waitForFunction(() => document.querySelector('#ppValue').textContent === 'Standard');
  assert.strictEqual((await invoke('profiles:list', V)).active, 'default');
  // Menue an einem Profil
  await page.click('[data-page="mods"]');
  await page.waitForSelector('.pb-chip[data-pid="pvp"]');
  await page.click('.pb-chip[data-pid="pvp"] [data-more]');
  await page.waitForSelector('.pb-menu');
  await page.waitForTimeout(400);
  await shot('chip-menu');
  await page.click('.pb-menu button.danger');
  await page.click('.modal [data-r="1"]');
  await page.waitForFunction(() => !document.querySelector('.pb-chip[data-pid="pvp"]'));
  await page.click('[data-page="home"]');
  await page.waitForSelector('#profilePicker[hidden]', { state: 'attached' });
  await shot('home-single-profile');
};
