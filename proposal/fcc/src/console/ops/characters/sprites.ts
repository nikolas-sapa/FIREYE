// Event-new original firefighter and rescue-drone pixels, 2026-11-15 (Nik, mascot lab PR #50). No external art or logos.
// Ported verbatim from mascot-lab/bots-a.mjs + bots-b.mjs; state logic ported from mascot-lab/sprite-core.mjs frameFor.
// Palette hex below is art data, not component styling. Symbol `e` marks eye ink; `.` is transparent.

export const GRID_SIZE = 32;

export type CharacterId = 'chief' | 'ranger' | 'rescue' | 'scout' | 'relay' | 'tender';
export type CharacterState = 'idle' | 'thinking' | 'working' | 'alert';

export const CHARACTER_IDS: readonly CharacterId[] = ['chief', 'ranger', 'rescue', 'scout', 'relay', 'tender'];
export const CHARACTER_STATES: readonly CharacterState[] = ['idle', 'thinking', 'working', 'alert'];

export interface CharacterArt {
  id: CharacterId;
  name: string;
  role: string;
  tagline: string;
  palette: Record<string, string>;
  pixels: string[];
}

export const CHARACTERS: Record<CharacterId, CharacterArt> = {
  chief: {
    id: 'chief',
    name: 'Chief',
    role: 'Fire chief',
    tagline: 'A steady little Chief.',
    palette: { o: '#161d29', d: '#283448', n: '#45526b', s: '#9ba5b1', p: '#d9ddd9', h: '#f5f3e9', f: '#e6e4dc', a: '#b8bdb7', e: '#152335', b: '#006bff', u: '#81c7e8' },
    pixels: [
      '................................',
      '................................',
      '................................',
      '..............oooo..............',
      '...........ooohhppooo...........',
      '.........oohhhhhpppppoo.........',
      '........ohhhhhooooopppso........',
      '.......ohhhhppophpoppppsso......',
      '.......ohhhhppopppoppppsso......',
      '......ohhhhppppooopppppsso......',
      '.....oohhhhhpppppppppppssoo.....',
      '.....oossssoooooooooosssssoo....',
      '........osaffffffffffaso........',
      '........osffehffffehfaso........',
      '.........offeeffffeefao..o......',
      '.........offfffafffffao..o......',
      '..........offfddaddfao...o......',
      '...........oaaffffaao...oooo....',
      '..........oonhffhndoo...obuo....',
      '........oonnnonnndnnoo..oddo....',
      '.......onnnnnnnonnnndno.oddo....',
      '.......ohhhhhhhopppppdoohso.....',
      '.......opponnnnopnndnoonsso.....',
      '.......osnonnnnonnndno..........',
      '........ooonhhhoppppno..........',
      '..........oddddooodddo..........',
      '...........onnno..onno..........',
      '...........oppno..opno..........',
      '..........onnnno..onnnno........',
      '..........oooooo..oooooo........',
      '................................',
      '................................',
    ],
  },
  ranger: {
    id: 'ranger',
    name: 'Ranger',
    role: 'Wildland crew',
    tagline: 'Helmet on. Hose in hand.',
    palette: { o: '#161d29', d: '#283448', n: '#45526b', s: '#9ba5b1', p: '#d9ddd9', h: '#f5f3e9', f: '#e6e4dc', a: '#b8bdb7', e: '#152335', b: '#006bff', u: '#81c7e8', r: '#b9363e', c: '#e45b62', k: '#752c36' },
    pixels: [
      '................................',
      '................................',
      '................................',
      '................................',
      '............ooooooo.............',
      '..........oocccccrrroo..........',
      '.........occcccrrrrrrko.........',
      '........occccrrohhorrrko........',
      '........occcrrropporrrkko.......',
      '.......occccrrrrrrrrrrkko.......',
      '.......oorrrrrrrrrrrrkkoo.......',
      '.........okaffffffffako.........',
      '.........okffehffehfako.........',
      '..........offeeffeefao..........',
      '..........offffaffffao..........',
      '...........offffddfao..oo.......',
      '............oaaffffao.osso......',
      '......oo...oonffndoo..ohpso.....',
      '.....osso.onnnnnddnoonohpso.....',
      '.....osboonnnnnnopnnooosdso.....',
      '.....odnoohhhhhhoppndoohpso.....',
      '.....odonnonnnnopnndosohpso.....',
      '.....oo.ossonnnopnndo.ohpso.....',
      '.....oso.ooonhhopppno.osso......',
      '.....oso..onhhhopppno.oo........',
      '......oso.odddooddddo...........',
      '.......ooooonnno.onno...........',
      '..........opnno...oppno.........',
      '.........onnnno...onnno.........',
      '.........oooooo...oooooo........',
      '................................',
      '................................',
    ],
  },
  rescue: {
    id: 'rescue',
    name: 'Rescue',
    role: 'Rescue crew',
    tagline: 'A small helping hand.',
    palette: { o: '#161d29', d: '#283448', n: '#45526b', s: '#9ba5b1', p: '#d9ddd9', h: '#f5f3e9', f: '#e6e4dc', a: '#b8bdb7', e: '#152335', b: '#006bff', u: '#81c7e8', r: '#b9363e', c: '#e45b62', k: '#752c36' },
    pixels: [
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '............ooooooo.............',
      '..........oocccccrrroo..........',
      '.........occccooooorrrko........',
      '........occcrrohuuorrrkko.......',
      '........occrrrohhhorrrkko.......',
      '.......oorrrrrrrrrrrrrkkoo......',
      '.........okaffffffffffako.......',
      '.........okffehffffehfako.......',
      '..........offeeffffeefao........',
      '..........offfffafffffao........',
      '...........offffddfffao.........',
      '............oaafffffao..........',
      '...........oopnffnpdoo..oo......',
      '.........oohhnppnppnnooosso.....',
      '........onppnnnopppnno.osbuo....',
      '.......onppnnnnopppnno.osuuo....',
      '.......opponhhhopppnoopposso....',
      '......ossnonnddonnnnoonssoso....',
      '......osnnonhhhopppnoonnsoso....',
      '.......oooonhhhoppppnooooooo....',
      '..........oddddooodddo..........',
      '..........onnno...onnno.........',
      '.........osnnno...onnnso........',
      '.........oooooo...oooooo........',
      '................................',
      '................................',
      '................................',
    ],
  },
  scout: {
    id: 'scout',
    name: 'Scout',
    role: 'Aerial scout',
    tagline: 'Eyes for the ground crew.',
    palette: { o: '#171717', d: '#243243', r: '#667585', s: '#a8b0ba', p: '#e6e6e6', h: '#f2f2f2', b: '#006bff', u: '#3291ff', e: '#3291ff' },
    pixels: [
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '...ooooooo............ooooooo...',
      '..oshddppso..........oshddppso..',
      '..od.dod.do..oooooo..od.dod.do..',
      '...oosssoo.oohhhhppoo.oosssoo...',
      '......oddoohhhhpppppsooddo......',
      '.......orohppppppppppsoro.......',
      '.........opoddddddddoso.........',
      '.........opodheddhedoso.........',
      '.........opodeeddeedoso.........',
      '.......oropodddssdddosoro.......',
      '...ooooooopoooooooooosooooooo...',
      '..oshppddsoppppppppssoshppddso..',
      '..od.dod.do...orso...od.dod.do..',
      '...oosssoo...oooooo...oosssoo...',
      '............ohruubso............',
      '...........ohruhubrso...........',
      '...........orubbbbrso...........',
      '............osrbbbro............',
      '.............oooooo.............',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
    ],
  },
  relay: {
    id: 'relay',
    name: 'Relay',
    role: 'Signal relay',
    tagline: 'Keeping the crew connected.',
    palette: { o: '#171717', d: '#243243', r: '#667585', s: '#a8b0ba', p: '#e6e6e6', h: '#f2f2f2', b: '#006bff', u: '#3291ff', e: '#3291ff' },
    pixels: [
      '................................',
      '................................',
      '..........bb....................',
      '..........ob....................',
      '..........or.oooooo..bb.........',
      '..........orohppppso.bo.........',
      '..........oropddbdso.ro.........',
      '..........ooophhpdso.ro.........',
      '............opddbdso.oo.........',
      '............opsssdso............',
      '....ooooo..oohhhhppoo..ooooo....',
      '...oshppsoohhpppppppsooshppso...',
      '..osdddddopoddddddddosodddddso..',
      '..os.drd.opodheddhedoso.drd.so..',
      '..op.hoh.opodeeddeedoso.hoh.po..',
      '..os.drd.opodddssdddoso.drd.so..',
      '..osdddddopodddhhdddosodddddso..',
      '...osssssopoooooooooosossssso...',
      '....ooooo.ohpppppppsso.ooooo....',
      '..........oppddppddpso..........',
      '..........oppddbbddpso..........',
      '..........oppppppppsso..........',
      '...........osssppssso...........',
      '............oossssoo............',
      '..........os........so..........',
      '.........os..........so.........',
      '........oshpppppppppppso........',
      '.........oooooooooooooo.........',
      '................................',
      '................................',
      '................................',
      '................................',
    ],
  },
  tender: {
    id: 'tender',
    name: 'Tender',
    role: 'Support drone',
    tagline: 'Small tank. Helpful company.',
    palette: { o: '#171717', d: '#243243', r: '#667585', s: '#a8b0ba', p: '#e6e6e6', h: '#f2f2f2', b: '#006bff', u: '#3291ff', e: '#3291ff' },
    pixels: [
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '....ooooo..............ooooo....',
      '...oshhpso............oshhpso...',
      '..oshddppso..oooooo..oshddppso..',
      '..od.dod.dooohhhhhhpood.dod.do..',
      '...osssssoohhhpppppppsossssso...',
      '....oodo.ohppppppppppso.odoo....',
      '......orssooddddddddoossro......',
      '.......odooodheddhedooodo.......',
      '.........opodeeddeedoso.........',
      '.........opodddssdddoso.........',
      '.........opooooooooooso.........',
      '..........oppppppppsso..........',
      '..........oooooooooooo..........',
      '.........ohpppuuuupppso.........',
      '........ohppppuhbbppppso........',
      '.......orpppppubbbppppsro.......',
      '......oropppppubbbppppsoro......',
      '......or.ospppubbbppsso.ro......',
      '......os..oossssssssoo..so......',
      '.....oshso.....oo.....oshso.....',
      '...............bb...............',
      '................................',
      '...............ub...............',
      '................................',
      '................................',
    ],
  },
};

