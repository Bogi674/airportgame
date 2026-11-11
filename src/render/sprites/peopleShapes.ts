import { PEOPLE } from '@data/index';
import type { PersonRecipe } from '@data/schemas/people';

/**
 * Shape ops for the flat walking figure. Port of docs/reference/sprite-prototypes/people2.py.
 * All numbers are meters, facing up (negative y). Render only: no canvas or DOM here.
 */

type Pt = readonly [number, number];

/** Group transform flattened into each op. Applied to a point as scale, then rotate, then translate. */
interface Xform {
  tx?: number;
  ty?: number;
  rotDeg?: number;
  sx?: number;
  sy?: number;
}

interface Painted {
  fill: string;
  stroke?: string;
  sw?: number;
  op?: number;
}

export type ShapeOp = Xform &
  (
    | (Painted & { k: 'rect'; x: number; y: number; w: number; h: number; rx?: number })
    | (Painted & { k: 'circle'; cx: number; cy: number; r: number })
    | (Painted & { k: 'ellipse'; cx: number; cy: number; rx: number; ry: number })
    | { k: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: string; sw: number; cap?: 'round'; op?: number }
    | (Painted & { k: 'poly'; pts: readonly Pt[] })
    | (Painted & { k: 'path'; d: string })
  );

/** Recipe fields that people2.py reads but people.json does not carry yet. */
export interface PersonLookExtras {
  gloves?: string;
  epaulettes?: number;
  radio?: boolean;
  apron?: string;
}

export type PersonLook = PersonRecipe & PersonLookExtras;

interface Paint {
  stroke?: string;
  sw?: number;
  op?: number;
  rx?: number;
  cap?: 'round';
}

const OUT = '#00000026';

function rect(out: ShapeOp[], x: number, y: number, w: number, h: number, fill: string, p: Paint = {}): void {
  out.push({ k: 'rect', x, y, w, h, fill, stroke: p.stroke, sw: p.sw, rx: p.rx, op: p.op });
}

function circle(out: ShapeOp[], cx: number, cy: number, r: number, fill: string, p: Paint = {}): void {
  out.push({ k: 'circle', cx, cy, r, fill, stroke: p.stroke, sw: p.sw, op: p.op });
}

function ellipse(out: ShapeOp[], cx: number, cy: number, rx: number, ry: number, fill: string, p: Paint = {}): void {
  out.push({ k: 'ellipse', cx, cy, rx, ry, fill, stroke: p.stroke, sw: p.sw, op: p.op });
}

function line(out: ShapeOp[], x1: number, y1: number, x2: number, y2: number, stroke: string, sw: number, p: Paint = {}): void {
  out.push({ k: 'line', x1, y1, x2, y2, stroke, sw, cap: p.cap, op: p.op });
}

function poly(out: ShapeOp[], pts: readonly Pt[], fill: string, p: Paint = {}): void {
  out.push({ k: 'poly', pts, fill, stroke: p.stroke, sw: p.sw, op: p.op });
}

function path(out: ShapeOp[], d: string, fill: string, p: Paint = {}): void {
  out.push({ k: 'path', d, fill, stroke: p.stroke, sw: p.sw, op: p.op });
}

