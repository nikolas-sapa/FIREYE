import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createMascotServer } from '../server.mjs';
import { primaryBots } from '../bots-a.mjs';
import { alternateBots } from '../bots-b.mjs';

const crew = [...primaryBots, ...alternateBots];

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
  await page.waitForSelector('body[data-selected="chief"]');
  await page.evaluate(() => document.fonts.ready);
  assert.match(await page.locator('body').evaluate((node) => getComputedStyle(node).fontFamily), /Geist/i);
  assert.equal(await page.locator('button[data-bot-id]').count(), 6);

  const previewHashes = new Set();
  for (const { id, name } of crew) {
    await page.locator(`button[data-bot-id="${id}"]`).click();
    assert.equal(await page.locator('body').getAttribute('data-selected'), id);
    assert.equal((await page.locator('#selected-name').textContent()).trim(), name);
    previewHashes.add(await page.locator('#hero-sprite').evaluate((canvas) => canvas.toDataURL()));
  }
  assert.equal(previewHashes.size, 6);
  for (const bot of crew) {
    await page.locator(`button[data-bot-id="${bot.id}"]`).click();
    const signature = primaryBots.some((member) => member.id === bot.id) ? bot.palette.r ?? bot.palette.b : bot.palette.b;
    if (signature) {
      const expected = signature.slice(1).match(/../g).map((value) => Number.parseInt(value, 16));
      const shown = await page.locator('#selected-palette span').evaluateAll((spans) => spans.map((span) => getComputedStyle(span).backgroundColor));
      assert.ok(shown.includes(`rgb(${expected.join(', ')})`), `${bot.id} palette shows signature costume or optic color`);
    }
  }
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
  assert.match(download.suggestedFilename(), /tender.*\.png$/);
  const downloadPath = resolve(output, download.suggestedFilename());
  await download.saveAs(downloadPath);
  const png = await readFile(downloadPath);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.ok(png.readUInt32BE(16) >= 32 && png.readUInt32BE(20) >= 32);
  assert.equal(await page.locator('#hero-sprite').evaluate((canvas) => canvas.getContext('2d').getImageData(0, 0, 1, 1).data[3]), 0);

  const botButton = page.locator('button[data-bot-id="chief"]');
  await botButton.click();
  await botButton.focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('body').getAttribute('data-selected'), 'ranger');
  await page.keyboard.press('End');
  assert.equal(await page.locator('body').getAttribute('data-selected'), 'tender');
  await page.keyboard.press('Home');
  assert.equal(await page.locator('body').getAttribute('data-selected'), 'chief');
  const focus = await page.locator('button[data-bot-id="chief"]').evaluate((button) => ({ active: document.activeElement === button, outline: getComputedStyle(button).outlineStyle, width: getComputedStyle(button).outlineWidth, shadow: getComputedStyle(button).boxShadow }));
  assert.equal(focus.active, true);
  assert.ok((focus.outline !== 'none' && focus.width !== '0px') || focus.shadow !== 'none');
  await page.locator('button[data-state="idle"]').click();
  await page.locator('button[data-state="idle"]').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('body').getAttribute('data-state'), 'thinking');
  await page.keyboard.press('End');
  assert.equal(await page.locator('body').getAttribute('data-state'), 'alert');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('button[data-state="idle"]').click();
  await page.locator('button[data-scale="6"]').click();
  await page.evaluate(async (crew) => {
    const { drawSprite } = await import('/sprite-core.mjs');
    const sheet = document.createElement('section');
    sheet.id = 'qa-crew-sheet';
    sheet.style.cssText = 'display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:32px;padding:32px;background:#111111;color:#ededed;font-family:Geist Sans,sans-serif';
    for (const bot of crew) {
      const figure = document.createElement('figure');
      figure.style.cssText = 'margin:0;display:flex;flex-direction:column;align-items:center;gap:16px';
      const caption = document.createElement('figcaption');
      caption.textContent = `${bot.name} / ${bot.role}`;
      figure.append(caption);
      for (const scale of [6, 2, 1]) {
        const canvas = document.createElement('canvas');
        canvas.style.imageRendering = 'pixelated';
        drawSprite(canvas, bot, { state: 'idle', frame: 0, scale });
        figure.append(canvas);
      }
      sheet.append(figure);
    }
    document.body.append(sheet);
  }, crew);
  await page.locator('#qa-crew-sheet').screenshot({ path: resolve(output, 'fire-crew-contact-sheet.png') });
  await page.evaluate(() => document.querySelector('#qa-crew-sheet').remove());

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
  console.log(`ML03/ML04/MC03 browser PASS: Chief-first, 6 fire/rescue characters, 4 states, 3 scales, 2 themes, pause/resume, PNG, keyboard, reduced motion, 3 viewports; errors 0, external requests 0. Chromium ${await browser.version()}.`);
} finally {
  if (browser) await browser.close();
  await new Promise((done) => server.close(done));
}
