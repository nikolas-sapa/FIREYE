import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createMascotServer } from '../server.mjs';

// QA-only dependency, never imported by the gallery or installed into this repo.
const { chromium } = await import(process.env.FCC_PLAYWRIGHT_MODULE || 'playwright');
const output = resolve('.scratch/mascot-lab');
await mkdir(output, { recursive: true });
const server = createMascotServer();
await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.FCC_CHROMIUM_PATH ? { executablePath: process.env.FCC_CHROMIUM_PATH } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, reducedMotion: 'no-preference', acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  const outsideRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', (request) => { if (!request.url().startsWith(origin) && !request.url().startsWith('blob:') && !request.url().startsWith('data:')) outsideRequests.push(request.url()); });
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.waitForSelector('body[data-selected="scout"]');
  await page.evaluate(() => document.fonts.ready);
  assert.match(await page.locator('body').evaluate((node) => getComputedStyle(node).fontFamily), /Geist/i);
  assert.equal(await page.locator('button[data-bot-id]').count(), 6);

  const previewHashes = new Set();
  for (const id of ['scout', 'relay', 'pilot', 'wisp', 'rook', 'orbit']) {
    await page.locator(`button[data-bot-id="${id}"]`).click();
    assert.equal(await page.locator('body').getAttribute('data-selected'), id);
    assert.ok((await page.locator('#selected-name').textContent()).toLowerCase().includes(id));
    previewHashes.add(await page.locator('#hero-sprite').evaluate((canvas) => canvas.toDataURL()));
  }
  assert.equal(previewHashes.size, 6);
  for (const state of ['idle', 'thinking', 'working', 'alert']) {
    await page.locator(`button[data-state="${state}"]`).click();
    assert.equal(await page.locator('body').getAttribute('data-state'), state);
  }
  const scales = await page.locator('button[data-scale]').evaluateAll((buttons) => buttons.map((button) => Number(button.dataset.scale)));
  assert.equal(scales.length, 3);
  for (const scale of scales) {
    await page.locator(`button[data-scale="${scale}"]`).click();
    assert.equal(await page.locator('#hero-sprite').evaluate((canvas) => canvas.width), scale * 32);
  }

  const paused = page.locator('[data-action="pause"]');
  if ((await page.locator('body').getAttribute('data-paused')) !== 'true') await paused.click();
  const frozen = await page.locator('#hero-sprite').evaluate((canvas) => canvas.toDataURL());
  await page.waitForTimeout(360);
  assert.equal(await page.locator('#hero-sprite').evaluate((canvas) => canvas.toDataURL()), frozen);
  await paused.click();
  assert.equal(await page.locator('body').getAttribute('data-paused'), 'false');
  await page.waitForFunction((before) => document.querySelector('#hero-sprite').toDataURL() !== before, frozen, { timeout: 3000 });

  const downloadReady = page.waitForEvent('download');
  await page.locator('[data-action="export"]').click();
  const download = await downloadReady;
  assert.match(download.suggestedFilename(), /orbit.*\.png$/);
  const downloadPath = resolve(output, download.suggestedFilename());
  await download.saveAs(downloadPath);
  const png = await readFile(downloadPath);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.ok(png.readUInt32BE(16) >= 32 && png.readUInt32BE(20) >= 32);
  assert.equal(await page.locator('#hero-sprite').evaluate((canvas) => canvas.getContext('2d').getImageData(0, 0, 1, 1).data[3]), 0);

  const botButton = page.locator('button[data-bot-id="scout"]');
  await botButton.click();
  await botButton.focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('body').getAttribute('data-selected'), 'relay');
  await page.keyboard.press('End');
  assert.equal(await page.locator('body').getAttribute('data-selected'), 'orbit');
  await page.keyboard.press('Home');
  assert.equal(await page.locator('body').getAttribute('data-selected'), 'scout');
  const focus = await page.locator('button[data-bot-id="scout"]').evaluate((button) => ({ active: document.activeElement === button, outline: getComputedStyle(button).outlineStyle, width: getComputedStyle(button).outlineWidth, shadow: getComputedStyle(button).boxShadow }));
  assert.equal(focus.active, true);
  assert.ok((focus.outline !== 'none' && focus.width !== '0px') || focus.shadow !== 'none');
  await page.locator('button[data-state="idle"]').click();
  await page.locator('button[data-state="idle"]').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('body').getAttribute('data-state'), 'thinking');
  await page.keyboard.press('End');
  assert.equal(await page.locator('body').getAttribute('data-state'), 'alert');

  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: width === 375 ? 900 : 1080 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px overflow`);
    await page.mouse.click(40, 70);
    await page.locator('h1').scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);
    await page.screenshot({ path: resolve(output, `gallery-dark-${width}.png`), fullPage: true });
  }
  await page.locator('[data-action="theme"]').click();
  assert.equal(await page.locator('body').getAttribute('data-theme'), 'light');
  await page.waitForTimeout(250);
  await page.screenshot({ path: resolve(output, 'gallery-light-1440.png'), fullPage: true });
  await page.locator('[data-action="theme"]').click();
  assert.equal(await page.locator('body').getAttribute('data-theme'), 'dark');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(150);
  const reducedFrame = await page.locator('#hero-sprite').evaluate((canvas) => canvas.toDataURL());
  await page.waitForTimeout(360);
  assert.equal(await page.locator('#hero-sprite').evaluate((canvas) => canvas.toDataURL()), reducedFrame);
  await page.locator('button[data-state="working"]').click();
  const selectedReducedFrame = await page.locator('#hero-sprite').evaluate((canvas) => canvas.toDataURL());
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#hero-sprite').evaluate((canvas) => canvas.toDataURL()), selectedReducedFrame);
  assert.deepEqual(outsideRequests, []);
  assert.deepEqual(errors, []);
  console.log(`ML03/ML04 browser PASS: 6 characters, 4 states, 3 scales, 2 themes, pause/resume, PNG, keyboard, reduced motion, 3 viewports; errors 0, external requests 0. Chromium ${await browser.version()}.`);
} finally {
  if (browser) await browser.close();
  await new Promise((done) => server.close(done));
}