/** Port of people2.py darker(). Scales each channel by f and truncates. */
function darker(hexc: string, f = 0.78): string {
  const h = hexc.replace(/^#+/, '');
  const channel = (start: number): string => Math.trunc(parseInt(h.slice(start, start + 2), 16) * f).toString(16).padStart(2, '0');
  return `#${channel(0)}${channel(2)}${channel(4)}`;
}

/** Port of people2.py capsule(): a round capped line. */
function capsule(out: ShapeOp[], x1: number, y1: number, x2: number, y2: number, w: number, fill: string): void {
  line(out, x1, y1, x2, y2, fill, w, { cap: 'round' });
}

function hairColor(key: string): string {
  const hex = PEOPLE.hair[key];
  if (hex === undefined) throw new Error(`people hair colour ${key} is not in people.json`);
  return hex;
}

/** Port of people2.py hair_shape(). Staff headwear and head accessories are included. */
function hairShape(out: ShapeOp[], style: PersonRecipe['hair'], col: string, acc: PersonRecipe['headAcc']): void {
  const dk = darker(col);
  switch (style) {
    case 'short':
      circle(out, 0, 0.012, 0.098, col);
      ellipse(out, 0, -0.05, 0.07, 0.035, col);
      break;
    case 'side_part':
      circle(out, 0, 0.01, 0.1, col);
      line(out, -0.03, -0.09, -0.02, 0.08, dk, 0.012);
      break;
    case 'spiky': {
      const pts: Pt[] = [];
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * 2 * Math.PI;
        const r = i % 2 === 0 ? 0.115 : 0.085;
        pts.push([r * Math.cos(a), r * Math.sin(a) + 0.01]);
      }
      poly(out, pts, col);
      break;
    }
    case 'long':
      ellipse(out, 0, 0.07, 0.11, 0.155, col);
      circle(out, 0, 0.0, 0.104, col);
      line(out, 0, -0.09, 0, 0.05, dk, 0.012);
      break;
    case 'ponytail':
      circle(out, 0, 0.008, 0.1, col);
      ellipse(out, 0, 0.15, 0.04, 0.075, col);
      circle(out, 0, 0.09, 0.018, dk);
      break;
    case 'bun':
      circle(out, 0, 0.008, 0.1, col);
      circle(out, 0, 0.085, 0.045, dk);
      break;
    case 'curly':
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * 2 * Math.PI;
        circle(out, 0.085 * Math.cos(a), 0.085 * Math.sin(a) + 0.01, 0.042, col);
      }
      circle(out, 0, 0.01, 0.09, col);
      break;
    case 'afro':
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * 2 * Math.PI;
        circle(out, 0.11 * Math.cos(a), 0.11 * Math.sin(a) + 0.01, 0.045, col);
      }
      circle(out, 0, 0.01, 0.12, col);
      break;
    case 'buzz':
      circle(out, 0, 0.01, 0.098, col, { op: 0.75 });
      break;
    case 'balding':
      path(out, 'M-0.098,0.0 A0.1,0.1 0 0 0 0.098,0.0 L0.07,0.02 A0.07,0.07 0 0 1 -0.07,0.02Z', col);
      circle(out, -0.02, -0.03, 0.025, '#ffffff', { op: 0.25 });
      break;
    case 'bald':
      circle(out, -0.025, -0.03, 0.03, '#ffffff', { op: 0.3 });
      break;
    case 'braids':
      circle(out, 0, 0.01, 0.1, col);
      for (let i = -2; i <= 2; i++) {
        line(out, i * 0.035, -0.07, i * 0.035, 0.09, dk, 0.012);
      }
      capsule(out, -0.03, 0.09, -0.04, 0.2, 0.03, col);
      capsule(out, 0.03, 0.09, 0.04, 0.2, 0.03, col);
      break;
    case 'hijab':
      ellipse(out, 0, 0.05, 0.155, 0.135, col);
      circle(out, 0, 0.0, 0.122, col);
      path(out, 'M-0.09,-0.08 Q0,-0.135 0.09,-0.08', 'none', { stroke: dk, sw: 0.014 });
      line(out, 0, -0.1, 0, 0.11, dk, 0.01, { op: 0.5 });
      break;
    case 'cap':
      circle(out, 0, 0.01, 0.104, col);
      ellipse(out, 0, -0.105, 0.078, 0.05, dk);
      circle(out, 0, 0.0, 0.014, dk);
      break;
    case 'sunhat':
      circle(out, 0, 0.0, 0.18, col);
      circle(out, 0, 0.0, 0.18, 'none', { stroke: dk, sw: 0.01 });
      circle(out, 0, 0.0, 0.088, dk);
      break;
    case 'beanie':
      circle(out, 0, 0.008, 0.105, col);
      for (let k = 1; k <= 3; k++) {
        circle(out, 0, 0.008, (0.105 * k) / 4, 'none', { stroke: dk, sw: 0.008 });
      }
      circle(out, 0, 0.008, 0.03, '#ffffff');
      break;
    case 'turban':
      circle(out, 0, 0.005, 0.12, col);
      path(out, 'M-0.11,0.02 Q0,-0.08 0.11,0.02', 'none', { stroke: dk, sw: 0.015 });
      path(out, 'M-0.1,0.06 Q0,-0.02 0.1,0.06', 'none', { stroke: dk, sw: 0.015 });
      break;
    case 'peci':
      circle(out, 0, 0.012, 0.098, hairColor('black'));
      ellipse(out, 0, 0.005, 0.092, 0.085, '#1b1b1b');
      ellipse(out, -0.02, -0.02, 0.03, 0.02, '#ffffff', { op: 0.12 });
      break;
    case 'helmet':
      circle(out, 0, 0.0, 0.125, col);
      line(out, 0, -0.12, 0, 0.12, dk, 0.025);
      ellipse(out, 0, -0.12, 0.09, 0.03, dk);
      break;
    case 'fire_helmet':
      ellipse(out, 0, 0.03, 0.15, 0.17, dk);
      circle(out, 0, 0.0, 0.12, col);
      line(out, 0, -0.11, 0, 0.11, darker(col, 0.6), 0.03);
      break;
    case 'police_cap':
      circle(out, 0, 0.0, 0.128, col);
      circle(out, 0, 0.0, 0.128, 'none', { stroke: '#e9eef4', sw: 0.016 });
      ellipse(out, 0, -0.115, 0.08, 0.04, '#111111');
      circle(out, 0, -0.07, 0.022, '#e3b341');
      break;
    case 'pilot_cap':
      circle(out, 0, 0.0, 0.125, col);
      circle(out, 0, 0.0, 0.125, 'none', { stroke: '#e3b341', sw: 0.014 });
      ellipse(out, 0, -0.115, 0.08, 0.04, '#111111');
      circle(out, 0, -0.075, 0.02, '#e3b341');
      break;
    case 'beret':
      circle(out, 0, 0.012, 0.098, hairColor('black'));
      ellipse(out, -0.02, -0.005, 0.11, 0.1, col);
      circle(out, 0.05, -0.06, 0.018, '#e3b341');
      break;
  }
  if (acc === 'ear_defenders') {
    ellipse(out, -0.12, 0.0, 0.03, 0.05, '#222222');
    ellipse(out, 0.12, 0.0, 0.03, 0.05, '#222222');
    path(out, 'M-0.12,0 Q0,-0.02 0.12,0', 'none', { stroke: '#222222', sw: 0.02 });
  }
  if (acc === 'headset') {
    ellipse(out, -0.11, 0.0, 0.025, 0.04, '#222222');
    path(out, 'M-0.11,0.0 Q-0.09,-0.09 -0.03,-0.11', 'none', { stroke: '#222222', sw: 0.012 });
  }
}

