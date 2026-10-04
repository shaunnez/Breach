import { useEffect, useRef } from 'react';
import { session } from '../app/session';
import { GameRuntime } from '../game/bootstrap/GameRuntime';
import { Hud } from './Hud';
import { DebugPanel } from './DebugPanel';
import { useStore } from '../app/store';

export function GameScreen() {
  const ref = useRef<HTMLCanvasElement>(null);
  const dev = useStore((s) => s.dev);
  useEffect(() => {
    const canvas = ref.current!;
    const rt = new GameRuntime(canvas, session.net, dev);
    session.runtime = rt;
    if (session.net.lastMatch) rt.onMatch(session.net.lastMatch);
    rt.start();
    return () => {
      if (session.runtime === rt) session.runtime = null;
      rt.stop();
    };
  }, [dev]);
  return (
    <div className="game">
      <canvas ref={ref} className="viewport" data-testid="viewport" onClick={() => session.runtime?.requestLock()} />
      <Hud />
      {dev && <DebugPanel />}
    </div>
  );
}
