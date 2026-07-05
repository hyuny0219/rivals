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
}

export interface LobbyInfo {
  code: string
  teamSize: number
  mapId: string
  hostId: string
  you: string
  players: { id: string; team: number; ready: boolean; nick: string }[]
}

export interface RosterInfo {
  teamSize: number
  mapId: string
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
}

/** Default server: local dev server when running on localhost, Render otherwise. */
export function defaultServerUrl(): string {
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  return local ? 'ws://localhost:8081' : 'wss://rifle-gg-server.onrender.com'
}

/** WebSocket client for online team matches: lobby handshake + plumbing. */
export class OnlineManager {
  phase: OnlinePhase = 'idle'
  code = ''
  nick = '플레이어'
  private ws: WebSocket | null = null
  private url = ''

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
      // ignore stale events if leave() replaced/cleared the socket meanwhile
      ws.onopen = () => (this.ws === ws ? resolve() : reject(new Error('cancelled')))
      ws.onerror = () => reject(new Error('connect failed'))
      ws.onmessage = (e) => {
        if (this.ws === ws) this.handle(String(e.data))
      }
      ws.onclose = () => {
        if (this.ws !== ws) return
        this.ws = null
        if (this.phase !== 'idle') {
          this.phase = 'idle'
          this.cb.onDisconnect('connection-lost')
        }
      }
    })
  }

  /** Open (or reuse) a lobby connection for browsing rooms. */
  async browse(url: string) {
    this.url = url
    await this.ensure()
    this.list()
  }

  private async ensure() {
    if (this.connected) return
    await this.connect(this.url)
  }

  list() {
    if (this.connected && this.phase === 'idle') this.send({ t: 'list' })
  }

  async create(url: string, teamSize: number, mapId: string) {
    this.url = url
    await this.ensure()
    this.phase = 'waiting'
    this.send({ t: 'create', teamSize, mapId, nick: this.nick })
  }

  async join(url: string, code: string) {
    this.url = url
    await this.ensure()
    this.phase = 'waiting'
    this.send({ t: 'join', code, nick: this.nick })
  }

  ready() {
    this.send({ t: 'ready' })
  }

  leave() {
    this.phase = 'idle'
    const ws = this.ws
    this.ws = null
    ws?.close()
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
        this.cb.onCreated(this.code)
        break
      case 'lobby':
        this.code = String(msg.code)
        this.cb.onLobby(msg as unknown as LobbyInfo)
        break
      case 'roster':
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
        this.cb.onError(String(msg.reason))
        this.leave()
        break
    }
  }
}
