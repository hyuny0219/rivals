/**
 * RIFLE.GG game server — room-code team matches (1v1 up to 4v4) over WebSocket.
 *
 * The server is the authority for HP, scores, and the round state machine.
 * Movement/aim is client-simulated and relayed; damage arrives as claims
 * and is validated against per-weapon caps, friendly fire, and a rate limit.
 * Empty slots are bots simulated by the host client (the room creator),
 * whose bot state/claims are attributed to bot ids.
 */
import { createServer } from 'http'
import { WebSocketServer } from 'ws'

const PORT = Number(process.env.PORT) || 8081
const WIN_SCORE = 5
const COUNTDOWN_MS = 3000
const FIRST_COUNTDOWN_MS = 13000 // round 1 includes the 10s loadout pick
const ROUND_END_MS = 2200
const MATCH_END_MS = 4000
const MAX_HP = 100
const ROOM_IDLE_TIMEOUT_MS = 10 * 60 * 1000

// max damage a single claim may carry per weapon (headshot included)
const DAMAGE_CAP = {
  ar: 36,
  shotgun: 101, // 8 pellets can land in one claim batch
  sniper: 190,
  pistol: 54,
  uzi: 21,
  knife: 55,
  grenade: 100,
}
const MAX_CLAIMS_PER_SECOND = 25 // per attacker entity

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const rooms = new Map() // code -> Room

function makeCode() {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = ''
    for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
    if (!rooms.has(code)) return code
  }
  return null
}

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
}

const WORLD_LIMIT = 200

function finite(v, limit = WORLD_LIMIT) {
  const n = Number(v)
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null
}

/** Validate a movement snapshot; returns null if any field is bogus. */
function sanitizeState(msg) {
  const x = finite(msg.x)
  const y = finite(msg.y)
  const z = finite(msg.z)
  const yaw = finite(msg.yaw, 1000)
  const pitch = finite(msg.pitch, 10)
  if (x === null || y === null || z === null || yaw === null || pitch === null) return null
  return { x, y, z, yaw, pitch, sliding: msg.sliding === true }
}

function sanitizeVec3(v) {
  if (!Array.isArray(v) || v.length !== 3) return null
  const out = [finite(v[0]), finite(v[1]), finite(v[2])]
  return out.every((n) => n !== null) ? out : null
}

class Room {
  constructor(code, teamSize) {
    this.code = code
    this.teamSize = Math.max(1, Math.min(4, Number(teamSize) || 1))
    this.capacity = this.teamSize * 2
    this.players = [] // {id, ws, team, ready}
    this.bots = [] // {id, team}
    this.entities = new Map() // id -> {team, hp, isBot}
    this.score = [0, 0]
    this.round = 0
    this.state = 'waiting' // waiting | countdown | combat | roundEnd | matchEnd
    this.timer = null
    this.destroyed = false
    this.nextPlayerNum = 1
    this.claimWindows = new Map() // attacker id -> timestamps
    this.touch()
  }

  touch() {
    this.lastActivity = Date.now()
  }

  get hostId() {
    return this.players[0]?.id
  }

  broadcast(msg, exceptWs = null) {
    for (const p of this.players) {
      if (p.ws !== exceptWs) send(p.ws, msg)
    }
  }

  addPlayer(ws) {
    const id = `p${this.nextPlayerNum++}`
    const t0 = this.players.filter((p) => p.team === 0).length
    const t1 = this.players.filter((p) => p.team === 1).length
    // creator takes team 0; then balance, sending the 2nd player to team 1
    let team
    if (this.players.length === 0) team = 0
    else if (t1 < t0) team = 1
    else if (t0 < t1) team = 0
    else team = 0
    const player = { id, ws, team, ready: false }
    this.players.push(player)
    ws.room = this
    ws.playerId = id
    this.sendLobby()
    return player
  }

