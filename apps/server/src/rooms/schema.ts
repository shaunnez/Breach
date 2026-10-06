import { MapSchema, Schema, type } from '@colyseus/schema';

/**
 * Replicated state. Per-player movement/weapon fields mirror shared PlayerSim exactly so the owning
 * client can re-simulate unacknowledged inputs from any snapshot (reconciliation).
 */
export class PlayerSchema extends Schema {
  @type('string') id = '';
  @type('string') name = '';
  @type('uint8') seat = 0;
  @type('uint8') cls = 0; // PlayerClass
  @type('uint8') faction = 0;
  @type('boolean') connected = true;
  @type('boolean') host = false;
  @type('boolean') dummy = false;
  @type('boolean') alive = false;
  @type('boolean') protected = false;
  @type('uint16') epoch = 0;

  // transform
  @type('float32') px = 0;
  @type('float32') py = 0;
  @type('float32') pz = 0;
  @type('float32') yaw = 0;
  @type('float32') pitch = 0;
  // movement state
  @type('float32') vx = 0;
  @type('float32') vy = 0;
  @type('float32') vz = 0;
  @type('float32') nx = 0;
  @type('float32') ny = 1;
  @type('float32') nz = 0;
  @type('uint8') surface = 0;
  @type('float32') detachT = 0;
  @type('float32') lockT = 0;
  @type('float32') leapCd = 0;
  @type('float32') energy = 0;
  @type('float32') energyIdle = 0;
  @type('uint8') prevJump = 0;
  @type('uint8') prevReload = 0;
  @type('uint8') sprinting = 0;
  // weapon
  @type('uint16') ammo = 0;
  @type('uint16') reserve = 0;
  @type('uint16') reloadTicks = 0;
  @type('uint16') fireCdTicks = 0;
  @type('uint16') biteCdTicks = 0;
  @type('float32') bloom = 0;
  @type('uint16') bloomIdleTicks = 0;
  @type('uint32') shotCount = 0;
  @type('uint32') seed = 0;

  // rules (server only on the wire as read-only state)
  @type('uint16') health = 0;
  @type('uint16') armour = 0;
  @type('uint32') lastProcessedInputSeq = 0;
  @type('float64') respawnAtMs = 0;
  @type('uint16') kills = 0;
  @type('uint16') deaths = 0;
  @type('uint32') damage = 0;
  @type('uint16') rttMs = 0;
  @type('uint8') pendingCls = 255;
  // VS02
  @type('boolean') commanding = false;
  /** Commander waypoint for this Marine (orderUntilMs 0 = none) */
  @type('string') orderKind = '';
  @type('float32') orderX = 0;
  @type('float32') orderY = 0;
  @type('float32') orderZ = 0;
  @type('float64') orderUntilMs = 0;
}

/** VS02 structure (Extractor / Harvester) on a resource well. */
export class StructureSchema extends Schema {
  @type('string') id = '';
  @type('string') type = '';
  @type('uint8') faction = 0;
  @type('string') nodeId = '';
  @type('float32') x = 0;
  @type('float32') y = 0;
  @type('float32') z = 0;
  @type('float32') hp = 0;
  @type('uint16') maxHp = 0;
  @type('uint8') state = 0;
  @type('float32') progress = 0;
  @type('string') builderId = '';
}

export class MatchSchema extends Schema {
  @type('string') phase = 'warmup';
  @type('uint32') serverTick = 0;
  @type('float64') serverTimeMs = 0;
  @type('string') roomCode = '';
  @type('string') hostId = '';
  @type('string') matchId = '';
  @type('string') mapId = 'test-cell-a';
  @type('boolean') dev = false;
  @type('float64') matchStartMs = 0;
  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
  // VS02 economy (server state, replicated read-only)
  @type('string') commanderId = '';
  @type('float32') resExpedition = 0;
  @type('float32') resBloom = 0;
  @type('float32') incomeExpedition = 0;
  @type('float32') incomeBloom = 0;
  @type('string') pingKind = '';
  @type('float32') pingX = 0;
  @type('float32') pingY = 0;
  @type('float32') pingZ = 0;
  @type('float64') pingUntilMs = 0;
  @type({ map: StructureSchema }) structures = new MapSchema<StructureSchema>();
}
