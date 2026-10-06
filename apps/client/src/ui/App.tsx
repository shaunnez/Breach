import { useEffect, useState } from 'react';
import { CLASS_LABELS, ECONOMY, Faction, PlayerClass, MATCH, NET, factionOf } from '@breach/shared';
import { session } from '../app/session';
import { setState, useStore } from '../app/store';
import { GameScreen } from './GameScreen';

export function App() {
  const screen = useStore((s) => s.screen);
  useEffect(() => {
    void session.resume();
  }, []);
  return (
    <>
      {screen === 'landing' && <Landing />}
      {screen === 'lobby' && <Lobby />}
      {screen === 'game' && <GameScreen />}
      <ConnectionBanner />
    </>
  );
}

function ConnectionBanner() {
  const status = useStore((s) => s.status);
  const reason = useStore((s) => s.statusReason);
  if (status !== 'reconnecting') return null;
  return (
    <div className="conn-banner" role="status">
      <div className="spinner" /> Reconnecting… {reason} <small>(seat held for {NET.reconnectSeatHoldMs / 1000}s)</small>
    </div>
  );
}

function Landing() {
  const name = useStore((s) => s.name);
  const code = useStore((s) => s.roomCode);
  const error = useStore((s) => s.error);
  const busy = useStore((s) => s.busy);
  const dev = useStore((s) => s.dev);
  return (
    <main className="landing">
      <h1>
        BREACH<span>//</span>HIVE
      </h1>
      <p className="tag">Strategy Truth Slice · Expedition versus Bloom · hold the resource well · 2–4 players</p>
      <section className="card">
        <label>
          Callsign
          <input value={name} maxLength={20} onChange={(e) => setState({ name: e.target.value })} data-testid="name" />
        </label>
        <div className="row">
          <button className="primary" disabled={busy} onClick={() => void session.create()} data-testid="create">
            Create room
          </button>
        </div>
        <div className="or">or join with a code</div>
        <div className="row">
          <input
            className="code"
            placeholder="ABC123"
            maxLength={6}
            value={code}
            onChange={(e) => setState({ roomCode: e.target.value.toUpperCase() })}
            onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && void session.join(code)}
            data-testid="code"
          />
          <button disabled={busy || code.length !== 6} onClick={() => void session.join(code)} data-testid="join">
            Join
          </button>
        </div>
        {error && (
          <div className="error" role="alert" data-testid="error">
            {error}
          </div>
        )}
      </section>
      <section className="controls">
        <h3>Controls</h3>
        <ul>
          <li>
            <b>WASD</b> move · <b>Mouse</b> look · <b>Click</b> to capture the mouse · <b>Tab</b> scoreboard
          </li>
          <li>
            <b>Marine:</b> LMB fire · R reload · Shift sprint · Space jump
          </li>
          <li>
            <b>Commander:</b> a Marine presses E at the spawn console · overhead view · B place Extractor on the well ({ECONOMY.extractorCost}) · RMB order/ping
          </li>
          <li>
            <b>Weaver:</b> LMB claw · RMB heal pulse · E at the well grows a Harvester ({ECONOMY.harvesterCost}) · slow, cannot climb
          </li>
          <li>
            <b>Ripper:</b> hold F to cling to walls/ceilings (T: hold/toggle) · LMB bite · Space leap (costs energy) · RMB/C let go · V toggle surface view assist
          </li>
        </ul>
        {dev && <p className="devnote">Dev mode ON: press ` (or F3), or click "debug overlay" top-left, for the debug panel.</p>}
      </section>
    </main>
  );
}

/** Full shareable URL: opening it joins the room directly (or just fills the code in if the room is full). */
export function inviteLink(code: string, dev: boolean): string {
  return `${location.origin}/play?room=${code}${dev ? '&dev=1' : ''}`;
}

function Lobby() {
  const [copied, setCopied] = useState(false);
  const copyInvite = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      window.prompt('Copy this invite link', link); // clipboard blocked (http / permissions): let the player copy it by hand
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const match = useStore((s) => s.match);
  const me = useStore((s) => s.sessionId);
  const dev = useStore((s) => s.dev);
  const notice = useStore((s) => s.notice);
  if (!match) return <div className="landing"><div className="spinner" /></div>;
  const players = [...match.players].filter((p) => !p.dummy).sort((a, b) => a.seat - b.seat);
  const amHost = match.hostId === me;
  const mine = players.find((p) => p.id === me);
  const side = (f: Faction) => players.filter((p) => factionOf(p.sim.cls) === f).length;
  const cap = Math.ceil(MATCH.maxPlayers / 2);
  const full = (c: PlayerClass) => side(factionOf(c)) >= cap && (!mine || factionOf(mine.sim.cls) !== factionOf(c));
  const link = inviteLink(match.roomCode, match.dev);
  const bloom = !!mine && factionOf(mine.sim.cls) === Faction.Bloom;
  return (
    <main className="landing lobby">
      <h1>
        BREACH<span>//</span>HIVE
      </h1>
      <section className="card">
        <div className="roomcode">
          <small>Room code</small>
          <strong data-testid="roomcode">{match.roomCode}</strong>
          <button onClick={() => void copyInvite(link)} data-testid="copy-invite">
            {copied ? 'Copied!' : 'Copy invite link'}
          </button>
        </div>
        <table className="players">
          <thead>
            <tr>
              <th>Player</th>
              <th>Side</th>
              <th>RTT</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr key={p.id} className={p.id === me ? 'me' : ''}>
                <td>
                  {p.name} {p.host && <em>host</em>} {!p.connected && <em className="warn">reconnecting</em>}
                </td>
                <td className={p.sim.cls === PlayerClass.Marine ? 'marine' : 'ripper'}>
                  {p.sim.cls === PlayerClass.Marine ? 'Expedition' : 'Bloom'} {CLASS_LABELS[p.sim.cls]}
                </td>
                <td>{p.rttMs ? `${p.rttMs} ms` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row">
          <button className={mine && !bloom ? 'primary marine' : 'marine'} disabled={full(PlayerClass.Marine)} onClick={() => session.setClass(PlayerClass.Marine)} data-testid="pick-marine">
            Marine · Expedition {side(Faction.Expedition)}/{cap}
          </button>
          <button className={bloom ? 'primary ripper' : 'ripper'} disabled={full(PlayerClass.Ripper)} onClick={() => !bloom && session.setClass(PlayerClass.Ripper)} data-testid="pick-hive">
            Hive · Bloom {side(Faction.Bloom)}/{cap}
          </button>
        </div>
        <p className="hint dim">Hive players start as Rippers and can change to a Weaver (3) or back (2) while standing in the Hive.</p>
        <div className="row">
        </div>
        <div className="row">
          {amHost ? (
            <button className="primary big" disabled={players.length < 2} onClick={() => session.net.start()} data-testid="start">
              {players.length < 2 ? 'Waiting for a second player…' : 'Start match'}
            </button>
          ) : (
            <div className="wait">Waiting for the host to start…</div>
          )}
          <button onClick={() => void session.leave()}>Leave</button>
        </div>
        {side(Faction.Expedition) === 0 || side(Faction.Bloom) === 0 ? <p className="hint">Tip: pick opposite sides. Win fights to hold the resource well.</p> : null}
        {notice && performance.now() - notice.at < 4000 && <div className="error">{notice.text}</div>}
        {dev && <p className="devnote">Dev room: debug tools enabled (F3 in match).</p>}
      </section>
    </main>
  );
}
