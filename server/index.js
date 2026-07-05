/**
 * RIFLE.GG game server — room-code 1v1 duels over WebSocket.
 *
 * The server is the authority for HP, scores, and the round state machine.
 * Movement/aim is client-simulated and relayed; damage arrives as claims
 * from the shooter and is validated against per-weapon caps + a rate limit.
 */
import { createServer } from 'http'
import { WebSocketServer } from 'ws'

const PORT = Number(process.env.PORT) || 8081
const WIN_SCORE = 5
const COUNTDOWN_MS = 3000
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
const MAX_CLAIMS_PER_SECOND = 25

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

class Room {
  constructor(code) {
    this.code = code
    this.sockets = [null, null]
    this.ready = [false, false]
    this.hp = [MAX_HP, MAX_HP]
    this.score = [0, 0]
    this.round = 0
    this.state = 'waiting' // waiting | countdown | combat | roundEnd | matchEnd
    this.timer = null
    this.claimWindow = [[], []] // timestamps of recent damage claims per side
    this.touch()
  }

  touch() {
    this.lastActivity = Date.now()
  }

  broadcast(msg) {
    send(this.sockets[0], msg)
    send(this.sockets[1], msg)
  }

  /** Per-side view of the round state (scores oriented to the receiver). */
  sendPhase(extra = {}) {
    for (let side = 0; side < 2; side++) {
      send(this.sockets[side], {
        t: 'round',
        phase: this.state,
        round: this.round,
        scoreYou: this.score[side],
        scoreEnemy: this.score[side ^ 1],
        hpYou: this.hp[side],
        hpEnemy: this.hp[side ^ 1],
        ...('winner' in extra ? { youWon: extra.winner === side } : {}),
      })
    }
  }

  startRound() {
    this.round++
    this.hp = [MAX_HP, MAX_HP]
    this.state = 'countdown'
    this.sendPhase()
    this.timer = setTimeout(() => {
      this.state = 'combat'
      this.sendPhase()
    }, COUNTDOWN_MS)
  }

  applyDamage(targetSide, damage, killerSide) {
    if (this.state !== 'combat') return
    this.hp[targetSide] = Math.max(0, this.hp[targetSide] - damage)
    for (let side = 0; side < 2; side++) {
      send(this.sockets[side], { t: 'hp', you: this.hp[side], enemy: this.hp[side ^ 1] })
    }
    if (this.hp[targetSide] <= 0) this.endRound(targetSide === killerSide ? targetSide ^ 1 : killerSide)
  }

  endRound(winner) {
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

  rateOk(side) {
    const now = Date.now()
    const window = this.claimWindow[side].filter((t) => now - t < 1000)
    window.push(now)
    this.claimWindow[side] = window
    return window.length <= MAX_CLAIMS_PER_SECOND
  }

  destroy(reason) {
    clearTimeout(this.timer)
    this.broadcast({ t: 'roomClosed', reason })
    for (const ws of this.sockets) {
      if (ws) ws.room = null
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
  ws.side = -1
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
        const newRoom = new Room(code)
        newRoom.sockets[0] = ws
        ws.room = newRoom
        ws.side = 0
        rooms.set(code, newRoom)
        send(ws, { t: 'created', code })
        break
      }
      case 'join': {
        if (room) return
        const target = rooms.get(String(msg.code ?? '').toUpperCase())
        if (!target || target.sockets[1] || target.state !== 'waiting') {
          return send(ws, { t: 'error', reason: 'no-room' })
        }
        target.sockets[1] = ws
        ws.room = target
        ws.side = 1
        target.touch()
        target.broadcast({ t: 'matched' })
        break
      }
      case 'ready': {
        if (!room || room.state !== 'waiting') return
        room.ready[ws.side] = true
        if (room.ready[0] && room.ready[1]) room.startRound()
        break
      }
      case 'state': // movement snapshot → relay verbatim to the opponent
      case 'fire':
      case 'grenade': {
        if (!room) return
        send(room.sockets[ws.side ^ 1], { ...msg, side: ws.side })
        break
      }
      case 'hit': {
        if (!room || room.state !== 'combat') return
        if (!room.rateOk(ws.side)) return
        const cap = DAMAGE_CAP[msg.weapon]
        if (!cap) return
        const damage = Math.min(Math.max(0, Math.round(Number(msg.damage) || 0)), cap)
        if (damage <= 0) return
        const targetSide = msg.self ? ws.side : ws.side ^ 1
        room.applyDamage(targetSide, damage, ws.side)
        break
      }
    }
  })

  ws.on('close', () => {
    const room = ws.room
    if (!room) return
    const other = room.sockets[ws.side ^ 1]
    send(other, { t: 'peerLeft' })
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