  sendLobby() {
    for (const p of this.players) {
      send(p.ws, {
        t: 'lobby',
        code: this.code,
        teamSize: this.teamSize,
        hostId: this.hostId,
        you: p.id,
        players: this.players.map((q) => ({ id: q.id, team: q.team, ready: q.ready })),
      })
    }
  }

  tryStart() {
    if (this.state !== 'waiting') return
    if (this.players.length === 0 || !this.players.every((p) => p.ready)) return
    // fill empty slots with bots
    this.bots = []
    let botNum = 1
    for (const team of [0, 1]) {
      const humans = this.players.filter((p) => p.team === team).length
      for (let i = humans; i < this.teamSize; i++) {
        this.bots.push({ id: `b${botNum++}`, team })
      }
    }
    this.entities.clear()
    for (const p of this.players) this.entities.set(p.id, { team: p.team, hp: MAX_HP, isBot: false })
    for (const b of this.bots) this.entities.set(b.id, { team: b.team, hp: MAX_HP, isBot: true })

    for (const p of this.players) {
      send(p.ws, {
        t: 'roster',
        teamSize: this.teamSize,
        hostId: this.hostId,
        you: p.id,
        players: this.players.map((q) => ({ id: q.id, team: q.team })),
        bots: this.bots.map((b) => ({ id: b.id, team: b.team })),
      })
    }
    this.startRound()
  }

  hpSnapshot() {
    const out = {}
    for (const [id, e] of this.entities) out[id] = e.hp
    return out
  }

  sendPhase(extra = {}) {
    for (const p of this.players) {
      send(p.ws, {
        t: 'round',
        phase: this.state,
        round: this.round,
        scoreYou: this.score[p.team],
        scoreEnemy: this.score[p.team ^ 1],
        hps: this.hpSnapshot(),
        ...('winner' in extra ? { youWon: extra.winner === p.team } : {}),
      })
    }
  }

  startRound() {
    if (this.destroyed) return
    this.round++
    for (const e of this.entities.values()) e.hp = MAX_HP
    this.state = 'countdown'
    this.sendPhase()
    this.timer = setTimeout(
      () => {
        this.state = 'combat'
        this.sendPhase()
      },
      this.round === 1 ? FIRST_COUNTDOWN_MS : COUNTDOWN_MS,
    )
  }

  rateOk(attackerId) {
    const now = Date.now()
    const window = (this.claimWindows.get(attackerId) ?? []).filter((t) => now - t < 1000)
    window.push(now)
    this.claimWindows.set(attackerId, window)
    return window.length <= MAX_CLAIMS_PER_SECOND
  }

  handleHit(ws, msg) {
    if (this.state !== 'combat') return
    // attribution: players claim as themselves; the host may claim for its bots
    let attackerId = ws.playerId
    if (typeof msg.attacker === 'string' && msg.attacker !== ws.playerId) {
      const bot = this.entities.get(msg.attacker)
      if (!bot?.isBot || ws.playerId !== this.hostId) return
      attackerId = msg.attacker
    }
    const attacker = this.entities.get(attackerId)
    const target = this.entities.get(String(msg.target ?? ''))
    if (!attacker || !target) return
    if (attacker.hp <= 0 || target.hp <= 0) return
    // friendly fire is off (self-damage allowed)
    if (attacker.team === target.team && attackerId !== String(msg.target)) return
    if (!this.rateOk(attackerId)) return
    const cap = Object.hasOwn(DAMAGE_CAP, msg.weapon) ? DAMAGE_CAP[msg.weapon] : 0
    if (!cap) return
    const damage = Math.min(Math.max(0, Math.round(Number(msg.damage) || 0)), cap)
    if (damage <= 0) return

    target.hp = Math.max(0, target.hp - damage)
    this.broadcast({ t: 'hp', id: String(msg.target), hp: target.hp })
    if (target.hp <= 0) this.checkWipe()
  }

  checkWipe() {
    for (const team of [0, 1]) {
      const alive = [...this.entities.values()].filter((e) => e.team === team && e.hp > 0).length
      if (alive === 0) {
        this.endRound(team ^ 1)
        return
      }
    }
  }

