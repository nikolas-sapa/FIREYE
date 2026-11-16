import { GRID_SIZE, validateBot } from './sprite-core.mjs';

// Event-new original rescue-drone art, 2026-11-15. No imported artwork.
// Each source grid leaves a one-pixel safety margin for demo-state motion.
function art(rows) {
  if (rows.length !== GRID_SIZE || rows.some((row) => row.length !== GRID_SIZE)) {
    throw new TypeError('Rescue-drone source art must contain exactly 32x32 pixels.');
  }
  return rows;
}

const palette = {
  o: '#171717', d: '#243243', r: '#667585', s: '#a8b0ba',
  p: '#e6e6e6', h: '#f2f2f2', b: '#006bff', u: '#3291ff', e: '#3291ff',
};

const scout = {
  id: 'scout',
  name: 'Scout',
  role: 'Aerial scout',
  tagline: 'Eyes for the ground crew.',
  description: 'Four guarded rotors surround an ivory pod with friendly twin optics. A large underslung blue camera makes the scouting role visible.',
  silhouette: 'Wide four-rotor airframe, compact ivory pod and underslung round blue camera.',
  palette: { ...palette },
  pixels: art([
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
  ]),
};

const relay = {
  id: 'relay',
  name: 'Relay',
  role: 'Signal relay',
  tagline: 'Keeping the crew connected.',
  description: 'A tall radio mast and twin aerials rise behind an ivory face pod. Large ducted rotors and one low landing bracket distinguish the signal-relay drone.',
  silhouette: 'Tall twin-aerial mast, two circular ducted rotors and one wide docking bracket.',
  palette: { ...palette },
  pixels: art([
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
  ]),
};

const tender = {
  id: 'tender',
  name: 'Tender',
  role: 'Support drone',
  tagline: 'Small tank. Helpful company.',
  description: 'A squat ivory airframe carries a broad white water capsule with a blue core, short downward nozzle and small droplet. Guarded rotors and tucked skids frame the support payload.',
  silhouette: 'Squat guarded airframe, broad underslung water capsule, short skids and downward droplet.',
  palette: { ...palette },
  pixels: art([
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
  ]),
};

export const alternateBots = Object.freeze([scout, relay, tender].map((bot) => {
  validateBot(bot);
  Object.freeze(bot.palette);
  Object.freeze(bot.pixels);
  return Object.freeze(bot);
}));
