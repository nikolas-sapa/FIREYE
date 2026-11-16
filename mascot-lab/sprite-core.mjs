export const GRID_SIZE = 32;
export const STATES = Object.freeze(['idle', 'thinking', 'working', 'alert']);

const HEX_COLOR = /^#(?:[\da-f]{3}|[\da-f]{6})$/i;
const TEXT_FIELDS = ['id', 'name', 'role', 'tagline', 'description', 'silhouette'];

function isRecord(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Validate both the catalog metadata and every source-art pixel. */
export function validateBot(bot) {
  if (!isRecord(bot)) throw new TypeError('Bot must be a plain object.');
  for (const field of TEXT_FIELDS) {
    if (typeof bot[field] !== 'string' || bot[field].trim().length === 0) {
      throw new TypeError(`Bot ${field} must be a non-empty string.`);
    }
  }
  if (!isRecord(bot.palette) || Object.keys(bot.palette).length === 0) {
    throw new TypeError('Bot palette must be a non-empty plain object.');
  }
  for (const [symbol, color] of Object.entries(bot.palette)) {
    if (symbol.length !== 1 || symbol === '.' || /\s/.test(symbol)) {
      throw new TypeError('Palette symbols must be single non-whitespace characters, except dot.');
    }
    if (typeof color !== 'string' || !HEX_COLOR.test(color)) {
      throw new TypeError(`Palette color for ${symbol} must be a three- or six-digit hex color.`);
    }
  }
  if (!Array.isArray(bot.pixels) || bot.pixels.length !== GRID_SIZE) {
    throw new TypeError(`Bot pixels must contain exactly ${GRID_SIZE} rows.`);
  }
  let opaque = 0;
  for (const row of bot.pixels) {
    if (typeof row !== 'string' || row.length !== GRID_SIZE) {
      throw new TypeError(`Every pixel row must contain exactly ${GRID_SIZE} characters.`);
    }
    for (let x = 0; x < GRID_SIZE; x += 1) {
      const symbol = row[x];
      if (symbol !== '.') {
        if (!Object.hasOwn(bot.palette, symbol)) {
          throw new TypeError(`Pixel symbol ${symbol} is missing from the palette.`);
        }
        opaque += 1;
      }
    }
  }
  if (opaque === 0) throw new TypeError('Bot source art must contain visible pixels.');
  return true;
}

function colorData(symbol, hex) {
  const expanded = hex.length === 4
    ? hex.slice(1).split('').map((digit) => digit + digit).join('')
    : hex.slice(1);
  const red = Number.parseInt(expanded.slice(0, 2), 16);
  const green = Number.parseInt(expanded.slice(2, 4), 16);
  const blue = Number.parseInt(expanded.slice(4, 6), 16);
  return {
    symbol,
    red,
    green,
    blue,
    luminance: red * 0.2126 + green * 0.7152 + blue * 0.0722,
    chroma: Math.max(red, green, blue) - Math.min(red, green, blue),
  };
}

function boundsFor(grid) {
  const bounds = { minX: GRID_SIZE, minY: GRID_SIZE, maxX: -1, maxY: -1 };
  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      if (grid[y][x] === '.') continue;
      bounds.minX = Math.min(bounds.minX, x);
      bounds.maxX = Math.max(bounds.maxX, x);
      bounds.minY = Math.min(bounds.minY, y);
      bounds.maxY = Math.max(bounds.maxY, y);
    }
  }
  return bounds;
}

function put(grid, x, y, symbol) {
  if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) return false;
  grid[y][x] = symbol;
  return true;
}

function componentsFor(grid, symbol) {
  const seen = new Set();
  const components = [];
  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      const index = y * GRID_SIZE + x;
      if (grid[y][x] !== symbol || seen.has(index)) continue;
      const points = [[x, y]];
      seen.add(index);
      for (let cursor = 0; cursor < points.length; cursor += 1) {
        const [px, py] = points[cursor];
        for (const [nx, ny] of [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]]) {
          if (nx < 0 || nx >= GRID_SIZE || ny < 0 || ny >= GRID_SIZE) continue;
          const next = ny * GRID_SIZE + nx;
          if (grid[ny][nx] === symbol && !seen.has(next)) {
            seen.add(next);
            points.push([nx, ny]);
          }
        }
      }
      components.push(points);
    }
  }
  return components;
}