const SWING_EVEN = 1.0;
const SWING_ODD = 0.25;

/** Port of people2.py person(). Ops are in local meters; the scale group is applied by personOps. */
function personLayers(out: ShapeOp[], r: PersonLook, frame: number, detail: number, withShadow: boolean): void {
  const shirt = r.shirt;
  const sleeve = r.sleeve ?? shirt;
  const shoes = r.shoes ?? '#1f1f1f';
  const skin = PEOPLE.skin[r.skin];
  const hairHex = hairColor(r.hairCol);
  const items = r.items;
  const seated = items.includes('wheelchair');
  const flip = frame === 2 ? -1 : 1;
  const swing = frame % 2 === 0 ? SWING_EVEN : SWING_ODD;

  // Tiers 0 and 1 return before the shadow is drawn, so the shadow only exists at detail 2.
  if (detail === 0) {
    circle(out, 0, 0, 0.22, shirt, { stroke: '#ffffff', sw: 0.04 });
    return;
  }
  if (detail === 1) {
    ellipse(out, 0, 0, 0.24, 0.14, shirt);
    circle(out, 0, 0, 0.1, hairHex);
    return;
  }

  if (withShadow) ellipse(out, 0.03, 0.04, 0.3, 0.2, OUT);

  // Wheelchair frame under the body, or feet with a gait.
  if (seated) {
    rect(out, -0.25, -0.2, 0.5, 0.48, '#3d4652', { rx: 0.06 });
    rect(out, -0.34, -0.12, 0.07, 0.4, '#20252c', { rx: 0.03 });
    rect(out, 0.27, -0.12, 0.07, 0.4, '#20252c', { rx: 0.03 });
    line(out, -0.17, 0.28, -0.17, 0.38, '#20252c', 0.04, { cap: 'round' });
    line(out, 0.17, 0.28, 0.17, 0.38, '#20252c', 0.04, { cap: 'round' });
    ellipse(out, -0.1, -0.26, 0.05, 0.04, shoes);
    ellipse(out, 0.1, -0.26, 0.05, 0.04, shoes);
  } else {
    ellipse(out, flip * 0.085, -0.135 * swing - 0.02, 0.05, 0.08, shoes);
    ellipse(out, -flip * 0.085, 0.135 * swing + 0.02, 0.05, 0.08, shoes);
  }

  // Trailing items.
  for (const it of items) {
    if (it === 'suitcase') {
      line(out, flip * 0.25, 0.15 * swing, flip * 0.34, 0.24, '#555b63', 0.02);
      rect(out, flip * 0.34 - 0.11, 0.24, 0.22, 0.34, r.case ?? '#2f5aa8', { rx: 0.04 });
      rect(out, flip * 0.34 - 0.11, 0.24, 0.22, 0.34, 'none', { stroke: '#00000040', sw: 0.015, rx: 0.04 });
      line(out, flip * 0.34 - 0.06, 0.28, flip * 0.34 - 0.06, 0.54, '#00000030', 0.012);
      line(out, flip * 0.34 + 0.06, 0.28, flip * 0.34 + 0.06, 0.54, '#00000030', 0.012);
    }
    if (it === 'trolley') {
      rect(out, -0.2, -0.62, 0.4, 0.34, '#9aa3ad', { stroke: '#59616d', sw: 0.02, rx: 0.03 });
      rect(out, -0.16, -0.6, 0.32, 0.18, '#7a4f3a', { rx: 0.03 });
      rect(out, -0.13, -0.42, 0.26, 0.12, '#2f5aa8', { rx: 0.03 });
      line(out, -0.2, -0.28, 0.2, -0.28, '#59616d', 0.03);
    }
    if (it === 'stroller') {
      rect(out, -0.17, -0.62, 0.34, 0.4, '#5b6b7a', { rx: 0.08 });
      ellipse(out, 0, -0.5, 0.13, 0.1, '#cfd8e0');
      line(out, -0.17, -0.24, 0.17, -0.24, '#2b3036', 0.03);
    }
    if (it === 'cart') {
      rect(out, -0.22, -0.66, 0.44, 0.38, '#7b8796', { stroke: '#4e5866', sw: 0.02, rx: 0.04 });
      circle(out, -0.08, -0.52, 0.07, '#2f6fdd');
      circle(out, 0.09, -0.52, 0.06, '#e3b341');
      line(out, 0.1, -0.4, 0.16, -0.28, '#a07a4a', 0.025);
    }
  }

  // Torso and overlay.
  ellipse(out, 0, 0.0, 0.245, 0.135, shirt);
  ellipse(out, 0, 0.035, 0.2, 0.08, darker(shirt, 0.9));
  const ov = r.overlay;
  if (ov === 'vest_orange' || ov === 'vest_yellow' || ov === 'vest_police') {
    const vc = { vest_orange: '#f26b1d', vest_yellow: '#e8e22a', vest_police: '#d9e021' }[ov];
    ellipse(out, 0, 0.0, 0.2, 0.125, vc);
    line(out, -0.19, -0.03, 0.19, -0.03, '#dfe6ec', 0.022);
    line(out, -0.19, 0.04, 0.19, 0.04, '#dfe6ec', 0.022);
    if (ov === 'vest_police') {
      for (let k = -3; k <= 3; k++) {
        rect(out, k * 0.05 - 0.025, 0.07, 0.025, 0.03, '#1d3fa8');
      }
    }
  }
  if (ov === 'turnout') {
    ellipse(out, 0, 0.0, 0.25, 0.14, '#c9a24a');
    line(out, -0.23, -0.02, 0.23, -0.02, '#dfe6ec', 0.028);
    line(out, -0.21, 0.06, 0.21, 0.06, '#e8e22a', 0.022);
  }
  if (ov === 'paramedic') {
    line(out, -0.23, 0.0, 0.23, 0.0, '#dfe6ec', 0.03);
    rect(out, -0.03, 0.03, 0.06, 0.06, '#ffffff');
    rect(out, -0.01, 0.035, 0.02, 0.05, '#d9463e');
    rect(out, -0.025, 0.05, 0.05, 0.02, '#d9463e');
  }
  if (ov === 'apron') {
    ellipse(out, 0, 0.01, 0.16, 0.1, r.apron ?? '#2a9d8f');
  }
  if (ov === 'blazer') {
    path(out, 'M-0.06,-0.13 L0,-0.02 L0.06,-0.13', 'none', { stroke: '#ffffff', sw: 0.025 });
    path(out, 'M-0.04,-0.13 L0,-0.05 L0.04,-0.13Z', r.scarf ?? '#c8102e');
  }
  if (ov === 'suit') {
    path(out, 'M-0.07,-0.13 L0,-0.03 L0.07,-0.13Z', '#f4f4f4');
    path(out, 'M-0.015,-0.12 L0,-0.05 L0.015,-0.12Z', r.tie ?? '#8a2f2f');
  }
  if (ov === 'overalls') {
    line(out, -0.09, -0.12, -0.09, 0.12, darker(shirt, 0.7), 0.03);
    line(out, 0.09, -0.12, 0.09, 0.12, darker(shirt, 0.7), 0.03);
  }
  if (r.epaulettes) {
    for (const sg of [-1, 1]) {
      rect(out, sg * 0.18 - 0.04, -0.03, 0.08, 0.06, '#1b2a44', { rx: 0.01 });
      for (let k = 0; k < r.epaulettes; k++) {
        rect(out, sg * 0.18 - 0.035, -0.022 + k * 0.014, 0.07, 0.007, '#e3b341');
      }
    }
  }
  if (r.radio) {
    rect(out, 0.12, -0.11, 0.05, 0.07, '#1b1b1b', { rx: 0.01 });
    line(out, 0.145, -0.11, 0.145, -0.16, '#1b1b1b', 0.01);
  }

  // Items carried on the back.
  for (const it of items) {
    if (it === 'backpack') {
      const pack = r.pack ?? '#3b4a5a';
      rect(out, -0.15, 0.04, 0.3, 0.16, pack, { rx: 0.05 });
      rect(out, -0.1, 0.08, 0.2, 0.06, darker(pack, 0.8), { rx: 0.03 });
    }
    if (it === 'big_backpack') {
      rect(out, -0.17, 0.02, 0.34, 0.26, r.pack ?? '#a33b2a', { rx: 0.07 });
      rect(out, -0.13, 0.2, 0.26, 0.09, '#4b6b3a', { rx: 0.04 });
    }
    if (it === 'baby_carrier') {
      ellipse(out, 0, -0.17, 0.12, 0.08, '#8fb3d9');
      circle(out, 0, -0.2, 0.06, hairColor('dark'));
    }
    if (it === 'shoulder_bag') {
      line(out, -0.2, -0.05, 0.15, 0.1, '#5a3b2a', 0.02);
      rect(out, -0.32, -0.08, 0.12, 0.18, '#7a4f3a', { rx: 0.03 });
    }
  }

  // Arms and hands.
  const hand = r.gloves ? r.gloves : skin;
  const ax = 0.215;
  if (seated) {
    capsule(out, -ax, 0.0, -0.3, 0.02, 0.085, sleeve);
    capsule(out, ax, 0.0, 0.3, 0.02, 0.085, sleeve);
    circle(out, -0.31, 0.03, 0.045, hand);
    circle(out, 0.31, 0.03, 0.045, hand);
  } else if (items.includes('wands')) {
    for (const sg of [-1, 1]) {
      capsule(out, sg * ax, -0.02, sg * 0.36, -0.06, 0.085, sleeve);
      circle(out, sg * 0.37, -0.06, 0.045, hand);
      capsule(out, sg * 0.37, -0.06, sg * 0.5, -0.1, 0.05, '#ff6a13');
    }
  } else {
    let fx = -flip * 0.275;
    let fy = -0.22 * swing - 0.03;
    const bx = flip * 0.255;
    const by = 0.16 * swing + 0.02;
    if (items.includes('phone') || items.includes('coffee') || items.includes('clipboard')) {
      fx = -flip * 0.2;
      fy = -0.2;
    }
    capsule(out, -flip * ax, -0.02, fx, fy, 0.088, sleeve);
    capsule(out, flip * ax, 0.0, bx, by, 0.088, sleeve);
    circle(out, fx, fy, 0.046, hand);
    circle(out, bx, by, 0.046, hand);
    for (const it of items) {
      if (it === 'phone') rect(out, fx - 0.03, fy - 0.06, 0.06, 0.09, '#1b1b1b', { rx: 0.01 });
      if (it === 'coffee') circle(out, fx, fy - 0.035, 0.035, '#f4f1ea', { stroke: '#6b4f3a', sw: 0.01 });
      if (it === 'clipboard') {
        rect(out, fx - 0.06, fy - 0.15, 0.12, 0.16, '#c9a77a', { rx: 0.01 });
        rect(out, fx - 0.045, fy - 0.13, 0.09, 0.11, '#ffffff');
      }
      if (it === 'handbag') rect(out, bx - 0.06, by - 0.02, 0.12, 0.1, '#9c3b52', { rx: 0.02 });
      if (it === 'toolbox') rect(out, bx - 0.08, by - 0.02, 0.16, 0.08, '#c8102e', { rx: 0.015 });
      if (it === 'medbag') {
        rect(out, bx - 0.09, by - 0.02, 0.18, 0.1, '#2f8f4e', { rx: 0.02 });
        rect(out, bx - 0.01, by - 0.005, 0.02, 0.07, '#ffffff');
        rect(out, bx - 0.035, by + 0.02, 0.07, 0.02, '#ffffff');
      }
      if (it === 'cane') line(out, fx, fy, fx - 0.04 * flip, fy - 0.12, '#5a3b2a', 0.022, { cap: 'round' });
      if (it === 'extinguisher') rect(out, bx - 0.045, by - 0.02, 0.09, 0.16, '#d9463e', { rx: 0.04 });
      // child_hand draws nothing in people2.py.
    }
  }

  // Head.
  circle(out, 0, -0.005, 0.105, skin);
  hairShape(out, r.hair, hairHex, r.headAcc);
}

