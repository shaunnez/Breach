import { useEffect, useState } from 'react';
import { MATCH, PlayerClass, RIPPER } from '@breach/shared';
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
      {hud.alive && (
        <>
          <div className={`vignette ${flashAge < 300 ? 'on' : ''}`} style={{ opacity: flashAge < 300 ? 1 - flashAge / 300 : 0 }} />
          {hud.damageDirs.map((d) => (
            <div key={d.at} className="dmgdir" style={{ transform: `rotate(${(-d.angle * 180) / Math.PI}deg)`, opacity: Math.max(0, 1 - (now - d.at) / 1200) }} />
          ))}
          <div className={`crosshair ${ripper ? 'ripper' : 'marine'}`}>
            {!ripper ? (
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
              <span style={{ width: `${(hud.health / (ripper ? RIPPER.health : 100)) * 100}%` }} />
              <label>HP {hud.health}</label>
            </div>
            {!ripper && (
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
            {hud.protected && <div className="shield">SPAWN PROTECTION — attacking cancels it</div>}
          </div>
          <div className="stats right">
            {!ripper ? (
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
        </div>
      )}

      {hud.alive && !hud.locked && (
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
              <td className={p.sim.cls === PlayerClass.Marine ? 'marine' : 'ripper'}>{p.sim.cls === PlayerClass.Marine ? 'Marine' : 'Ripper'}</td>
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