// Semantic eye ink (e) is optional. Small contrast clusters are the fallback.
// Geometry and palette drive every character; no catalog IDs are inspected.
function eyesFor(grid, colors, bounds) {
  const candidates = [...colors].sort((a, b) => {
    if (a.symbol === 'e') return -1;
    if (b.symbol === 'e') return 1;
    return b.luminance - a.luminance;
  });
  const faceTop = bounds.minY + (bounds.maxY - bounds.minY) * 0.28;
  const faceBottom = bounds.minY + (bounds.maxY - bounds.minY) * 0.7;
  for (const ink of candidates) {
    const parts = componentsFor(grid, ink.symbol).filter((points) => {
      const xs = points.map(([x]) => x);
      const ys = points.map(([, y]) => y);
      return points.length >= 2 && points.length <= 16
        && Math.max(...xs) - Math.min(...xs) <= 4
        && Math.max(...ys) - Math.min(...ys) <= 4
        && Math.min(...ys) >= faceTop && Math.max(...ys) <= faceBottom;
    });
    if (parts.length === 0 || parts.length > 3) continue;
    return parts.map((points) => {
      const neighbors = new Map();
      for (const [x, y] of points) {
        for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
          const symbol = grid[ny]?.[nx];
          if (symbol && symbol !== '.' && symbol !== ink.symbol) {
            neighbors.set(symbol, (neighbors.get(symbol) ?? 0) + 1);
          }
        }
      }
      const background = [...neighbors].sort((a, b) => b[1] - a[1])[0]?.[0]
        ?? [...colors].sort((a, b) => a.luminance - b.luminance)[0].symbol;
      return { points, symbol: ink.symbol, background };
    });
  }
  return [];
}

function expression(grid, eyes, kind, offset = 0) {
  for (const eye of eyes) {
    const xs = eye.points.map(([x]) => x);
    const ys = eye.points.map(([, y]) => y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const middleY = Math.floor((Math.min(...ys) + Math.max(...ys)) / 2);
    for (const [x, y] of eye.points) put(grid, x, y, eye.background);
    if (kind === 'blink') {
      for (let x = minX; x <= maxX; x += 1) put(grid, x, middleY, eye.symbol);
      continue;
    }
    const canMove = eye.points.every(([x, y]) => grid[y]?.[x + offset] === eye.background);
    for (const [x, y] of eye.points) put(grid, x + (canMove ? offset : 0), y, eye.symbol);
    if (kind === 'wide') {
      for (const x of [minX - 1, maxX + 1]) {
        if (grid[middleY]?.[x] === eye.background) put(grid, x, middleY, eye.symbol);
      }
    }
  }
}

function shift(grid, dx, dy) {
  const bounds = boundsFor(grid);
  if (bounds.minX + dx < 0 || bounds.maxX + dx >= GRID_SIZE
    || bounds.minY + dy < 0 || bounds.maxY + dy >= GRID_SIZE) return grid;
  const moved = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill('.'));
  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      if (grid[y][x] !== '.') put(moved, x + dx, y + dy, grid[y][x]);
    }
  }
  return moved;
}

function indicator(grid, bounds, symbol) {
  const center = Math.floor((bounds.minX + bounds.maxX) / 2);
  const row = Math.round(bounds.minY + (bounds.maxY - bounds.minY) * 0.75);
  for (let distance = 0; distance < GRID_SIZE; distance += 1) {
    for (const x of [center - distance, center + distance]) {
      if (grid[row]?.[x] && grid[row][x] !== '.') {
        put(grid, x, row, symbol);
        return;
      }
    }
  }
  // A non-humanoid or sparse source still gets a bounded visible state change.
  for (let y = bounds.maxY; y >= bounds.minY; y -= 1) {
    const x = grid[y].findIndex((pixel) => pixel !== '.');
    if (x !== -1) {
      put(grid, x, y, symbol);
      return;
    }
  }
}

function fallbackBlink(grid, bounds, colors) {
  for (let y = bounds.maxY; y >= bounds.minY; y -= 1) {
    const x = grid[y].findIndex((pixel) => pixel !== '.');
    if (x === -1) continue;
    const current = grid[y][x];
    const replacement = [...colors].sort((a, b) => b.luminance - a.luminance)
      .find((color) => color.symbol !== current);
    put(grid, x, y, replacement?.symbol ?? '.');
    return;
  }
}

// Long, disconnected runs beside the central pod read as propeller blades.
// Shift only the blade ink, leaving the motor mounts fixed in place.
function spinAccessories(grid, bounds, phase) {
  const center = (bounds.minX + bounds.maxX) / 2;
  const top = Math.floor(bounds.minY + (bounds.maxY - bounds.minY) * 0.2);
  for (let y = bounds.minY; y <= top; y += 1) {
    let x = bounds.minX;
    while (x <= bounds.maxX) {
      if (grid[y][x] === '.') { x += 1; continue; }
      const start = x;
      while (x <= bounds.maxX && grid[y][x] !== '.') x += 1;
      const end = x - 1;
      if (end - start < 4 || end - start > 8
        || (start < center + 4 && end > center - 4)) continue;
      const blade = grid[y].slice(start, end + 1);
      const shiftBy = phase % 4 >= 2 ? 1 : -1;
      for (let px = start; px <= end; px += 1) put(grid, px, y, '.');
      for (let px = 0; px < blade.length; px += 1) {
        put(grid, start + px + shiftBy, y, blade[px]);
      }
    }
  }
}

