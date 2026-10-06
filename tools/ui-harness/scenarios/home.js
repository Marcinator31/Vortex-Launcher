'use strict';
exports.run = async ({ page, shot }) => {
  await shot('home');
  await page.click('#vpButton');
  await page.waitForTimeout(400);
  console.log('hero scrollTop', await page.evaluate(() => [...document.querySelectorAll('.hero, .hero *, #page-home, .main, main')].filter(e => e.scrollTop).map(e => e.className + ':' + e.scrollTop)));
  await shot('vp-open');
};
