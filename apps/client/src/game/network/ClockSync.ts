/**
 * Estimates server time (the server's tick-based clock, ms) from ping/pong exchanges.
 * offset = serverTime - clientTime; lower-RTT samples are trusted more.
 */
export class ClockSync {
  offset = 0;
  rtt = 0;
  jitter = 0;
  samples = 0;
  private lastRtt = 0;
  private bestRtt = Infinity;

  addSample(clientSentMs: number, clientRecvMs: number, serverMs: number): void {
    const rtt = Math.max(0, clientRecvMs - clientSentMs);
    const off = serverMs + rtt / 2 - clientRecvMs;
    this.samples++;
    if (this.samples === 1) {
      this.rtt = rtt;
      this.offset = off;
      this.bestRtt = rtt;
    } else {
      this.jitter = this.jitter * 0.8 + Math.abs(rtt - this.lastRtt) * 0.2;
      this.rtt = this.rtt * 0.8 + rtt * 0.2;
      this.bestRtt = Math.min(this.bestRtt * 1.02 + 0.2, rtt); // slowly forget old minimum
      const w = rtt <= this.bestRtt + 8 ? 0.3 : 0.05;
      this.offset += (off - this.offset) * w;
    }
    this.lastRtt = rtt;
  }

  serverNow(clientNowMs: number): number {
    return clientNowMs + this.offset;
  }
}
