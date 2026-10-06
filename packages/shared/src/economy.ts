import { ECONOMY, STRUCTURE, secToTicks } from './balance';
import { Faction, StructureState, type MatchPhase, type StructureType } from './enums';
import { RESOURCE_NODES, type ResourceNode } from './map/testCellA';
import type { Vec3 } from './math';

/**
 * VS02 economy + structure rules (bible sections 32-35) as pure data + functions.
 * The server owns the only live `EconomyState` and is the sole authority (D-26); the client imports
 * these helpers for presentation hints only (hologram validity, cost labels).
 */

export interface Structure {
  id: string;
  type: StructureType;
  faction: Faction;
  nodeId: string;
  x: number;
  y: number;
  z: number;
  hp: number;
  maxHp: number;
  state: StructureState;
  /** ticks of construction done (complete at BUILD_TICKS) */
  buildTicks: number;
  /** player who placed it (Commander / Weaver) */
  builderId: string;
}

export interface TeamEconomy {
  resources: number;
  /** lifetime totals (telemetry) */
  earned: number;
  spent: number;
}

export interface EconomyState {
  teams: [TeamEconomy, TeamEconomy];
  structures: Structure[];
  nextId: number;
}

/** Bible section 33 build request (`structure` widened to the Bloom Harvester for the Weaver). */
export interface BuildRequest {
  requestId: number;
  structure: StructureType;
  resourceNodeId: string;
}

export type BuildRejectReason =
  | 'malformed'
  | 'wrong-role'
  | 'invalid-node'
  | 'node-occupied'
  | 'insufficient-resources'
  | 'wrong-phase'
  | 'out-of-reach'
  | 'dead';

export const BUILD_TICKS = secToTicks(ECONOMY.structureBuildSec);
const INCOME_PER_TICK = ECONOMY.structureIncomePerSec / 60;

export const STRUCTURE_FACTION: Record<StructureType, Faction> = { extractor: Faction.Expedition, harvester: Faction.Bloom };
export const STRUCTURE_COST: Record<StructureType, number> = { extractor: ECONOMY.extractorCost, harvester: ECONOMY.harvesterCost };
export const STRUCTURE_MAX_HP: Record<StructureType, number> = { extractor: STRUCTURE.extractorHealth, harvester: STRUCTURE.harvesterHealth };
export const STRUCTURE_LABEL: Record<StructureType, string> = { extractor: 'Extractor', harvester: 'Harvester' };

export const isStructureType = (v: unknown): v is StructureType => v === 'extractor' || v === 'harvester';

export function createEconomy(): EconomyState {
  return {
    teams: [
      { resources: ECONOMY.startingResources, earned: 0, spent: 0 },
      { resources: ECONOMY.startingResources, earned: 0, spent: 0 },
    ],
    structures: [],
    nextId: 1,
  };
}

export const findNode = (id: string): ResourceNode | undefined => RESOURCE_NODES.find((n) => n.id === id);

export function nodeOccupant(e: EconomyState, nodeId: string): Structure | undefined {
  return e.structures.find((s) => s.nodeId === nodeId);
}

/** Faction whose *active* structure sits on the node, or null (telemetry: "who controls the node"). */
export function nodeController(e: EconomyState, nodeId: string): Faction | null {
  const s = nodeOccupant(e, nodeId);
  return s && s.state === StructureState.Active ? s.faction : null;
}

/** Validate the economic half of a build (node, occupancy, cost, match phase). Role/reach are the server's. */
export function validateBuild(e: EconomyState, req: BuildRequest, phase: MatchPhase): BuildRejectReason | null {
  if (!req || !isStructureType(req.structure) || typeof req.resourceNodeId !== 'string') return 'malformed';
  if (phase !== 'playing') return 'wrong-phase';
  if (!findNode(req.resourceNodeId)) return 'invalid-node';
  if (nodeOccupant(e, req.resourceNodeId)) return 'node-occupied';
  if (e.teams[STRUCTURE_FACTION[req.structure]].resources < STRUCTURE_COST[req.structure]) return 'insufficient-resources';
  return null;
}

