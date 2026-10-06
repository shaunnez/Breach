import { useEffect, useState } from 'react';
import { CLASS_LABELS, ECONOMY, MATCH, PlayerClass, STRUCTURE_COST, WEAVER, maxHealthOf } from '@breach/shared';
import { session } from '../app/session';
import { useStore } from '../app/store';

const SOFT_TIMER_SEC = 600;

export function Hud() {
  const hud = useStore((s) => s.hud);
  const notice = useStore((s) => s.notice);
  const killFeed = useStore((s) => s.killFeed);
  const scoreboard = useStore((s) => s.scoreboard);
  const match = useStore((s) => s.match);
  const me = useStore((s) => s.sessionId);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 100);
    return () => clearInterval(t);
  }, []);
  const now = performance.now();
  const ripper = hud.cls === PlayerClass.Ripper;
  const weaver = hud.cls === PlayerClass.Weaver;
  const alien = hud.cls !== PlayerClass.Marine;
  const amHost = match?.hostId === me;
  const elapsed = match ? Math.max(0, (session.net.clock.serverNow(now) - match.matchStartMs) / 1000) : 0;
  const remaining = Math.max(0, SOFT_TIMER_SEC - elapsed);
  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(Math.floor(remaining % 60)).padStart(2, '0');
  const hitAge = now - hud.hitMarkerAt;
  const flashAge = now - hud.damageFlashAt;
  const spreadPx = 6 + hud.spread * 14;

  return (
    <div className="hud">
      {hud.alive && match?.phase === 'playing' && <StrategyPanel />}
      {hud.alive && hud.commanding && <CommanderPanel />}
      {hud.alive && !hud.commanding && (
        <>
          <div className={`vignette ${flashAge < 300 ? 'on' : ''}`} style={{ opacity: flashAge < 300 ? 1 - flashAge / 300 : 0 }} />
          {hud.damageDirs.map((d) => (
            <div key={d.at} className="dmgdir" style={{ transform: `rotate(${(-d.angle * 180) / Math.PI}deg)`, opacity: Math.max(0, 1 - (now - d.at) / 1200) }} />
          ))}
          <div className={`crosshair ${alien ? 'ripper' : 'marine'}`}>
            {!alien ? (
              <>
                <i style={{ transform: `translate(-50%, calc(-50% - ${spreadPx}px))` }} />
                <i style={{ transform: `translate(-50%, calc(-50% + ${spreadPx}px))` }} />
                <i className="h" style={{ transform: `translate(calc(-50% - ${spreadPx}px), -50%)` }} />
                <i className="h" style={{ transform: `translate(calc(-50% + ${spreadPx}px), -50%)` }} />
              </>
            ) : (
              <b />
            )}
            {hitAge < 220 && hud.hitKind && <span className={`hitmarker ${hud.hitKind}`} style={{ opacity: 1 - hitAge / 220 }} />}
          </div>

          <div className="stats left">
            <div className="bar health">
              <span style={{ width: `${(hud.health / maxHealthOf(hud.cls)) * 100}%` }} />
              <label>HP {hud.health}</label>
            </div>
            {!alien && (
              <div className="bar armour">
                <span style={{ width: `${(hud.armour / 50) * 100}%` }} />
                <label>ARMOUR {hud.armour}</label>
              </div>
            )}
            {ripper && (
              <div className={`bar energy ${hud.leapReady ? 'ready' : ''}`}>
                <span style={{ width: `${hud.energy}%` }} />
                <label>ENERGY {Math.floor(hud.energy)} {hud.leapReady ? '· LEAP' : ''}</label>
              </div>
            )}
            {weaver && (
              <div className={`bar energy ${hud.energy >= WEAVER.healPulseCost ? 'ready' : ''}`}>
                <span style={{ width: `${hud.energy}%` }} />
                <label>ENERGY {Math.floor(hud.energy)} {hud.energy >= WEAVER.healPulseCost ? '· RMB HEAL' : ''}</label>
              </div>
            )}
            {hud.protected && <div className="shield">SPAWN PROTECTION — attacking cancels it</div>}
          </div>
          <div className="stats right">
            {weaver ? (
              <div className="surface">WEAVER · LMB claw · RMB heal pulse ({WEAVER.healPulseCost})</div>
            ) : !ripper ? (
              <>
                <div className="ammo">
                  {hud.ammo}
                  <small> / {hud.reserve}</small>
                </div>
                {hud.reloading > 0 && (
                  <div className="reload">
                    <span style={{ width: `${hud.reloading * 100}%` }} />
                  </div>
                )}
                {hud.ammo === 0 && hud.reserve === 0 && <div className="warnline">NO AMMO</div>}
              </>
            ) : (
              <div className="surface">{['GROUND', 'WALL', 'CEILING', 'AIR'][hud.surface]} · {hud.speed.toFixed(1)} m/s</div>
            )}
          </div>
        </>
      )}

      {!hud.alive && match?.phase === 'playing' && (
        <div className="respawn" data-testid="respawn">
          <div className="big">ELIMINATED</div>
          <div>Respawn in {hud.respawnIn.toFixed(1)}s</div>
          <div className="sub">{MATCH.respawnSec}s respawn · {MATCH.spawnProtectionSec}s protection</div>
          <div className="sub">Press 1 = Marine · 2 = Ripper · 3 = Weaver to change class on your next spawn</div>
        </div>
      )}

      {hud.alive && !hud.locked && !hud.commanding && (
        <div className="pause" onClick={() => session.runtime?.requestLock()} data-testid="clickplay">
          <div className="big">CLICK TO PLAY</div>
          <div className="sub">Mouse capture needed · Esc to release · Tab for scoreboard</div>
        </div>
      )}

      <div className="topbar">
        <span className="timer" title="Soft playtest timer, not a game rule">⏱ {mm}:{ss}</span>
        <span className="room">Room {match?.roomCode}</span>
        <span className="rtt">{Math.round(hud.rtt)} ms</span>
      </div>

      <div className="killfeed">
        {killFeed.map((k) => (
          <div key={k.id} className={k.mine ? 'mine' : ''}>
            {k.text}
          </div>
        ))}
      </div>

      {notice && now - notice.at < 3500 && <div className="notice">{notice.text}</div>}
      {scoreboard && <Scoreboard />}
      {amHost && scoreboard && (
        <div className="hostbar">
          <button onClick={() => session.net.resetMatch()}>Reset match (host)</button>
          <button onClick={() => void session.leave()}>Leave</button>
        </div>
      )}
    </div>
  );
}

