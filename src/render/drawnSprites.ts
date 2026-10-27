// Furniture the Penzilla pack doesn't have (piano, fireplace, typewriter...), drawn here in its
// palette and style: front-on, one-pixel plum outline, light from the top left. Original work.

/** The pack's own colours. */
export const P = {
  outline: '#340129',
  shadow: '#421d39',
  woodDark: '#5e2522',
  wood: '#6c3a22',
  woodMid: '#7a3c19',
  woodLight: '#8e4c1d',
  woodHigh: '#9e6542',
  cream: '#efc9a1',
  creamLight: '#ffe4c1',
  peach: '#eaa679',
  red: '#ba3814',
  redDark: '#802610',
  redLight: '#f76946',
  blue: '#7783f7',
  blueMid: '#6868cf',
  blueDark: '#4638ad',
  paleBlue: '#dae4ff',
  white: '#f6eff3',
  whiteShade: '#d6bdcc',
  grey: '#7a6168',
  greyLight: '#b78c7c',
  greyDark: '#402e37',
  orange: '#e98700',
  orangeLight: '#f1b066',
  green: '#7b9c18',
  greenDark: '#5a7600',
} as const;

export interface DrawnSprite {
  w: number;
  h: number;
  /** One or more animation frames, each a w*h array of colours (null is transparent). */
  frames: (string | null)[][];
}

class Painter {
  readonly px: (string | null)[];
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.px = new Array<string | null>(w * h).fill(null);
  }
  dot(x: number, y: number, c: string | null): this {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = c;
    return this;
  }
  rect(x: number, y: number, w: number, h: number, c: string): this {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.dot(i, j, c);
    return this;
  }
  hline(x: number, y: number, w: number, c: string): this {
    return this.rect(x, y, w, 1, c);
  }
  vline(x: number, y: number, h: number, c: string): this {
    return this.rect(x, y, 1, h, c);
  }
  /** A filled box with the pack's outline, a lit top-left edge and a shaded bottom-right edge. */
  box(x: number, y: number, w: number, h: number, fill: string, light?: string, shade?: string): this {
    this.rect(x, y, w, h, P.outline);
    this.rect(x + 1, y + 1, w - 2, h - 2, fill);
    if (light) {
      this.hline(x + 1, y + 1, w - 2, light);
      this.vline(x + 1, y + 1, h - 2, light);
    }
    if (shade) {
      this.hline(x + 1, y + h - 2, w - 2, shade);
      this.vline(x + w - 2, y + 1, h - 2, shade);
    }
    return this;
  }
}

/** Letters used when a sprite is easier to draw as rows of text. */
const LEGEND: Record<string, string> = {
  o: P.outline,
  r: P.red,
  R: P.redLight,
  q: P.redDark,
  c: P.cream,
  C: P.creamLight,
  w: P.wood,
  W: P.woodLight,
  h: P.woodHigh,
  d: P.woodDark,
};

function rows(lines: string[]): (p: Painter) => void {
  return (p) =>
    lines.forEach((line, y) => {
      if (line.length !== p.w) throw new Error(`Sprite row ${y} is ${line.length} wide, expected ${p.w}`);
      [...line].forEach((ch, x) => ch !== '.' && p.dot(x, y, LEGEND[ch]!));
    });
}

function sprite(w: number, h: number, ...frames: ((p: Painter) => void)[]): DrawnSprite {
  return {
    w,
    h,
    frames: frames.map((draw) => {
      const p = new Painter(w, h);
      draw(p);
      return p.px;
    }),
  };
}

/** Upright piano: lid, music desk with a sheet, keyboard, lower panel. */
const piano = sprite(24, 19, (p) => {
  p.box(0, 0, 24, 9, P.wood, P.woodLight, P.woodDark);
  p.box(4, 2, 16, 6, P.woodDark);
  p.rect(9, 3, 6, 4, P.cream).vline(14, 3, 4, P.peach).hline(10, 4, 3, P.peach);
  // Keyboard: white keys with black keys in twos and threes.
  p.rect(0, 9, 24, 4, P.outline);
  p.rect(1, 10, 22, 2, P.white).hline(1, 11, 22, P.whiteShade);
  for (const x of [2, 4, 7, 9, 11, 14, 16, 19, 21]) p.dot(x, 10, P.outline);
  p.box(1, 12, 22, 7, P.wood, P.woodLight, P.woodDark);
  p.box(4, 13, 16, 4, P.woodMid);
});

