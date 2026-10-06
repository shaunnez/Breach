import { CollisionWorld, type Box, type BoxKind } from './collision';
import type { DevRoom } from '../protocol';

/**
 * Refinery Test Cell A greybox (bible section 13). X east, Z south, Y up, metres.
 * Floor top is y = 0. All geometry is axis-aligned boxes.
 *
 *   MS (spawn) -- C1 -- J (junction) -- P1 ------- R (resource room)
 *                       |                             |
 *                       M1 -- M2 ------ vent ------+  P2
 *                                                  +-- H (hive / bloom spawn)
 */

const T = 0.4; // wall thickness

/** Door / vent openings recorded while building (visual decor only: frames, hazard strips). */
export interface DoorOpening {
  /** axis the opening faces along: 'x' = passes through an E/W wall (travel along X) */
  axis: 'x' | 'z';
  /** wall centre-plane coordinate on that axis */
  plane: number;
  /** centre of the opening along the wall */
  c: number;
  w: number;
  y0: number;
  h: number;
  vent: boolean;
}
export const DOOR_OPENINGS: DoorOpening[] = [];

export interface RoomVolume {
  name: string;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  h: number;
  tint: number; // 0xRRGGBB for greybox readability
}

export interface MapLight {
  x: number;
  y: number;
  z: number;
  color: number;
  intensity: number;
  distance: number;
}

export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

interface Door {
  side: 'N' | 'S' | 'E' | 'W';
  c: number; // centre along the wall (x for N/S walls, z for E/W)
  w: number;
  y0?: number;
  h?: number;
}

function mk(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, kind: BoxKind): Box {
  return { minX, minY, minZ, maxX, maxY, maxZ, kind };
}

/** Wall segment along X or Z with rectangular openings cut out. */
function wallWithCuts(
  boxes: Box[],
  axis: 'x' | 'z',
  a0: number,
  a1: number,
  p0: number,
  p1: number,
  h: number,
  cuts: { c: number; w: number; y0: number; h: number }[],
): void {
  // axis 'x': wall runs along X over [a0,a1], thickness over Z [p0,p1]
  const cs = [...cuts].sort((a, b) => a.c - b.c);
  let cur = a0;
  const emit = (s0: number, s1: number, y0: number, y1: number) => {
    if (s1 - s0 < 1e-6 || y1 - y0 < 1e-6) return;
    boxes.push(axis === 'x' ? mk(s0, y0, p0, s1, y1, p1, 'wall') : mk(p0, y0, s0, p1, y1, s1, 'wall'));
  };
  for (const c of cs) {
    const c0 = c.c - c.w / 2;
    const c1 = c.c + c.w / 2;
    emit(cur, c0, 0, h);
    emit(c0, c1, 0, c.y0); // below opening
    emit(c0, c1, c.y0 + c.h, h); // lintel
    cur = c1;
  }
  emit(cur, a1, 0, h);
}

function room(boxes: Box[], r: { x0: number; x1: number; z0: number; z1: number; h: number }, doors: Door[]): void {
  const { x0, x1, z0, z1, h } = r;
  const cuts = (side: Door['side']) =>
    doors
      .filter((d) => d.side === side)
      .map((d) => ({ c: d.c, w: d.w, y0: d.y0 ?? 0, h: d.h ?? 2.4 }));
  for (const d of doors) {
    const plane = d.side === 'N' ? z0 - T / 2 : d.side === 'S' ? z1 + T / 2 : d.side === 'W' ? x0 - T / 2 : x1 + T / 2;
    DOOR_OPENINGS.push({ axis: d.side === 'N' || d.side === 'S' ? 'z' : 'x', plane, c: d.c, w: d.w, y0: d.y0 ?? 0, h: d.h ?? 2.4, vent: (d.y0 ?? 0) > 1 });
  }
  wallWithCuts(boxes, 'x', x0 - T, x1 + T, z0 - T, z0, h, cuts('N'));
  wallWithCuts(boxes, 'x', x0 - T, x1 + T, z1, z1 + T, h, cuts('S'));
  wallWithCuts(boxes, 'z', z0, z1, x0 - T, x0, h, cuts('W'));
  wallWithCuts(boxes, 'z', z0, z1, x1, x1 + T, h, cuts('E'));
  boxes.push(mk(x0 - T, h, z0 - T, x1 + T, h + T, z1 + T, 'ceiling'));
}

