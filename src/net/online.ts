export type OnlinePhase = 'idle' | 'waiting' | 'countdown' | 'combat' | 'roundEnd' | 'matchEnd'

export interface PeerSnapshot {
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  sliding: boolean
}

export interface RosterEntry {
  id: string
  team: number
  nick?: string
}

export interface RoomSummary {
  code: string
  host: string
  count: number
  cap: number
  teamSize: number
  mapId: string
  fillBots?: boolean
}

export interface LobbyInfo {
  code: string
  teamSize: number
  mapId: string
  fillBots?: boolean
  hostId: string
  you: string
  players: { id: string; team: number; ready: boolean; nick: string }[]
}

export interface RosterInfo {
  teamSize: number
  mapId: string
  difficulty?: string
  hostId: string
  you: string
  players: RosterEntry[]
  bots: RosterEntry[]
}

export interface RoundInfo {
  phase: OnlinePhase
  round: number
  scoreYou: number
  scoreEnemy: number
  /** Server-authoritative HP per entity id. */
  hps: Record<string, number>
  youWon?: boolean
  draw?: boolean
}

export interface OnlineCallbacks {
  onCreated: (code: string) => void
  onLobby: (info: LobbyInfo) => void
  onRoster: (info: RosterInfo) => void
  onRound: (info: RoundInfo) => void
  onHp: (id: string, hp: number) => void
  onPeerState: (id: string, snap: PeerSnapshot) => void
  onPeerFire: (id: string, weaponId: string) => void
  onPeerGrenade: (id: string, origin: [number, number, number], dir: [number, number, number]) => void
  onRoomList: (rooms: RoomSummary[]) => void
  onError: (reason: string) => void
  onDisconnect: (reason: string) => void
  /** Fired when a dropped connection starts trying to rejoin. */
  onReconnecting?: () => void
}

/** Default server URL. Local dev uses the standalone server on :8081; a
 * deployed build shares the page's origin (client + WebSocket are one service). */