/**
 * Appends the person's shapes to out in person() draw order. The scale group is copied onto each op.
 * detail 0, 1, 2 match people2.py tiers 0, 1, 2. frame 0 to 3 gives the flip and swing of the gait.
 */
export function personOps(recipe: PersonLook, frame: number, detail: number, withShadow: boolean, out: ShapeOp[]): void {
  if (!Number.isInteger(frame) || frame < 0 || frame > 3) throw new RangeError(`person frame ${frame} must be 0 to 3`);
  if (!Number.isInteger(detail) || detail < 0 || detail > 2) throw new RangeError(`person detail ${detail} must be 0 to 2`);
  const sc = recipe.scale ?? 1;
  const local: ShapeOp[] = [];
  personLayers(local, recipe, frame, detail, withShadow);
  for (const op of local) out.push({ ...op, sx: sc, sy: sc });
}

/** Port of people2.py vbounds(). Vertical reach in meters of the figure, scaled by the recipe scale. */
export function vbounds(recipe: PersonLook): { lo: number; hi: number } {
  const items = recipe.items;
  const sc = recipe.scale ?? 1;
  const lo = items.some((i) => i === 'trolley' || i === 'stroller' || i === 'cart') ? -0.68 : -0.3;
  const hi = items.includes('suitcase') ? 0.6 : items.includes('wheelchair') ? 0.4 : 0.3;
  return { lo: lo * sc, hi: hi * sc };
}