/** Corridor: side walls + ceiling; ends are open and meet door cuts in adjoining room walls. */
function corridor(boxes: Box[], r: { x0: number; x1: number; z0: number; z1: number; h: number }, runsAlong: 'x' | 'z'): void {
  const { x0, x1, z0, z1, h } = r;
  if (runsAlong === 'z') {
    boxes.push(mk(x0 - T, 0, z0, x0, h, z1, 'wall'));
    boxes.push(mk(x1, 0, z0, x1 + T, h, z1, 'wall'));
  } else {
    boxes.push(mk(x0, 0, z0 - T, x1, h, z0, 'wall'));
    boxes.push(mk(x0, 0, z1, x1, h, z1 + T, 'wall'));
  }
  boxes.push(mk(x0 - (runsAlong === 'z' ? T : 0), h, z0 - (runsAlong === 'x' ? T : 0), x1 + (runsAlong === 'z' ? T : 0), h + T, z1 + (runsAlong === 'x' ? T : 0), 'ceiling'));
}

/** VS02 Command Core console against the Marine spawn's north wall. The Commander's body stands at (standX, standZ). */
export const COMMAND_CONSOLE = { x: 6, z: 1.3, standX: 6, standZ: 2.2, yaw: 0 };

/** VS02 resource wells. One active well at the centre of the Resource Room (bible section 35). */
export interface ResourceNode {
  id: string;
  x: number;
  y: number;
  z: number;
}
export const RESOURCE_NODES: ResourceNode[] = [{ id: 'well-a', x: 30, y: 0.5, z: 16 }];

const VENT = {
  yc: 3.3,
  half: 0.525,
  legs: [
    // centreline waypoints (x, z)
    [10.0, 22.4],
    [19.0, 22.4],
    [19.0, 27.6],
    [24.0, 27.6],
  ] as [number, number][],
};

export const VENT_PATH = VENT.legs.map(([x, z]) => ({ x, y: VENT.yc, z }));