export function defaultServerUrl(): string {
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  if (local) return 'ws://localhost:8081'
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}`
}

/** WebSocket client for online team matches: lobby handshake + plumbing. */
export class OnlineManager {
  phase: OnlinePhase = 'idle'
  code = ''
  nick = '플레이어'
  token = '' // slot secret for reclaiming the room after a drop
  private ws: WebSocket | null = null
  private url = ''
  private connectGen = 0 // bumped by leave() to abort an in-flight retry loop
  private connecting: Promise<void> | null = null // shared in-flight connect
  private intentionalClose = false // user left; don't auto-reconnect
  private reconnecting = false
  private pendingRejoin = false // a rejoin was sent, awaiting resume/rejection

  constructor(private cb: OnlineCallbacks) {}

  get active(): boolean {
    return this.phase !== 'idle'
  }

  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  /** True while fighters must not move or shoot (server-driven). */
  get frozen(): boolean {
    return this.active && this.phase !== 'combat'
  }

  private connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url)
      this.ws = ws
      // a cold dyno can accept TCP but stall the upgrade forever; time out so
      // the retry loop advances instead of hanging in CONNECTING
      const timer = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          try {
            ws.close()
          } catch {
            /* ignore */
          }
          reject(new Error('connect timeout'))
        }
      }, 8000)
      // ignore stale events if leave() replaced/cleared the socket meanwhile
      ws.onopen = () => {
        clearTimeout(timer)
        this.ws === ws ? resolve() : reject(new Error('cancelled'))
      }
      ws.onerror = () => {
        clearTimeout(timer)
        reject(new Error('connect failed'))
      }
      ws.onmessage = (e) => {
        if (this.ws === ws) this.handle(String(e.data))
      }
      ws.onclose = () => {
        if (this.ws !== ws) return
        this.ws = null
        if (this.phase === 'idle') return
        if (this.intentionalClose) {
          this.phase = 'idle'
          return
        }
        // unexpected drop mid-session → try to reclaim the slot within grace
        void this.reconnectLoop()
      }
    })
  }

  /** Reconnect after an unexpected drop and reclaim the slot with our token. */
  private async reconnectLoop() {
    if (this.reconnecting) return
    if (!this.code || !this.token) return this.finishDisconnect('connection-lost')
    this.reconnecting = true
    this.cb.onReconnecting?.()
    for (let i = 0; i < 6; i++) {
      if (this.intentionalClose) {
        this.reconnecting = false
        return
      }
      try {
        await this.connect(this.url)
        this.pendingRejoin = true
        this.send({ t: 'rejoin', code: this.code, token: this.token })
        this.reconnecting = false
        return // resume (roster/lobby) or rejection (error/roomClosed) arrives via handle()
      } catch {
        await new Promise((r) => setTimeout(r, 3000))
      }
    }
    this.reconnecting = false
    this.finishDisconnect('reconnect-failed')
  }

  private finishDisconnect(reason: string) {
    this.pendingRejoin = false
    this.phase = 'idle'
    const ws = this.ws
    this.ws = null
    ws?.close()
    this.cb.onDisconnect(reason)
  }

  /** Open (or reuse) a lobby connection for browsing rooms. */
  async browse(url: string, onWaking?: (attempt: number, max: number) => void) {
    this.url = url
    await this.ensure(onWaking)
    this.list()
  }

  /** Connect if needed. Concurrent callers share one in-flight retry loop so
   * impatient clicks during a cold start don't spawn dueling sockets. */
  private ensure(onWaking?: (attempt: number, max: number) => void): Promise<void> {
    if (this.connected) return Promise.resolve()
    if (this.connecting) return this.connecting
    const p = this.runConnect(onWaking)
    this.connecting = p
    // only clear if a newer connect hasn't replaced this one meanwhile
    p.catch(() => {}).finally(() => {
      if (this.connecting === p) this.connecting = null
    })
    return p
  }

  /** Connect, retrying while a free-tier server cold-starts (~30-50s). */
  private async runConnect(onWaking?: (attempt: number, max: number) => void) {
    const gen = this.connectGen
    const MAX_ATTEMPTS = 8
    // nudge the sleeping dyno awake over HTTP (best effort, no-cors).
    // fetch rejects asynchronously on network errors, so swallow via .catch
    fetch(this.url.replace(/^ws/, 'http'), { mode: 'no-cors', cache: 'no-store' }).catch(() => {})
    let lastErr: unknown
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (gen !== this.connectGen) throw new Error('cancelled') // leave() aborted us
      if (attempt > 1) {
        onWaking?.(attempt, MAX_ATTEMPTS)
        await new Promise((r) => setTimeout(r, 4000))
        if (gen !== this.connectGen) throw new Error('cancelled')
      }
      try {
        await this.connect(this.url)
        return
      } catch (e) {
        lastErr = e
      }
    }
    throw lastErr ?? new Error('connect failed')
  }

  list() {
    if (this.connected && this.phase === 'idle') this.send({ t: 'list' })
  }

  async create(
    url: string,
    teamSize: number,
    mapId: string,
    fillBots = true,
    difficulty = 'normal',
    onWaking?: (attempt: number, max: number) => void,
  ) {
    this.url = url
    this.intentionalClose = false
    await this.ensure(onWaking)
    this.phase = 'waiting'
    this.send({ t: 'create', teamSize, mapId, nick: this.nick, fillBots, difficulty })
  }

  async join(url: string, code: string, onWaking?: (attempt: number, max: number) => void) {
    this.url = url
    this.intentionalClose = false
    await this.ensure(onWaking)
    this.phase = 'waiting'
    this.send({ t: 'join', code, nick: this.nick })
  }

  ready() {
    this.send({ t: 'ready' })
  }

  /** Host-only: fill empty slots with bots and start now (short-roster start). */
  fillStart() {
    this.send({ t: 'fillStart' })
  }

  leave() {
    this.phase = 'idle'
    this.intentionalClose = true // user-initiated: don't auto-reconnect
    this.reconnecting = false
    this.pendingRejoin = false
    this.token = ''
    this.connectGen++ // abort any in-flight connect/retry loop
    this.connecting = null // let the next ensure() start a fresh connect
    const ws = this.ws
    this.ws = null
    ws?.close()
  }

  /** Test helper: drop the socket as if the network died (not user-initiated). */
  simulateDrop() {
    this.ws?.close()
  }

  /** Own state, or a host-simulated bot's state when `asId` is a bot id. */
  sendState(snap: PeerSnapshot, asId?: string) {
    this.send({ t: 'state', ...(asId ? { id: asId } : {}), ...snap })
  }

  sendFire(weaponId: string, asId?: string) {
    this.send({ t: 'fire', weapon: weaponId, ...(asId ? { id: asId } : {}) })
  }

  sendGrenade(origin: [number, number, number], dir: [number, number, number], asId?: string) {
    this.send({ t: 'grenade', origin, dir, ...(asId ? { id: asId } : {}) })
  }

  sendHit(weaponId: string, damage: number, targetId: string, attackerId?: string) {
    this.send({ t: 'hit', weapon: weaponId, damage, target: targetId, ...(attackerId ? { attacker: attackerId } : {}) })
  }

  private send(msg: Record<string, unknown>) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }

  private handle(raw: string) {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    switch (msg.t) {
      case 'roomList':
        this.cb.onRoomList((msg.rooms as RoomSummary[]) ?? [])
        break
      case 'created':
        this.code = String(msg.code)
        if (msg.token) this.token = String(msg.token)
        this.cb.onCreated(this.code)
        break
      case 'lobby':
        this.code = String(msg.code)
        if (msg.token) this.token = String(msg.token)
        this.pendingRejoin = false // a resume arrived
        this.cb.onLobby(msg as unknown as LobbyInfo)
        break
      case 'roster':
        if (msg.token) this.token = String(msg.token)
        this.pendingRejoin = false // a resume arrived
        this.cb.onRoster(msg as unknown as RosterInfo)
        break
      case 'round': {
        const info = msg as unknown as RoundInfo
        this.phase = info.phase
        this.cb.onRound(info)
        break
      }
      case 'hp':
        this.cb.onHp(String(msg.id), Number(msg.hp))
        break
      case 'state':
        this.cb.onPeerState(String(msg.id), msg as unknown as PeerSnapshot)
        break
      case 'fire':
        this.cb.onPeerFire(String(msg.id), String(msg.weapon))
        break
      case 'grenade':
        this.cb.onPeerGrenade(
          String(msg.id),
          msg.origin as [number, number, number],
          msg.dir as [number, number, number],
        )
        break
      case 'roomClosed':
        if (this.phase !== 'idle') {
          this.phase = 'idle'
          this.cb.onDisconnect(String(msg.reason ?? 'closed'))
        }
        this.ws?.close()
        break
      case 'error':
        // a rejection to our rejoin means the slot/room is gone → end cleanly
        if (this.pendingRejoin) {
          this.finishDisconnect('reconnect-failed')
          break
        }
        this.cb.onError(String(msg.reason))
        this.leave()
        break
    }
  }
}