type Grid = string[][];
type Point = [number, number];
type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
type ColorData = { symbol: string; luminance: number; chroma: number };
type Eye = { points: Point[]; symbol: string; background: string };

function colorData(symbol: string, hex: string): ColorData {
  const expanded = hex.length === 4
    ? hex.slice(1).split('').map((digit) => digit + digit).join('')
    : hex.slice(1);
  const red = Number.parseInt(expanded.slice(0, 2), 16);
  const green = Number.parseInt(expanded.slice(2, 4), 16);
  const blue = Number.parseInt(expanded.slice(4, 6), 16);
  return {
    symbol,
    luminance: red * 0.2126 + green * 0.7152 + blue * 0.0722,
    chroma: Math.max(red, green, blue) - Math.min(red, green, blue),
  };
}

function boundsFor(grid: Grid): Bounds {
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

function put(grid: Grid, x: number, y: number, symbol: string): boolean {
  if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) return false;
  grid[y][x] = symbol;
  return true;
}

function componentsFor(grid: Grid, symbol: string): Point[][] {
  const seen = new Set<number>();
  const components: Point[][] = [];
  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      const index = y * GRID_SIZE + x;
      if (grid[y][x] !== symbol || seen.has(index)) continue;
      const points: Point[] = [[x, y]];
      seen.add(index);
      for (let cursor = 0; cursor < points.length; cursor += 1) {
        const [px, py] = points[cursor];
        const around: Point[] = [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]];
        for (const [nx, ny] of around) {
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

// Semantic eye ink (e) first; small contrast clusters in the face band are the fallback.
function eyesFor(grid: Grid, colors: ColorData[], bounds: Bounds): Eye[] {
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
      const neighbors = new Map<string, number>();
      for (const [x, y] of points) {
        const around: Point[] = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
        for (const [nx, ny] of around) {
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

function expression(grid: Grid, eyes: Eye[], kind: 'blink' | 'scan' | 'wide', offset = 0): void {
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

function shift(grid: Grid, dx: number, dy: number): Grid {
  const bounds = boundsFor(grid);
  if (bounds.minX + dx < 0 || bounds.maxX + dx >= GRID_SIZE
    || bounds.minY + dy < 0 || bounds.maxY + dy >= GRID_SIZE) return grid;
  const moved: Grid = Array.from({ length: GRID_SIZE }, () => Array<string>(GRID_SIZE).fill('.'));
  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      if (grid[y][x] !== '.') put(moved, x + dx, y + dy, grid[y][x]);
    }
  }
  return moved;
}

function indicator(grid: Grid, bounds: Bounds, symbol: string): void {
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
  for (let y = bounds.maxY; y >= bounds.minY; y -= 1) {
    const x = grid[y].findIndex((pixel) => pixel !== '.');
    if (x !== -1) {
      put(grid, x, y, symbol);
      return;
    }
  }
}

function fallbackBlink(grid: Grid, bounds: Bounds, colors: ColorData[]): void {
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

// Long, disconnected runs beside the central pod read as propeller blades; only blade ink moves.
function spinAccessories(grid: Grid, bounds: Bounds, phase: number): void {
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
      for (let px = 0; px < blade.length; px += 1) put(grid, start + px + shiftBy, y, blade[px]);
    }
  }
}

function colorsOf(art: CharacterArt): ColorData[] {
  return Object.entries(art.palette).map(([symbol, color]) => colorData(symbol, color));
}

/** Port of the lab's deterministic frameFor: fresh 32x32 rows for a state; frames loop at 16. */
export function artFor(id: CharacterId, state: CharacterState = 'idle', frame = 0): string[] {
  const art = CHARACTERS[id];
  let grid: Grid = art.pixels.map((row) => row.split(''));
  const phase = ((Math.trunc(frame) % 16) + 16) % 16;
  const bounds = boundsFor(grid);
  const colors = colorsOf(art);
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
    if (phase >= 4 && phase <= 11 && grid[y][x + 2] === '.') put(grid, x + 2, y, highlight.symbol);
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

/** artFor with the eyes closed to a single line; used by the renderer's CSS blink overlay. */
export function blinkArtFor(id: CharacterId, state: CharacterState = 'idle'): string[] {
  const art = CHARACTERS[id];
  const grid: Grid = artFor(id, state).map((row) => row.split(''));
  const colors = colorsOf(art);
  const bounds = boundsFor(grid);
  const eyes = eyesFor(grid, colors, bounds);
  if (eyes.length) expression(grid, eyes, 'blink');
  else fallbackBlink(grid, bounds, colors);
  return grid.map((row) => row.join(''));
}

export interface PixelRun { x: number; y: number; w: number; symbol: string }

/** Merge horizontal same-symbol runs; `only` restricts output to cells where it returns true. */
export function runsFor(pixels: string[], only?: (x: number, y: number) => boolean): PixelRun[] {
  const runs: PixelRun[] = [];
  for (let y = 0; y < pixels.length; y += 1) {
    const row = pixels[y];
    let x = 0;
    while (x < row.length) {
      const symbol = row[x];
      const keep = symbol !== '.' && (!only || only(x, y));
      if (!keep) { x += 1; continue; }
      const start = x;
      while (x < row.length && row[x] === symbol && (!only || only(x, y))) x += 1;
      runs.push({ x: start, y, w: x - start, symbol });
    }
  }
  return runs;
}