  endRound(winner) {
    if (this.destroyed || this.state !== 'combat') return
    clearTimeout(this.timer)
    this.score[winner]++
    if (this.score[winner] >= WIN_SCORE) {
      this.state = 'matchEnd'
      this.sendPhase({ winner })
      this.timer = setTimeout(() => this.destroy('match-over'), MATCH_END_MS)
    } else {
      this.state = 'roundEnd'
      this.sendPhase({ winner })
      this.timer = setTimeout(() => this.startRound(), ROUND_END_MS)
    }
  }

  /** Relay a state/fire/grenade message with validated attribution. */
  relay(ws, msg, payload) {
    let id = ws.playerId
    if (typeof msg.id === 'string' && msg.id !== ws.playerId) {
      const e = this.entities.get(msg.id)
      if (!e?.isBot || ws.playerId !== this.hostId) return
      id = msg.id
    }
    this.broadcast({ ...payload, id }, ws)
  }

  destroy(reason) {
    this.destroyed = true
    clearTimeout(this.timer)
    this.broadcast({ t: 'roomClosed', reason })
    for (const p of this.players) {
      if (p.ws) p.ws.room = null
    }
    rooms.delete(this.code)
  }
}

const httpServer = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' })
  res.end('rifle-gg-server ok\n')
})

const wss = new WebSocketServer({ server: httpServer, maxPayload: 4096 })

wss.on('connection', (ws) => {
  ws.room = null
  ws.playerId = ''
  ws.isAlive = true
  ws.on('pong', () => (ws.isAlive = true))

  ws.on('message', (raw) => {
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }
    const room = ws.room
    if (room) room.touch()

    switch (msg.t) {
      case 'create': {
        if (room) return
        const code = makeCode()
        if (!code) return send(ws, { t: 'error', reason: 'busy' })
        const newRoom = new Room(code, msg.teamSize)
        rooms.set(code, newRoom)
        newRoom.addPlayer(ws)
        send(ws, { t: 'created', code })
        break
      }
      case 'join': {
        if (room) return
        const target = rooms.get(String(msg.code ?? '').toUpperCase())
        if (!target || target.state !== 'waiting' || target.players.length >= target.capacity) {
          return send(ws, { t: 'error', reason: 'no-room' })
        }
        target.addPlayer(ws)
        target.touch()
        break
      }
      case 'ready': {
        if (!room || room.state !== 'waiting') return
        const player = room.players.find((p) => p.ws === ws)
        if (!player) return
        player.ready = true
        room.sendLobby()
        room.tryStart()
        break
      }
      case 'state': {
        if (!room) return
        const snap = sanitizeState(msg)
        if (snap) room.relay(ws, msg, { t: 'state', ...snap })
        break
      }
      case 'fire': {
        if (!room) return
        room.relay(ws, msg, { t: 'fire', weapon: String(msg.weapon ?? '') })
        break
      }
      case 'grenade': {
        if (!room) return
        const origin = sanitizeVec3(msg.origin)
        const dir = sanitizeVec3(msg.dir)
        if (origin && dir) room.relay(ws, msg, { t: 'grenade', origin, dir })
        break
      }
      case 'hit': {
        if (!room) return
        room.handleHit(ws, msg)
        break
      }
    }
  })

  ws.on('close', () => {
    const room = ws.room
    if (!room) return
    // v1: any departure tears the room down (the host runs the bots, and
    // rounds assume a fixed roster)
    room.destroy('peer-left')
  })
})

// liveness + idle-room sweep
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate()
      continue
    }
    ws.isAlive = false
    ws.ping()
  }
  const now = Date.now()
  for (const room of rooms.values()) {
    if (now - room.lastActivity > ROOM_IDLE_TIMEOUT_MS) room.destroy('idle')
  }
}, 30_000)

httpServer.listen(PORT, () => {
  console.log(`rifle-gg-server listening on :${PORT}`)
})