/** Fresh deterministic art. Frames are non-negative safe integers, looping at 16. */
export function frameFor(bot, state = 'idle', frame = 0) {
  validateBot(bot);
  if (!STATES.includes(state)) throw new TypeError('Unknown sprite state.');
  if (!Number.isSafeInteger(frame) || frame < 0) {
    throw new TypeError('Sprite frame must be a non-negative safe integer.');
  }
  let grid = bot.pixels.map((row) => row.split(''));
  const phase = frame % 16;
  const bounds = boundsFor(grid);
  const colors = Object.entries(bot.palette).map(([symbol, color]) => colorData(symbol, color));
  const accent = [...colors].sort((a, b) => b.chroma - a.chroma || b.luminance - a.luminance)[0];
  const highlight = [...colors].sort((a, b) => b.luminance - a.luminance)
    .find((color) => color.symbol !== accent.symbol) ?? accent;
  const eyes = eyesFor(grid, colors, bounds);
  const pulse = phase % 8 < 4 ? accent.symbol : highlight.symbol;

  if (state === 'idle') {
    if (phase === 10 || phase === 11) {
      if (eyes.length) expression(grid, eyes, 'blink');
      else fallbackBlink(grid, bounds, colors);
    }
    if (phase >= 4 && phase <= 7) grid = shift(grid, 0, -1);
  } else if (state === 'thinking') {
    expression(grid, eyes, 'scan', phase < 8 ? -1 : 1);
    const x = Math.min(GRID_SIZE - 3, bounds.maxX - 1);
    const y = Math.max(0, bounds.minY - 2);
    if (grid[y][x] === '.') put(grid, x, y, accent.symbol);
    if (phase >= 4 && phase <= 11 && grid[y][x + 2] === '.') {
      put(grid, x + 2, y, highlight.symbol);
    }
    if (eyes.length === 0) indicator(grid, bounds, pulse);
  } else if (state === 'working') {
    spinAccessories(grid, bounds, phase);
    indicator(grid, bounds, pulse);
    if (phase === 14 || phase === 15) expression(grid, eyes, 'blink');
    grid = shift(grid, phase % 8 < 4 ? -1 : 1, phase % 4 >= 2 ? -1 : 0);
  } else {
    expression(grid, eyes, phase % 8 === 4 || phase % 8 === 5 ? 'blink' : 'wide');
    for (let y = 0; y < GRID_SIZE; y += 1) {
      for (let x = 0; x < GRID_SIZE; x += 1) {
        if (grid[y][x] === accent.symbol) put(grid, x, y, pulse);
      }
    }
    indicator(grid, bounds, pulse);
    if (phase % 8 >= 4) grid = shift(grid, 1, 0);
  }
  return grid.map((row) => row.join(''));
}

/** Integer scales only (1..32); the export remains transparent and pixel-crisp. */
export function drawSprite(canvas, bot, { state = 'idle', frame = 0, scale = 4, monochrome = false } = {}) {
  if (!Number.isInteger(scale) || scale < 1 || scale > 32) {
    throw new TypeError('Sprite scale must be an integer from 1 to 32.');
  }
  if (typeof monochrome !== 'boolean') throw new TypeError('Monochrome must be a boolean.');
  if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('A canvas is required.');
  const pixels = frameFor(bot, state, frame);
  const size = GRID_SIZE * scale;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new TypeError('Canvas needs a 2D drawing context.');
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, size, size);
  const palette = Object.fromEntries(Object.entries(bot.palette).map(([symbol, color]) => {
    if (!monochrome) return [symbol, color];
    const data = colorData(symbol, color);
    const shade = Math.round(data.luminance).toString(16).padStart(2, '0');
    return [symbol, `#${shade}${shade}${shade}`];
  }));
  for (let y = 0; y < GRID_SIZE; y += 1) {
    let x = 0;
    while (x < GRID_SIZE) {
      const symbol = pixels[y][x];
      const start = x;
      while (x < GRID_SIZE && pixels[y][x] === symbol) x += 1;
      if (symbol === '.') continue;
      context.fillStyle = palette[symbol];
      context.fillRect(start * scale, y * scale, (x - start) * scale, scale);
    }
  }
  return canvas;
}