/** Path ops use absolute M, L, Q, C, A and Z only, as people2.py writes them. Arc ends are the 6th and 7th values. */
const PATH_TOKEN = /[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g;

function pathPoints(d: string): Pt[] {
  const pts: Pt[] = [];
  let cmd = '';
  let nums: number[] = [];
  const flush = (): void => {
    if (cmd === 'A') {
      for (let i = 0; i + 7 <= nums.length; i += 7) pts.push([nums[i + 5], nums[i + 6]]);
    } else {
      for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
    }
  };
  for (const m of d.matchAll(PATH_TOKEN)) {
    const t = m[0];
    if (/[A-Za-z]/.test(t)) {
      if (!'MLQCAZ'.includes(t)) throw new Error(`path command ${t} is not used by people2.py`);
      flush();
      cmd = t;
      nums = [];
    } else {
      nums.push(Number(t));
    }
  }
  flush();
  return pts;
}

/** Local extent of an op in its own units, grown by half the stroke width when it is stroked. */
function localBox(op: ShapeOp): [number, number, number, number, number] {
  const half = (stroked: boolean, sw: number | undefined): number => (stroked && sw !== undefined ? sw / 2 : 0);
  switch (op.k) {
    case 'rect':
      return [op.x, op.y, op.x + op.w, op.y + op.h, half(op.stroke !== undefined, op.sw)];
    case 'circle':
      return [op.cx - op.r, op.cy - op.r, op.cx + op.r, op.cy + op.r, half(op.stroke !== undefined, op.sw)];
    case 'ellipse':
      return [op.cx - op.rx, op.cy - op.ry, op.cx + op.rx, op.cy + op.ry, half(op.stroke !== undefined, op.sw)];
    case 'line':
      return [
        Math.min(op.x1, op.x2),
        Math.min(op.y1, op.y2),
        Math.max(op.x1, op.x2),
        Math.max(op.y1, op.y2),
        op.sw / 2,
      ];
    case 'poly':
      return [...pointBox(op.pts), half(op.stroke !== undefined, op.sw)];
    case 'path':
      return [...pointBox(pathPoints(op.d)), half(op.stroke !== undefined, op.sw)];
  }
}

function pointBox(pts: readonly Pt[]): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

/** Applies the flattened group transform to a local point: scale, then rotate, then translate. */
function toWorld(op: ShapeOp, x: number, y: number): [number, number] {
  let px = x * (op.sx ?? 1);
  let py = y * (op.sy ?? 1);
  if (op.rotDeg) {
    const a = (op.rotDeg * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    [px, py] = [px * c - py * s, px * s + py * c];
  }
  return [px + (op.tx ?? 0), py + (op.ty ?? 0)];
}

/**
 * Conservative box in meters around all ops, with stroke half widths and group transforms included.
 * Path extents use the coordinate points of the d string, so a curve box may be a little larger than its ink.
 */
export function opsBounds(ops: readonly ShapeOp[]): { minX: number; minY: number; maxX: number; maxY: number } {
  if (ops.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const op of ops) {
    const [x0, y0, x1, y1, grow] = localBox(op);
    const corners: [number, number][] = [
      [x0 - grow, y0 - grow],
      [x1 + grow, y0 - grow],
      [x0 - grow, y1 + grow],
      [x1 + grow, y1 + grow],
    ];
    for (const [cx, cy] of corners) {
      const [wx, wy] = toWorld(op, cx, cy);
      minX = Math.min(minX, wx);
      minY = Math.min(minY, wy);
      maxX = Math.max(maxX, wx);
      maxY = Math.max(maxY, wy);
    }
  }
  return { minX, minY, maxX, maxY };
}
