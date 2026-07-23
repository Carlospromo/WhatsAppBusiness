export type PresenceSocket = {
  sendPresenceAvailable(): Promise<void>;
  sendPresenceUnavailable(): Promise<void>;
};

type PresenceState = {
  socket: PresenceSocket;
  activeCount: number;
  announced: "unknown" | "available" | "unavailable";
  timer?: ReturnType<typeof setTimeout>;
  transition: Promise<void>;
};

/** Keep the linked device hidden while it is idle, without disconnecting it. */
export class TransientPresenceManager {
  private readonly states = new Map<string, PresenceState>();

  constructor(
    private readonly idleMs = 3_000,
    private readonly onError: (accountId: string, error: unknown) => void = () => undefined,
  ) {}

  private stateFor(accountId: string, socket: PresenceSocket) {
    const existing = this.states.get(accountId);
    if (existing?.socket === socket) return existing;
    if (existing?.timer) clearTimeout(existing.timer);
    const state: PresenceState = { socket, activeCount: 0, announced: "unknown", transition: Promise.resolve() };
    this.states.set(accountId, state);
    return state;
  }

  private clearTimer(state: PresenceState) {
    if (state.timer) clearTimeout(state.timer);
    state.timer = undefined;
  }

  private update(accountId: string, state: PresenceState, type: "available" | "unavailable", force = false) {
    state.transition = state.transition.catch(() => undefined).then(async () => {
      if (!force && state.announced === type) return;
      try {
        if (type === "available") await state.socket.sendPresenceAvailable();
        else await state.socket.sendPresenceUnavailable();
        state.announced = type;
      } catch (error) {
        this.onError(accountId, error);
      }
    });
    return state.transition;
  }

  async markIdle(accountId: string, socket: PresenceSocket) {
    const state = this.stateFor(accountId, socket);
    this.clearTimer(state);
    if (state.activeCount === 0) await this.update(accountId, state, "unavailable", true);
  }

  async duringActivity<T>(accountId: string, socket: PresenceSocket, work: () => Promise<T>) {
    const state = this.stateFor(accountId, socket);
    this.clearTimer(state);
    state.activeCount += 1;
    await this.update(accountId, state, "available");
    try {
      return await work();
    } finally {
      state.activeCount -= 1;
      if (state.activeCount === 0) this.scheduleIdle(accountId, state);
    }
  }

  private scheduleIdle(accountId: string, state: PresenceState) {
    this.clearTimer(state);
    state.timer = setTimeout(() => {
      state.timer = undefined;
      if (state.activeCount === 0) void this.update(accountId, state, "unavailable");
    }, this.idleMs);
  }

  async dispose(accountId: string, socket?: PresenceSocket) {
    const state = this.states.get(accountId);
    if (!state || (socket && state.socket !== socket)) return;
    this.clearTimer(state);
    this.states.delete(accountId);
    await this.update(accountId, state, "unavailable");
  }
}
