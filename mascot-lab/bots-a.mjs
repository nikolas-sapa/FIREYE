import { GRID_SIZE, validateBot } from './sprite-core.mjs';

// The left edge is authored explicitly; omitted trailing dots are transparent.
function art(rows) {
  if (rows.length !== GRID_SIZE || rows.some((row) => row.length > GRID_SIZE)) {
    throw new TypeError('Source art must fit exactly 32 rows and 32 columns.');
  }
  return rows.map((row) => row.padEnd(GRID_SIZE, '.'));
}

const scout = {
  id: 'scout',
  name: 'Scout',
  role: 'Curious spotter',
  tagline: 'Small feet. Big curiosity.',
  description: 'A pearl-shell pocket bot with a blue glass face, tiny mitten hands and a slightly off-center antenna. Always looks ready to peek around a corner.',
  silhouette: 'Round stepped helmet, slim torso, mitten hands, short separate boots.',
  palette: {
    o: '#171717', d: '#2e2e2e', s: '#8f8f8f', p: '#e6e6e6',
    h: '#f2f2f2', b: '#006bff', u: '#3291ff', e: '#c9deff',
  },
  pixels: art([
    '',
    '',
    '..................bb',
    '..................ob',
    '..................oo',
    '..........oooooooooooo',
    '........oohhhhhhhhhhppoo',
    '.......ohhhhhhhhhhhhhppso',
    '......ohhhppppppppppppppso',
    '......ohhpppppppppppppppso',
    '......ohppooooooooooooopso',
    '......oppobuuuuuuuuuubopso',
    '......oppobbeeubbbeebbopso',
    '......oppobbeeubbbeebbopso',
    '......oppobbeeubbbeebbopso',
    '......oppobbbbuhhubbbbopso',
    '.......oppoooooooooooopso',
    '........oppppppppppsssoo',
    '.........oooossssoooo',
    '............opppso',
    '......oo....ophpso....oo',
    '.....ohsooooopbbpsooooohso',
    '.....opso...opppso...opso',
    '......oo....opppso....oo',
    '............osssso',
    '...........oo....oo',
    '..........opso..opso',
    '..........opso..opso',
    '.........ooooso.ooooso',
    '',
    '',
    '',
  ]),
};

const relay = {
  id: 'relay',
  name: 'Relay',
  role: 'Signal companion',
  tagline: 'Two antennas. One good listener.',
  description: 'A compact graphite box with twin antenna tips, padded ear receivers and a tiny boom microphone. Bright eyes soften the sturdy little hardware shell.',
  silhouette: 'Wide chamfered box, twin upright antennas, side headset and low square boots.',
  palette: {
    o: '#0a0a0a', d: '#171717', p: '#4d4d4d', s: '#7d7d7d',
    h: '#c9c9c9', e: '#ededed', b: '#006bff', u: '#3291ff',
  },
  pixels: art([
    '',
    '',
    '.........bb..........bb',
    '.........ob..........bo',
    '.........os..........so',
    '..........o..........o',
    '..........o..........o',
    '.......oooooooooooooooooo',
    '......oshhhhhhhhhhhhhpppso',
    '......osppppppppppppppppso',
    '...oooospddddddddddddddpsoooo',
    '...osoospddeeddddddeeddpsooso',
    '...osoospddeeddddddeeddpsooso',
    '...osoospddeeddddddeeddpsooso',
    '...osoospddddddhhddddddpsooso',
    '...oooospddddddddddddddpsoooo',
    '......ospppppbbbbppppppso...o',
    '.......ossssssssssssssssso..o',
    '........oooooooooooooooo..bb',
    '..........oppppppppppso',
    '........oopssbbpssbppssoo',
    '.......ohsoppppppppppsohsso',
    '.......opoopsssssssssooopo',
    '.......ooo.ooo......ooo.ooo',
    '...........oso......oso',
    '..........opso.....opso',
    '.........oossso...oosssso',
    '',
    '',
    '',
    '',
    '',
  ]),
};

const pilot = {
  id: 'pilot',
  name: 'Pilot',
  role: 'Hover companion',
  tagline: 'Tiny rotors. Gentle company.',
  description: 'A round pocket drone tucked between two broad side propellers. Pearl panels, a blue face and little landing skids make it feel like a companion, not a weapon.',
  silhouette: 'Twin horizontal side propellers, round central pod and two splayed landing skids.',
  palette: {
    o: '#171717', d: '#2e2e2e', s: '#8f8f8f', p: '#e6e6e6',
    h: '#f2f2f2', b: '#006bff', u: '#3291ff', e: '#c9deff',
  },
  pixels: art([
    '',
    '',
    '',
    '',
    '...............bb',
    '...............oo',
    '..oohhhhho............oohhhhho',
    '..osssssoo............osssssoo',
    '.....oso................oso',
    '.....obo......oooo......obo',
    '.....opo....oohhhhoo....opo',
    '.....ooo...ohhpppphso...ooo',
    '.......oooohpppppppsooooo',
    '........ophpoooooooophpso',
    '........ohpobbbbbbbbopso',
    '........oppobeebbeebopso',
    '........oppobeebbeebopso',
    '........oppobeebbeebopso',
    '........oppobbbhhbbbopso',
    '.........oppoooooooopso',
    '.........ohpppppppppsso',
    '..........opppbbpppsso',
    '...........osssssssso',
    '............oooooooo',
    '..........oo........oo',
    '.........opso......opso',
    '.........osso......osso',
    '........oooooo....oooooo',
    '',
    '',
    '',
    '',
  ]),
};

export const primaryBots = Object.freeze([scout, relay, pilot].map((bot) => {
  validateBot(bot);
  Object.freeze(bot.palette);
  Object.freeze(bot.pixels);
  return Object.freeze(bot);
}));
