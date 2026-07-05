export type OnlinePhase = 'idle' | 'waiting' | 'countdown' | 'combat' | 'roundEnd' | 'matchEnd'

export interface PeerSnapshot {
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  sliding: boolean
}

export interface RoundInfo {
  phase: OnlinePhase
  round: number
  scoreYou: number
  scoreEnemy: number
  hpYou: number
  hpEnemy: number
  youWon?: boolean
}

export interface OnlineCallbacks {
  onCreated: (code: string) => void
  onMatched: () => void
  onRound: (info: RoundInfo) => void
  onHp: (you: number, enemy: number) => void
  onPeerState: (snap: PeerSnapshot) => void
  onPeerFire: (weaponId: string) => void
  onPeerGrenade: (origin: [number, number, number], dir: [number, number, number]) => void
  onPeerLeft: () => void
  onError: (reason: string) => void
  onDisconnect: () => void
}

/** Default server: local dev server when running on localhost, Render otherwise. */
export function defaultServerUrl(): string {
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  return local ? 'ws://localhost:8081' : 'wss://rifle-gg-server.onrender.com'
}

/** WebSocket client for online 1v1: room handshake + message plumbing. */
export class OnlineManager {
  phase: OnlinePhase = 'idle'
  code = ''
  private ws: WebSocket | null = null

  constructor(private cb: OnlineCallbacks) {}

  get active(): boolean {
    return this.phase !== 'idle'
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
          this.cb.onDisconnect()
        }
      }
    })
  }

  async create(url: string) {
    await this.connect(url)
    this.phase = 'waiting'
    this.send({ t: 'create' })
  }

  async join(url: string, code: string) {
    await this.connect(url)
    this.phase = 'waiting'
    this.send({ t: 'join', code })
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

  sendState(snap: PeerSnapshot) {
    this.send({ t: 'state', ...snap })
  }

  sendFire(weaponId: string) {
    this.send({ t: 'fire', weapon: weaponId })
  }

  sendGrenade(origin: [number, number, number], dir: [number, number, number]) {
    this.send({ t: 'grenade', origin, dir })
  }

  sendHit(weaponId: string, damage: number, self = false) {
    this.send({ t: 'hit', weapon: weaponId, damage, self })
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
      case 'created':
        this.code = String(msg.code)
        this.cb.onCreated(this.code)
        break
      case 'matched':
        this.cb.onMatched()
        break
      case 'round': {
        const info = msg as unknown as RoundInfo
        this.phase = info.phase
        this.cb.onRound(info)
        break
      }
      case 'hp':
        this.cb.onHp(Number(msg.you), Number(msg.enemy))
        break
      case 'state':
        this.cb.onPeerState(msg as unknown as PeerSnapshot)
        break
      case 'fire':
        this.cb.onPeerFire(String(msg.weapon))
        break
      case 'grenade':
        this.cb.onPeerGrenade(msg.origin as [number, number, number], msg.dir as [number, number, number])
        break
      case 'peerLeft':
        this.cb.onPeerLeft()
        this.leave()
        break
      case 'roomClosed':
        if (this.phase !== 'idle') {
          this.phase = 'idle'
          this.cb.onDisconnect()
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