/** Place a structure (caller has validated). Deducts cost; construction starts immediately. */
export function placeStructure(e: EconomyState, type: StructureType, nodeId: string, builderId: string): Structure {
  const node = findNode(nodeId);
  if (!node) throw new Error(`unknown node ${nodeId}`);
  const faction = STRUCTURE_FACTION[type];
  const cost = STRUCTURE_COST[type];
  e.teams[faction].resources -= cost;
  e.teams[faction].spent += cost;
  const maxHp = STRUCTURE_MAX_HP[type];
  const s: Structure = {
    id: `${type}-${e.nextId++}`,
    type,
    faction,
    nodeId,
    x: node.x,
    y: node.y,
    z: node.z,
    hp: maxHp * STRUCTURE.buildStartHealthFrac,
    maxHp,
    state: StructureState.Building,
    buildTicks: 0,
    builderId,
  };
  e.structures.push(s);
  return s;
}

export interface EconomyStepResult {
  completed: Structure[];
}

/** One fixed tick: advance construction (health grows with progress) and pay income for active structures. */
export function stepEconomy(e: EconomyState, out: EconomyStepResult = { completed: [] }): EconomyStepResult {
  out.completed.length = 0;
  const growth = (1 - STRUCTURE.buildStartHealthFrac) / BUILD_TICKS;
  for (const s of e.structures) {
    if (s.state === StructureState.Building) {
      s.buildTicks++;
      s.hp = Math.min(s.maxHp, s.hp + s.maxHp * growth);
      if (s.buildTicks >= BUILD_TICKS) {
        s.state = StructureState.Active;
        out.completed.push(s);
      }
    } else {
      const t = e.teams[s.faction];
      t.resources += INCOME_PER_TICK;
      t.earned += INCOME_PER_TICK;
    }
  }
  return out;
}

export function incomePerSec(e: EconomyState, f: Faction): number {
  let n = 0;
  for (const s of e.structures) if (s.faction === f && s.state === StructureState.Active) n++;
  return n * ECONOMY.structureIncomePerSec;
}

export const buildProgress = (s: Structure): number => (s.state === StructureState.Active ? 1 : Math.min(1, s.buildTicks / BUILD_TICKS));

/** Apply damage; removes the structure (freeing its node) when destroyed. Returns damage actually dealt. */
export function damageStructure(e: EconomyState, s: Structure, dmg: number): { dealt: number; destroyed: boolean } {
  if (dmg <= 0 || s.hp <= 0) return { dealt: 0, destroyed: false };
  const dealt = Math.min(s.hp, dmg);
  s.hp -= dealt;
  if (s.hp <= 0) {
    s.hp = 0;
    const i = e.structures.indexOf(s);
    if (i >= 0) e.structures.splice(i, 1);
    return { dealt, destroyed: true };
  }
  return { dealt, destroyed: false };
}

/** Heal up to max (a building structure can only be healed up to its current construction ceiling). */
export function healStructure(s: Structure, amount: number): number {
  const ceiling = s.state === StructureState.Active ? s.maxHp : s.maxHp * (STRUCTURE.buildStartHealthFrac + (1 - STRUCTURE.buildStartHealthFrac) * buildProgress(s));
  const healed = Math.max(0, Math.min(amount, ceiling - s.hp));
  s.hp += healed;
  return healed;
}

/** Hurt box (server-side hit tests only): an AABB around the well head the structure is built on. */
export function structureHurtBox(s: { x: number; z: number }): { min: Vec3; max: Vec3 } {
  const h = STRUCTURE.hurtHalf;
  return { min: { x: s.x - h, y: 0, z: s.z - h }, max: { x: s.x + h, y: STRUCTURE.hurtHeight, z: s.z + h } };
}
