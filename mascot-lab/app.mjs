import { primaryBots } from './bots-a.mjs';
import { alternateBots } from './bots-b.mjs';
import { drawSprite, frameFor, STATES } from './sprite-core.mjs';
import { bindRadioGroup, createButton } from './ui-controls.mjs';

const bots = [...primaryBots, ...alternateBots];
const body = document.body;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const heroCanvas = document.querySelector('#hero-sprite');
const pauseButton = document.querySelector('[data-action="pause"]');
const exportButton = document.querySelector('[data-action="export"]');
const themeButton = document.querySelector('[data-action="theme"]');
const statusMessage = document.querySelector('#status-message');
const selectorGroup = document.querySelector('#bot-selectors');
const roster = document.querySelector('#roster');
const frameInterval = 1000 / 8;
const downloadUrls = new Set();
const thumbnails = [];
const rosterTargets = [];
const presenceTargets = [
  { canvas: document.querySelector('#chat-sprite'), scale: 1 },
  { canvas: document.querySelector('#empty-sprite'), scale: 2 },
];

let selectedBot = bots[0];
let state = STATES[0];
let scale = 4;
let frame = 0;
let userPaused = false;
let animationId = null;
let lastFrameAt = 0;

const stateCopy = {
  idle: { description: 'A quiet blink. No hurry.', chat: 'Ready for your next question.' },
  thinking: { description: 'Curiosity, one pixel at a time.', chat: 'A thoughtful pose, just for this preview.' },
  working: { description: 'Little movements. Focused energy.', chat: 'A busy expression, not a real task.' },
  alert: { description: 'Eyes up. Something caught its attention.', chat: 'An attentive pose, not an incident alert.' },
};

function announce(message) {
  statusMessage.textContent = message;
}

function paused() {
  return userPaused || reducedMotion.matches;
}

function canAnimate() {
  return !paused() && !document.hidden;
}

function paintSprites() {
  drawSprite(heroCanvas, selectedBot, { state, frame, scale });
  heroCanvas.setAttribute('aria-label', `${selectedBot.name}, ${state} pixel mascot, ${32 * scale} pixels`);
  thumbnails.forEach(({ canvas, bot }) => drawSprite(canvas, bot, { state, frame, scale: 2 }));
  presenceTargets.forEach((target) => drawSprite(target.canvas, selectedBot, { state, frame, scale: target.scale }));
  rosterTargets.forEach(({ canvas, bot }) => {
    drawSprite(canvas, bot, { state: bot.id === selectedBot.id ? state : 'idle', frame, scale: 1 });
  });
  body.dataset.frame = String(frame);
}

function stopAnimation() {
  if (animationId !== null) window.cancelAnimationFrame(animationId);
  animationId = null;
}

function scheduleAnimation() {
  if (animationId === null && canAnimate()) animationId = window.requestAnimationFrame(tick);
}

function tick(timestamp) {
  animationId = null;
  if (!canAnimate()) return;
  if (timestamp - lastFrameAt >= frameInterval) {
    frame = (frame + 1) % 16;
    paintSprites();
    lastFrameAt = timestamp;
  }
  scheduleAnimation();
}

function updateMotion() {
  body.dataset.paused = String(paused());
  pauseButton.setAttribute('aria-pressed', String(paused()));
  pauseButton.disabled = reducedMotion.matches;
  pauseButton.querySelector('[data-pause-label]').textContent = reducedMotion.matches ? 'Motion reduced' : userPaused ? 'Resume' : 'Pause';
  pauseButton.querySelector('[data-pause-path]').setAttribute('d', userPaused && !reducedMotion.matches ? 'M7 4.5v15L19.5 12z' : 'M8.5 5v14M15.5 5v14');
  document.querySelector('#motion-label').textContent = reducedMotion.matches ? 'Reduced motion' : userPaused ? 'Paused' : '8 fps';
  stopAnimation();
  lastFrameAt = window.performance.now();
  scheduleAnimation();
}

function buildRoster() {
  roster.replaceChildren();
  rosterTargets.length = 0;
  const visibleBots = [selectedBot, ...bots.filter((bot) => bot.id !== selectedBot.id)].slice(0, 3);
  visibleBots.forEach((bot) => {
    const row = document.createElement('li');
    row.className = 'roster-row';
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    canvas.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.className = 'roster-name';
    name.textContent = bot.name;
    const status = document.createElement('span');
    status.className = 'roster-state';
    status.textContent = `${bot.id === selectedBot.id ? state : 'idle'} demo`;
    row.append(canvas, name, status);
    roster.append(row);
    rosterTargets.push({ canvas, bot });
  });
}

function updateDetails() {
  document.querySelector('#selected-index').textContent = `${String(bots.indexOf(selectedBot) + 1).padStart(2, '0')} / 06`;
  document.querySelector('#selected-name').textContent = selectedBot.name;
  document.querySelector('#selected-role').textContent = selectedBot.role;
  document.querySelector('#selected-tagline').textContent = selectedBot.tagline;
  document.querySelector('#selected-description').textContent = selectedBot.description;
  document.querySelectorAll('[data-selected-name]').forEach((name) => { name.textContent = selectedBot.name; });
  const basePixels = frameFor(selectedBot, 'idle', 0).reduce((count, row) => count + [...row].filter((pixel) => pixel !== '.').length, 0);
  document.querySelector('#pixel-details').textContent = `${selectedBot.silhouette} · ${basePixels} painted pixels`;
  document.querySelector('#state-description').textContent = stateCopy[state].description;
  document.querySelector('#chat-copy').textContent = stateCopy[state].chat;
  document.querySelector('#size-label').textContent = `${32 * scale} px`;
  body.dataset.selected = selectedBot.id;
  body.dataset.state = state;
  body.dataset.scale = String(scale);
  buildRoster();
}