function buildBoxes(): Box[] {
  const B: Box[] = [];
  const h = VENT.half;
  const yb = VENT.yc - h;
  const yt = VENT.yc + h;

  // floor slab under everything
  B.push(mk(-1, -1, -1, 38, 0, 36, 'floor'));

  // ---- Marine spawn -------------------------------------------------------------------------
  room(B, { x0: 1, x1: 11, z0: 1, z1: 9, h: 4 }, [{ side: 'S', c: 6, w: 2.4 }]);
  B.push(mk(COMMAND_CONSOLE.x - 0.7, 0, 1, COMMAND_CONSOLE.x + 0.7, 1.1, 1.6, 'prop')); // Command Core console (VS02)
  corridor(B, { x0: 4.2, x1: 7.8, z0: 9.4, z1: 16.6, h: 3.6 }, 'z');

  // ---- Junction (vent mouth cut into the east wall) ------------------------------------------
  room(B, { x0: 2, x1: 10, z0: 17, z1: 25, h: 4.2 }, [
    { side: 'N', c: 6, w: 2.4 },
    { side: 'E', c: 19.2, w: 2.4 },
    { side: 'E', c: 22.4, w: 2 * h, y0: yb, h: 2 * h },
    { side: 'S', c: 6, w: 2.4 },
  ]);
  B.push(mk(5.2, 0, 20.2, 6.8, 1.5, 21.8, 'prop')); // central cover block
  B.push(mk(2, 3.5, 20.6, 10, 3.9, 21.4, 'prop')); // overhead beam

  // ---- Passage to the resource room -----------------------------------------------------------
  corridor(B, { x0: 10.4, x1: 23.6, z0: 17.4, z1: 21.0, h: 3.4 }, 'x');
  B.push(mk(16.2, 0, 17.4, 17.4, 1.2, 18.6, 'prop')); // cover in passage
  B.push(mk(14.2, 2.7, 17.4, 14.8, 3.4, 21.0, 'prop')); // hanging bulkhead (Ripper line)

  // ---- Resource room -------------------------------------------------------------------------
  room(B, { x0: 24, x1: 36, z0: 11, z1: 21, h: 5 }, [
    { side: 'W', c: 19.2, w: 2.4 },
    { side: 'S', c: 30, w: 2.4 },
  ]);
  B.push(mk(28.8, 0, 14.8, 31.2, 0.5, 17.2, 'prop')); // resource well plinth (VS02: the active well)
  B.push(mk(29.45, 0.5, 15.45, 30.55, 2.1, 16.55, 'prop')); // well head: structures are built around it (D-30)
  B.push(mk(24, 4.2, 15.9, 36, 4.6, 16.4, 'prop')); // overhead pipe
  B.push(mk(24, 2.3, 11, 36, 2.6, 13.2, 'ledge')); // upper maintenance ledge
  for (let i = 0; i < 8; i++) {
    // stairs up to the ledge along the east wall (0.325 m risers)
    B.push(mk(34.8, 0, 17 - 0.5 * (i + 1), 36, 0.325 * (i + 1), 17 - 0.5 * i, 'prop'));
  }
  B.push(mk(25.2, 0, 19.2, 26.4, 1.2, 20.4, 'prop'));
  B.push(mk(32.4, 0, 18.4, 33.6, 1.1, 19.6, 'prop'));
  B.push(mk(25, 0, 11.6, 26.4, 1.4, 13, 'prop'));
  B.push(mk(32.5, 0, 12.2, 33.9, 1.0, 13, 'prop'));

  corridor(B, { x0: 28.2, x1: 31.8, z0: 21.4, z1: 23.6, h: 3.4 }, 'z');

  // ---- Maintenance route ---------------------------------------------------------------------
  // M1 (south from junction) and M2 (east to the hive), one 90 degree bend
  room(B, { x0: 4, x1: 8, z0: 25.4, z1: 33, h: 3.4 }, [
    { side: 'N', c: 6, w: 2.4 },
    { side: 'E', c: 31, w: 4, h: 3.4 },
  ]);
  // junction south wall (z 25..25.4) needs the matching opening
  corridor(B, { x0: 8.4, x1: 23.6, z0: 29, z1: 33, h: 3.6 }, 'x');
  B.push(mk(4.4, 0, 26.6, 5.5, 1.1, 27.7, 'prop'));
  B.push(mk(6.7, 0, 29.4, 7.8, 1.3, 30.5, 'prop'));
  B.push(mk(12.5, 0, 29.2, 13.9, 1.4, 30.6, 'prop'));
  B.push(mk(17.0, 0, 31.6, 18.2, 1.1, 32.8, 'prop'));
  B.push(mk(8.4, 2.9, 29, 23.6, 3.3, 29.5, 'prop')); // overhead pipe run

  // ---- Hive approach / Bloom spawn ----------------------------------------------------------
  room(B, { x0: 24, x1: 36, z0: 24, z1: 34, h: 6 }, [
    { side: 'N', c: 30, w: 2.4 },
    { side: 'W', c: 31, w: 2.4 },
    { side: 'W', c: 27.6, w: 2 * h, y0: yb, h: 2 * h },
  ]);
  B.push(mk(26.4, 0, 28.4, 27.6, 6, 29.6, 'prop')); // column
  B.push(mk(32.4, 0, 28.4, 33.6, 6, 29.6, 'prop')); // column
  B.push(mk(34.6, 3.2, 26, 36, 3.5, 32, 'ledge')); // shelf
  B.push(mk(29.4, 0, 25.6, 30.8, 1.0, 26.8, 'prop'));

  // ---- Vent: 1.05 m square tube, shell around the cavity -------------------------------------
  const [p0, p1, p2, p3] = VENT.legs;
  const [x0, z0] = p0;
  const [x1] = p1;
  const [, z2] = p2;
  const [x3] = p3;
  // bottom + top plates covering each leg footprint expanded by T
  const plate = (ax0: number, az0: number, ax1: number, az1: number) => {
    B.push(mk(ax0, yb - T, az0, ax1, yb, az1, 'vent'));
    B.push(mk(ax0, yt, az0, ax1, yt + T, az1, 'vent'));
  };
  plate(x0, z0 - h - T, x1 + h + T, z0 + h + T);
  plate(x1 - h - T, z0 - h - T, x1 + h + T, z2 + h + T);
  plate(x1 - h - T, z2 - h - T, x3, z2 + h + T);
  const side = (ax0: number, az0: number, ax1: number, az1: number) => B.push(mk(ax0, yb, az0, ax1, yt, az1, 'vent'));
  side(x0, z0 - h - T, x1 + h + T, z0 - h); // leg1 north
  side(x0, z0 + h, x1 - h, z0 + h + T); // leg1 south (stops at leg2 opening)
  side(x1 - h - T, z0 + h, x1 - h, z2 + h + T); // leg2 west
  side(x1 + h, z0 - h - T, x1 + h + T, z2 - h); // leg2 east (down to leg3 opening)
  side(x1 + h, z2 - h - T, x3, z2 - h); // leg3 north
  side(x1 - h, z2 + h, x3, z2 + h + T); // leg3 south
  return B;
}

export const ROOMS: RoomVolume[] = [
  { name: 'marineSpawn', x0: 1, x1: 11, z0: 1, z1: 9, h: 4, tint: 0x4d5f78 },
  { name: 'corridor', x0: 4.2, x1: 7.8, z0: 9.4, z1: 16.6, h: 3.6, tint: 0x58606b },
  { name: 'junction', x0: 2, x1: 10, z0: 17, z1: 25, h: 4.2, tint: 0x6a6f78 },
  { name: 'passage', x0: 10.4, x1: 23.6, z0: 17.4, z1: 21, h: 3.4, tint: 0x5e646e },
  { name: 'resource', x0: 24, x1: 36, z0: 11, z1: 21, h: 5, tint: 0x7a6650 },
  { name: 'maintenance', x0: 4, x1: 23.6, z0: 25.4, z1: 33, h: 3.6, tint: 0x56606a },
  { name: 'hive', x0: 24, x1: 36, z0: 24, z1: 34, h: 6, tint: 0x4d3340 },
  { name: 'vent', x0: 10, x1: 24, z0: 21.4, z1: 28.6, h: 4.3, tint: 0x3a3f46 },
];