/** Stone fireplace with a wooden mantel and a flickering fire (two frames). */
function fireplaceFrame(flicker: boolean) {
  return (p: Painter) => {
    p.box(0, 0, 24, 4, P.woodLight, P.woodHigh, P.wood);
    p.box(1, 3, 22, 21, P.cream, P.creamLight, P.peach);
    for (const [x, y] of [
      [3, 6],
      [17, 9],
      [4, 15],
      [18, 18],
      [11, 5],
    ]) p.hline(x!, y!, 3, P.peach);
    p.rect(6, 9, 12, 15, P.outline).rect(7, 10, 10, 14, P.greyDark);
    // Logs and flames.
    p.rect(8, 21, 8, 2, P.wood).hline(8, 21, 8, P.woodLight);
    const tips = flicker ? [9, 12, 14] : [10, 11, 15];
    p.rect(9, 17, 6, 4, P.red);
    p.rect(10, 18, 4, 3, P.orange).rect(11, 19, 2, 2, P.orangeLight);
    for (const t of tips) p.vline(t, flicker ? 14 : 15, 3, P.red);
    p.dot(tips[1]!, flicker ? 16 : 17, P.orange);
    p.hline(6, 23, 12, P.outline);
  };
}
const fireplace = sprite(24, 24, fireplaceFrame(false), fireplaceFrame(true));

/** A red telephone, handset on its cradle, on a little round table. */
const phoneTable = sprite(
  10,
  17,
  rows([
    '.oooooooo.',
    'orRRRRRRro',
    'oooroorooo',
    '..orrrro..',
    '.orrccrro.',
    '.orccccro.',
    'orrrrrrrro',
    'oooooooooo',
    'ohhhhhhhwo',
    '.oooooooo.',
    '...owwo...',
    '...owwo...',
    '...owwo...',
    '...owwo...',
    '...owdo...',
    '..owwwdo..',
    '.oooooooo.',
  ]),
);

const dogBowl = sprite(9, 4, (p) => {
  p.rect(0, 0, 9, 4, P.outline);
  p.rect(1, 1, 7, 1, P.woodMid).dot(3, 1, P.woodLight).dot(6, 1, P.woodLight);
  p.rect(1, 2, 7, 1, P.blue).dot(1, 2, P.paleBlue);
  p.dot(0, 0, null).dot(8, 0, null);
});

/** Record player on a low cabinet: turntable, black disc with a red label, tone arm. */
const recordPlayer = sprite(16, 16, (p) => {
  p.box(0, 3, 16, 3, P.greyLight, P.white, P.grey);
  p.rect(2, 2, 10, 2, P.outline).rect(3, 2, 8, 1, P.greyDark).dot(6, 2, P.red).dot(7, 2, P.red);
  p.vline(13, 0, 3, P.outline).hline(11, 0, 3, P.outline);
  p.box(0, 6, 16, 10, P.wood, P.woodLight, P.woodDark);
  p.vline(8, 7, 8, P.outline);
  p.dot(6, 10, P.orangeLight).dot(9, 10, P.orangeLight);
});

/** Desk with a typewriter and a sheet of paper in it. */
const typewriterDesk = sprite(24, 18, (p) => {
  p.rect(9, 0, 6, 4, P.outline).rect(10, 0, 4, 4, P.white).hline(10, 2, 4, P.whiteShade);
  p.box(6, 3, 12, 5, P.greyDark, P.grey);
  p.rect(7, 6, 10, 1, P.outline).hline(8, 6, 8, P.whiteShade);
  p.dot(16, 4, P.greyLight);
  p.box(0, 8, 24, 3, P.woodLight, P.woodHigh, P.wood);
  p.box(1, 10, 8, 8, P.wood, P.woodLight, P.woodDark).dot(6, 13, P.orangeLight);
  p.rect(20, 11, 3, 7, P.outline).vline(21, 11, 6, P.wood);
});

/** A desk chair seen from behind: the back, the seat's edge and two legs. Drawn over him. */
const chairBack = sprite(10, 10, (p) => {
  p.box(1, 0, 8, 5, P.woodMid, P.woodLight, P.woodDark);
  p.rect(0, 5, 10, 2, P.outline).hline(1, 5, 8, P.wood);
  p.rect(1, 7, 2, 3, P.outline).rect(7, 7, 2, 3, P.outline);
});