bots.forEach((bot, index) => {
  const button = createButton({ label: `${bot.name}, ${bot.role}`, variant: 'ghost', className: 'specimen' });
  button.dataset.botId = bot.id;
  const number = document.createElement('span');
  number.className = 'specimen-number';
  number.textContent = String(index + 1).padStart(2, '0');
  number.setAttribute('aria-hidden', 'true');
  const indicator = document.createElement('span');
  indicator.className = 'selection-indicator';
  indicator.setAttribute('aria-hidden', 'true');
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  canvas.setAttribute('aria-hidden', 'true');
  const name = document.createElement('span');
  name.className = 'specimen-name';
  name.textContent = bot.name;
  const role = document.createElement('span');
  role.className = 'specimen-role';
  role.textContent = bot.role;
  button.append(number, indicator, canvas, name, role);
  selectorGroup.append(button);
  thumbnails.push({ canvas, bot });
});

const botControls = bindRadioGroup(selectorGroup, {
  attribute: 'data-bot-id',
  value: selectedBot.id,
  onChange(id) {
    selectedBot = bots.find((bot) => bot.id === id);
    frame = 0;
    updateDetails();
    paintSprites();
    announce(`${selectedBot.name} selected. ${selectedBot.role}.`);
  },
});

function selectState(next) {
  if (!STATES.includes(next)) return;
  state = next;
  frame = 0;
  stateControls.setValue(state);
  updateDetails();
  paintSprites();
  announce(`${selectedBot.name}: ${state} display state. Visual demo only.`);
}

const stateControls = bindRadioGroup(document.querySelector('.state-controls'), {
  attribute: 'data-state', value: state, onChange: selectState,
});

const scaleControls = bindRadioGroup(document.querySelector('.scale-controls'), {
  attribute: 'data-scale',
  value: String(scale),
  onChange(next) {
    scale = Number(next);
    body.dataset.scale = String(scale);
    document.querySelector('#size-label').textContent = `${32 * scale} px`;
    paintSprites();
    announce(`${scale} times preview size. ${32 * scale} by ${32 * scale} pixels.`);
  },
});

pauseButton.addEventListener('click', () => {
  userPaused = !userPaused;
  updateMotion();
  announce(userPaused ? 'All sprite animation paused.' : 'Sprite animation resumed.');
});

themeButton.addEventListener('click', () => {
  const light = body.dataset.theme !== 'light';
  body.classList.add('theme-switching');
  body.dataset.theme = light ? 'light' : 'dark';
  themeButton.setAttribute('aria-label', `Switch to ${light ? 'dark' : 'light'} theme`);
  themeButton.querySelector('[data-theme-label]').textContent = light ? 'Dark mode' : 'Light mode';
  // Flush the new theme before restoring hover transitions on the next frame.
  window.getComputedStyle(themeButton).backgroundColor;
  window.requestAnimationFrame(() => body.classList.remove('theme-switching'));
  announce(`${light ? 'Light' : 'Dark'} theme selected.`);
});

document.querySelector('[data-action="preview-thinking"]').addEventListener('click', () => selectState('thinking'));

exportButton.addEventListener('click', () => {
  const bot = selectedBot;
  const exportState = state;
  const exportScale = scale;
  const snapshot = document.createElement('canvas');
  drawSprite(snapshot, bot, { state: exportState, frame, scale: exportScale });
  exportButton.disabled = true;
  exportButton.setAttribute('aria-busy', 'true');
  exportButton.querySelector('[data-export-label]').textContent = 'Preparing PNG';
  snapshot.toBlob((blob) => {
    exportButton.disabled = false;
    exportButton.removeAttribute('aria-busy');
    exportButton.querySelector('[data-export-label]').textContent = 'Export PNG';
    if (!blob) {
      announce('PNG could not be created. Try exporting again.');
      return;
    }
    const url = URL.createObjectURL(blob);
    downloadUrls.add(url);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${bot.id}-${exportState}-${exportScale}x.png`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
      downloadUrls.delete(url);
    }, 1000);
    announce(`${bot.name} PNG exported. ${32 * exportScale} × ${32 * exportScale} pixels, transparent background.`);
  }, 'image/png');
});

reducedMotion.addEventListener('change', () => {
  updateMotion();
  announce(reducedMotion.matches ? 'Sprite animation paused for reduced motion.' : userPaused ? 'Reduced motion off. Animation remains paused.' : 'Reduced motion off. Animation resumed.');
});

document.addEventListener('visibilitychange', () => {
  stopAnimation();
  lastFrameAt = window.performance.now();
  scheduleAnimation();
});

window.addEventListener('pagehide', () => {
  stopAnimation();
  downloadUrls.forEach((url) => URL.revokeObjectURL(url));
  downloadUrls.clear();
});

window.addEventListener('pageshow', scheduleAnimation);

// Radio bindings own listeners for this document's lifetime (including BFCache).
void botControls;
void scaleControls;
updateDetails();
paintSprites();
updateMotion();
if (reducedMotion.matches) announce('Reduced motion enabled. Sprite animation is paused.');