export const MARINE_SPAWNS: SpawnPoint[] = [
  { x: 3.5, y: 0, z: 3.2, yaw: Math.PI },
  { x: 8.5, y: 0, z: 3.2, yaw: Math.PI },
  { x: 3.5, y: 0, z: 6.6, yaw: Math.PI },
  { x: 8.5, y: 0, z: 6.6, yaw: Math.PI },
];

export const BLOOM_SPAWNS: SpawnPoint[] = [
  { x: 28, y: 0.29, z: 32.2, yaw: 0.6 },
  { x: 32, y: 0.29, z: 32.6, yaw: 0.3 },
  { x: 34.4, y: 0.29, z: 30, yaw: -0.5 },
  { x: 33.2, y: 0.29, z: 25.6, yaw: 0.0 },
];

export const DEV_TELEPORTS: Record<DevRoom, { marine: SpawnPoint; ripper: SpawnPoint }> = {
  marineSpawn: { marine: { x: 6, y: 0, z: 5, yaw: Math.PI }, ripper: { x: 6, y: 0.29, z: 5, yaw: Math.PI } },
  junction: { marine: { x: 3.4, y: 0, z: 19, yaw: -Math.PI / 2 }, ripper: { x: 3.4, y: 0.29, z: 19, yaw: -Math.PI / 2 } },
  resource: { marine: { x: 26, y: 0, z: 17, yaw: -Math.PI / 2 }, ripper: { x: 26, y: 0.29, z: 17, yaw: -Math.PI / 2 } },
  ledge: { marine: { x: 30, y: 2.6, z: 12, yaw: Math.PI }, ripper: { x: 30, y: 2.89, z: 12, yaw: Math.PI } },
  maintenance: { marine: { x: 6, y: 0, z: 28, yaw: Math.PI }, ripper: { x: 6, y: 0.29, z: 28, yaw: Math.PI } },
  hive: { marine: { x: 30, y: 0, z: 31, yaw: 0 }, ripper: { x: 30, y: 0.29, z: 31, yaw: 0 } },
  // Marines cannot fit the vent; place them at its junction-side approach instead.
  vent: { marine: { x: 8.6, y: 0, z: 22.4, yaw: -Math.PI / 2 }, ripper: { x: 12, y: 3.07, z: 22.4, yaw: -Math.PI / 2 } },
  // VS02: in front of the Command Core console, and west of the well facing it
  console: { marine: { x: 6, y: 0, z: 2.6, yaw: 0 }, ripper: { x: 6, y: 0.29, z: 2.8, yaw: 0 } },
  well: { marine: { x: 27.6, y: 0, z: 16, yaw: -Math.PI / 2 }, ripper: { x: 27.6, y: 0.29, z: 16, yaw: -Math.PI / 2 } },
};

export const MAP_LIGHTS: MapLight[] = [
  { x: 6, y: 3.5, z: 5, color: 0x9fd8ff, intensity: 14, distance: 14 },
  { x: 6, y: 3.2, z: 13, color: 0xcfe6ff, intensity: 8, distance: 10 },
  { x: 6, y: 3.8, z: 21, color: 0xffffff, intensity: 16, distance: 14 },
  { x: 17, y: 3.0, z: 19.2, color: 0xffb36b, intensity: 8, distance: 12 },
  { x: 30, y: 4.5, z: 16, color: 0xffa24a, intensity: 26, distance: 20 },
  { x: 30, y: 4.5, z: 12, color: 0xffd9a8, intensity: 10, distance: 12 },
  { x: 6, y: 3.0, z: 29, color: 0xffd0a0, intensity: 8, distance: 12 },
  { x: 16, y: 3.1, z: 31, color: 0xffc89a, intensity: 8, distance: 12 },
  { x: 30, y: 5.4, z: 29, color: 0xff4d66, intensity: 13, distance: 20 },
  { x: 30, y: 2.5, z: 32, color: 0x9a4dff, intensity: 10, distance: 12 },
];

export const MAP_BOUNDS = { minX: 0.6, maxX: 36.4, minZ: 0.6, maxZ: 34.4 };

export const MAP_BOXES: Box[] = buildBoxes();

export function createTestCellA(): CollisionWorld {
  return new CollisionWorld(MAP_BOXES.map((b) => ({ ...b })));
}

export function roomAt(x: number, z: number): string {
  for (const r of ROOMS) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return r.name;
  return 'unknown';
}
