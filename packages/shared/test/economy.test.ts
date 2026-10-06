import { describe, expect, it } from 'vitest';
import {
  BUILD_TICKS,
  ECONOMY,
  Faction,
  RESOURCE_NODES,
  STRUCTURE,
  StructureState,
  buildProgress,
  createEconomy,
  damageStructure,
  healStructure,
  incomePerSec,
  nodeController,
  placeStructure,
  rayAabb,
  stepEconomy,
  structureHurtBox,
  validateBuild,
  type BuildRequest,
} from '../src/index';

const WELL = RESOURCE_NODES[0].id;
const req = (structure: 'extractor' | 'harvester', node = WELL): BuildRequest => ({ requestId: 1, structure, resourceNodeId: node });

describe('economy baseline (bible section 32)', () => {
  it('starts both teams at 20 resources with one active well', () => {
    const e = createEconomy();
    expect(e.teams[Faction.Expedition].resources).toBe(20);
    expect(e.teams[Faction.Bloom].resources).toBe(20);
    expect(RESOURCE_NODES).toHaveLength(1);
    expect(ECONOMY).toEqual({ structureIncomePerSec: 0.6, extractorCost: 10, harvesterCost: 10, startingResources: 20, structureBuildSec: 6 });
  });

  it('validates node, occupancy, funds and phase', () => {
    const e = createEconomy();
    expect(validateBuild(e, req('extractor'), 'warmup')).toBe('wrong-phase');
    expect(validateBuild(e, req('extractor', 'nope'), 'playing')).toBe('invalid-node');
    expect(validateBuild(e, { requestId: 1, structure: 'armoury' as never, resourceNodeId: WELL }, 'playing')).toBe('malformed');
    expect(validateBuild(e, req('extractor'), 'playing')).toBeNull();
    placeStructure(e, 'extractor', WELL, 'cmd');
    expect(e.teams[Faction.Expedition].resources).toBe(10);
    expect(validateBuild(e, req('harvester'), 'playing')).toBe('node-occupied');
    expect(validateBuild(e, req('extractor'), 'playing')).toBe('node-occupied');
    const poor = createEconomy();
    poor.teams[Faction.Bloom].resources = 9.99;
    expect(validateBuild(poor, req('harvester'), 'playing')).toBe('insufficient-resources');
  });

  it('builds in exactly 6 s, health grows from 25 % to full, then pays 0.6/s', () => {
    const e = createEconomy();
    const s = placeStructure(e, 'harvester', WELL, 'w');
    expect(s.faction).toBe(Faction.Bloom);
    expect(s.hp).toBeCloseTo(STRUCTURE.harvesterHealth * 0.25);
    for (let i = 0; i < BUILD_TICKS - 1; i++) stepEconomy(e);
    expect(s.state).toBe(StructureState.Building);
    expect(nodeController(e, WELL)).toBeNull();
    expect(incomePerSec(e, Faction.Bloom)).toBe(0);
    const r = stepEconomy(e);
    expect(r.completed).toEqual([s]);
    expect(BUILD_TICKS).toBe(360);
    expect(s.hp).toBeCloseTo(s.maxHp);
    expect(buildProgress(s)).toBe(1);
    expect(nodeController(e, WELL)).toBe(Faction.Bloom);
    expect(incomePerSec(e, Faction.Bloom)).toBeCloseTo(0.6);
    const before = e.teams[Faction.Bloom].resources;
    for (let i = 0; i < 600; i++) stepEconomy(e); // 10 s
    expect(e.teams[Faction.Bloom].resources - before).toBeCloseTo(6, 6);
    expect(e.teams[Faction.Expedition].resources).toBe(20); // no structure, no income
  });

  it('destroying a structure frees the node; healing never exceeds the construction ceiling', () => {
    const e = createEconomy();
    const s = placeStructure(e, 'extractor', WELL, 'c');
    for (let i = 0; i < BUILD_TICKS / 2; i++) stepEconomy(e);
    const hpMid = s.hp;
    expect(healStructure(s, 1000)).toBeCloseTo(0); // already on its ceiling mid-build
    damageStructure(e, s, 100);
    expect(healStructure(s, 1000)).toBeCloseTo(100);
    expect(s.hp).toBeCloseTo(hpMid);
    const r = damageStructure(e, s, 10_000);
    expect(r.destroyed).toBe(true);
    expect(r.dealt).toBeCloseTo(hpMid);
    expect(e.structures).toHaveLength(0);
    expect(validateBuild(e, req('harvester'), 'playing')).toBeNull();
  });

  it('structure hurt box surrounds the well head and is ray-hittable', () => {
    const n = RESOURCE_NODES[0];
    const b = structureHurtBox(n);
    const t = rayAabb({ x: 24.5, y: 1.2, z: n.z }, { x: 1, y: 0, z: 0 }, b.min, b.max, 50);
    expect(t).toBeCloseTo(n.x - STRUCTURE.hurtHalf - 24.5);
    expect(rayAabb({ x: 24.5, y: 3.5, z: n.z }, { x: 1, y: 0, z: 0 }, b.min, b.max, 50)).toBeNull();
  });
});
