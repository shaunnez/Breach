import { DEV_ROOMS } from '@breach/shared';
import { session } from '../app/session';
import { DEBUG_TOGGLES, type DebugToggle } from '../game/bootstrap/GameRuntime';
import { useStore } from '../app/store';

export function DebugPanel() {
  const d = useStore((s) => s.debug);
  if (!d) return <div className="debug hint">F3 / ` : debug overlay</div>;
  const rt = session.runtime;
  const row = (k: string, v: string | number, warn = false) => (
    <div className={`kv ${warn ? 'warn' : ''}`} key={k}>
      <span>{k}</span>
      <b>{typeof v === 'number' ? v.toFixed(v % 1 === 0 ? 0 : 2) : v}</b>
    </div>
  );
  return (
    <div className="debug" data-testid="debug">
      <h4>NET / SIM</h4>
      {row('FPS', d.fps, d.fps < 55)}
      {row('frame ms (max)', `${d.frameMs.toFixed(1)} (${d.frameMsMax.toFixed(1)})`, d.frameMsMax > 16.7)}
      {row('draw calls', d.drawCalls)}
      {row('server tick', d.serverTick)}
      {row('tick drift (ms)', d.tickDriftMs.toFixed(1))}
      {row('RTT / jitter ms', `${d.rttMs.toFixed(0)} / ${d.jitterMs.toFixed(0)}`, d.rttMs > 150)}
      {row('patches/s', d.patchesPerSec.toFixed(1))}
      {row('input seq / ack / unacked', `${d.inputSeq} / ${d.lastAck} / ${d.unacked}`)}
      {row('pred error (m) last / max', `${d.predErrM.toFixed(4)} / ${d.predErrMaxM.toFixed(3)}`, d.predErrM > 0.05)}
      {row('reconciliations /s (total)', `${d.reconPerSec.toFixed(1)} (${d.reconTotal})`, d.reconPerSec > 2)}
      {row('ripper surface breaks', d.surfaceBreaks, d.surfaceBreaks > 0)}
      {row('smoothing offset (m)', d.correctionM.toFixed(3))}
      <h4>PLAYER</h4>
      {row('velocity m/s', d.speed.toFixed(2))}
      {row('surface', d.surface)}
      {row('normal', d.normal)}
      {row('last shot / bite', d.lastShot)}
      <h4>ECONOMY (server)</h4>
      {row('resources exp / bloom', `${d.econ.resExp.toFixed(1)} / ${d.econ.resBloom.toFixed(1)}`)}
      {row('income/s exp / bloom', `${d.econ.incExp.toFixed(1)} / ${d.econ.incBloom.toFixed(1)}`)}
      {row('commander', d.econ.commander)}
      {d.econ.structures.length ? d.econ.structures.map((t, i) => row(`structure ${i + 1}`, t)) : row('structures', 'none')}
      {row('last build', d.econ.lastBuild)}
      <h4>TOGGLES</h4>
      <div className="toggles">
        {DEBUG_TOGGLES.map((t: DebugToggle) => (
          <label key={t}>
            <input type="checkbox" checked={d.toggles[t]} onChange={(e) => rt?.setToggle(t, e.target.checked)} /> {t}
          </label>
        ))}
        <label>
          <input type="checkbox" checked={d.viewAssist} onChange={(e) => rt?.setViewAssist(e.target.checked)} /> ripper view assist (V)
        </label>
      </div>
      <h4>SIMULATED LATENCY (local)</h4>
      <div className="sliders">
        <label>
          RTT {d.simLagMs} ms
          <input type="range" min={0} max={300} step={10} value={d.simLagMs} onChange={(e) => rt?.setSimLatency(Number(e.target.value), d.simJitterMs)} />
        </label>
        <label>
          jitter ±{d.simJitterMs} ms
          <input type="range" min={0} max={60} step={5} value={d.simJitterMs} onChange={(e) => rt?.setSimLatency(d.simLagMs, Number(e.target.value))} />
        </label>
      </div>
      <h4>DEV ACTIONS</h4>
      <div className="actions">
        {DEV_ROOMS.map((r) => (
          <button key={r} onClick={() => session.net.dev({ action: 'teleport', room: r })}>
            → {r}
          </button>
        ))}
        <button onClick={() => session.net.dev({ action: 'switchClass', cls: 0 })}>become Marine</button>
        <button onClick={() => session.net.dev({ action: 'switchClass', cls: 1 })}>become Ripper</button>
        <button onClick={() => session.net.dev({ action: 'switchClass', cls: 2 })}>become Weaver</button>
        <button onClick={() => session.net.dev({ action: 'grantResources', amount: 20 })}>+20 resources (both)</button>
        <button onClick={() => session.net.dev({ action: 'spawnDummy', cls: 2 })}>+ weaver dummy</button>
        <button onClick={() => session.net.dev({ action: 'refill' })}>refill</button>
        <button onClick={() => session.net.dev({ action: 'spawnDummy', cls: 1 })}>+ ripper dummy</button>
        <button onClick={() => session.net.dev({ action: 'spawnDummy', cls: 0 })}>+ marine dummy</button>
        <button onClick={() => session.net.dev({ action: 'clearDummies' })}>clear dummies</button>
        <button onClick={() => session.net.dev({ action: 'reset' })}>reset room</button>
        <button onClick={() => session.net.dropConnection()}>drop connection</button>
      </div>
    </div>
  );
}