/** Desk with a beige computer: monitor with a blue screen, keyboard. */
const computerDesk = sprite(24, 21, (p) => {
  p.box(6, 0, 12, 10, P.cream, P.creamLight, P.peach);
  p.rect(8, 2, 8, 5, P.outline).rect(9, 3, 6, 3, P.blueDark).hline(9, 3, 4, P.blue).dot(10, 4, P.paleBlue);
  p.rect(10, 9, 4, 2, P.outline).hline(11, 9, 2, P.peach);
  p.rect(5, 10, 14, 2, P.outline).hline(6, 10, 12, P.white);
  p.box(0, 11, 24, 3, P.woodLight, P.woodHigh, P.wood);
  p.box(15, 13, 8, 8, P.wood, P.woodLight, P.woodDark).dot(17, 16, P.orangeLight);
  p.rect(1, 14, 3, 7, P.outline).vline(2, 14, 6, P.wood);
});

/** Grandfather clock: wooden case, cream face, swinging pendulum (two frames). */
function clockFrame(swing: number) {
  return (p: Painter) => {
    p.box(0, 0, 10, 28, P.wood, P.woodLight, P.woodDark);
    p.rect(1, 2, 8, 8, P.outline).rect(2, 3, 6, 6, P.cream).dot(2, 3, P.creamLight);
    p.vline(5, 4, 3, P.outline).hline(5, 6, 2, P.outline);
    p.rect(2, 11, 6, 13, P.outline).rect(3, 12, 4, 11, P.woodDark);
    p.vline(4 + swing, 12, 7, P.orange).rect(3 + swing, 19, 3, 3, P.orangeLight).dot(4 + swing, 21, P.orange);
    p.rect(0, 26, 10, 2, P.outline).hline(1, 26, 8, P.wood);
  };
}
const clock = sprite(10, 28, clockFrame(0), clockFrame(1));

/** Games cabinet: shelves of colourful boxed games. */
const gamesCabinet = sprite(16, 24, (p) => {
  p.box(0, 0, 16, 24, P.wood, P.woodLight, P.woodDark);
  p.rect(2, 2, 12, 20, P.woodDark);
  p.hline(2, 8, 12, P.outline).hline(2, 15, 12, P.outline).hline(2, 21, 12, P.outline);
  const boxes: [number, number, number, number, string][] = [
    [2, 4, 5, 4, P.red],
    [7, 3, 6, 5, P.blue],
    [2, 11, 7, 4, P.green],
    [9, 12, 4, 3, P.orange],
    [2, 17, 4, 4, P.blueMid],
    [6, 18, 7, 3, P.redLight],
  ];
  for (const [x, y, w, h, c] of boxes) p.rect(x, y, w, h, P.outline).rect(x + 1, y + 1, w - 2, h - 1, c);
});

/** Tall wardrobe with two doors. */
const wardrobe = sprite(18, 30, (p) => {
  p.box(0, 0, 18, 30, P.wood, P.woodLight, P.woodDark);
  p.hline(1, 3, 16, P.outline);
  p.box(2, 4, 7, 23, P.woodMid, P.woodLight);
  p.box(9, 4, 7, 23, P.woodMid, P.woodLight);
  p.vline(7, 14, 3, P.orangeLight).vline(10, 14, 3, P.orangeLight);
  p.rect(1, 28, 2, 2, P.outline).rect(15, 28, 2, 2, P.outline);
});

const exerciseRug = sprite(24, 3, (p) => {
  p.rect(0, 0, 24, 3, P.outline);
  p.rect(1, 1, 22, 1, P.red);
  for (let x = 3; x < 22; x += 4) p.dot(x, 1, P.redLight);
});

export const DRAWN = {
  piano,
  fireplace,
  phoneTable,
  dogBowl,
  recordPlayer,
  typewriterDesk,
  chairBack,
  computerDesk,
  clock,
  gamesCabinet,
  wardrobe,
  exerciseRug,
};
export type DrawnKey = keyof typeof DRAWN;

/** Renders each frame to a small canvas once, for fast drawImage. */
export function bakeSprites(): Record<DrawnKey, HTMLCanvasElement[]> {
  const out = {} as Record<DrawnKey, HTMLCanvasElement[]>;
  for (const [key, s] of Object.entries(DRAWN) as [DrawnKey, DrawnSprite][]) {
    out[key] = s.frames.map((frame) => {
      const c = document.createElement('canvas');
      c.width = s.w;
      c.height = s.h;
      const ctx = c.getContext('2d')!;
      frame.forEach((col, i) => {
        if (!col) return;
        ctx.fillStyle = col;
        ctx.fillRect(i % s.w, Math.floor(i / s.w), 1, 1);
      });
      return c;
    });
  }
  return out;
}