function Scoreboard() {
  const match = useStore((s) => s.match);
  const me = useStore((s) => s.sessionId);
  if (!match) return null;
  const rows = [...match.players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  return (
    <div className="scoreboard" data-testid="scoreboard">
      <table>
        <thead>
          <tr>
            <th>Player</th>
            <th>Side</th>
            <th>Kills</th>
            <th>Deaths</th>
            <th>Damage</th>
            <th>RTT</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className={p.id === me ? 'me' : ''}>
              <td>
                {p.name}
                {p.dummy ? ' (dummy)' : ''} {!p.connected && <em className="warn">reconnecting</em>}
              </td>
              <td className={p.sim.cls === PlayerClass.Marine ? 'marine' : 'ripper'}>
                {CLASS_LABELS[p.sim.cls]}
                {p.commanding ? ' (Commander)' : ''}
              </td>
              <td>{p.kills}</td>
              <td>{p.deaths}</td>
              <td>{p.damage}</td>
              <td>{p.dummy ? '—' : `${p.rttMs} ms`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** VS02: team resources, the well's state and contextual prompts. */
function StrategyPanel() {
  const hud = useStore((s) => s.hud);
  const exp = hud.faction === 0;
  const w = hud.well;
  const own = w && w.faction === hud.faction;
  return (
    <>
      <div className={`econ ${exp ? 'marine' : 'ripper'}`} data-testid="econ">
        <div className="res">
          <b data-testid="resources">{Math.floor(hud.resources)}</b> <small>resources</small>
        </div>
        <div className="inc">
          +{hud.income.toFixed(1)}/s <small>· enemy +{hud.enemyIncome.toFixed(1)}/s</small>
        </div>
        <div className={`well ${w ? (own ? 'own' : 'enemy') : 'free'}`} data-testid="well">
          {w ? (
            <>
              WELL · {own ? 'ours' : 'enemy'} {w.label} {Math.round(w.hp)}/{w.maxHp}
              {!w.active && ` · building ${Math.round(w.progress * 100)}%`}
            </>
          ) : (
            <>WELL · unclaimed ({exp ? `Extractor ${STRUCTURE_COST.extractor}` : `Harvester ${STRUCTURE_COST.harvester}`})</>
          )}
        </div>
        {exp && <div className="cmdr">{hud.commanderName ? `Commander: ${hud.commanderName}` : 'No Commander: a Marine can take the Command Core (spawn console)'}</div>}
      </div>
      {hud.orderText && <div className="order">{hud.orderText}</div>}
      {hud.prompt && (
        <div className="prompt" data-testid="prompt">
          {hud.prompt}
        </div>
      )}
    </>
  );
}

function CommanderPanel() {
  const hud = useStore((s) => s.hud);
  const afford = hud.resources >= STRUCTURE_COST.extractor;
  return (
    <div className="commander" data-testid="commander">
      <div className="row">
        <span className="title">COMMAND</span>
        <button className={hud.buildMode ? 'primary' : ''} disabled={!afford} onClick={() => session.runtime?.setBuildMode(!hud.buildMode)} data-testid="build-extractor">
          {hud.buildMode ? 'Click the well…' : `Extractor (${STRUCTURE_COST.extractor}) · B`}
        </button>
        <button onClick={() => session.net.command('exit')} data-testid="leave-command">
          Leave · E
        </button>
      </div>
      <div className="sub help">
        WASD pan · wheel/Q/Z zoom · LMB select Marines (shift adds) · RMB {hud.selected ? `move ${hud.selected} selected` : 'ping'} · build {ECONOMY.structureBuildSec}s, +
        {ECONOMY.structureIncomePerSec}/s · your body stays at the console and can be killed
      </div>
    </div>
  );
}
