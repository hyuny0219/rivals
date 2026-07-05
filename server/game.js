/**
 * RIFLE.GG game logic — runtime-agnostic (works under Node `ws` and Deno's
 * native WebSocket). The transport layer (server/index.js for Node,
 * server/deno.ts for Deno Deploy) wraps each socket in a `conn` adapter:
 *
 *   conn.send(objOrNull)  serialize + send if the socket is open (no-op otherwise)
 *   conn.close()          close the socket
 *   conn.room             mutable, owned by this module
 *   conn.playerId         mutable, owned by this module
 *
 * The server is the authority for HP, scores, and the round state machine.
 * Movement/aim is client-simulated and relayed; damage arrives as claims and
 * is validated against per-weapon caps, friendly fire, and a rate limit. Empty
 * slots are bots simulated by the host client, attributed to bot ids.
 */

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
// Per-weapon damage-claim throttle (token bucket per attacker+weapon). `rate`
// (tokens/sec) sits a little above each weapon's real fire rate (rpm/60) so
// legit fire never starves; `burst` absorbs claims that arrive batched after a
// latency spike. Sustained DPS is thus bounded to ~rate × DAMAGE_CAP — e.g.
// sniper drops from ~4750/s (old flat cap) to ~230/s. Grenade's burst covers a
// single blast hitting every fighter in a 4v4.
const CLAIM_LIMIT = {
  ar: { rate: 12, burst: 8 }, //     600rpm = 10/s
  shotgun: { rate: 2.2, burst: 4 }, // 78rpm = 1.3/s
  sniper: { rate: 1.2, burst: 2 }, //  42rpm = 0.7/s
  pistol: { rate: 7, burst: 5 }, //   330rpm = 5.5/s
  uzi: { rate: 18, burst: 10 }, //    900rpm = 15/s
  knife: { rate: 3.5, burst: 3 }, //  140rpm = 2.3/s
  grenade: { rate: 1.5, burst: 8 }, // one blast can hit all 8 in a 4v4
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const MAP_IDS = ['foundry', 'sandstorm', 'neon', 'frost', 'jungle']
const DIFFICULTIES = ['easy', 'normal', 'hard']
const RECONNECT_GRACE_MS = 20_000 // window to rejoin after a socket drop

const rooms = new Map() // code -> Room

function makeCode() {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = ''
    for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
    if (!rooms.has(code)) return code
  }
  return null
}

/** Per-player secret used to reclaim a slot after a disconnect. */
function makeToken() {
  return Math.floor(Math.random() * 1e9).toString(36) + Math.floor(Math.random() * 1e9).toString(36)
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

/** Trim a nickname to a safe display string. */
function cleanNick(nick) {
  const s = String(nick ?? '').replace(/[<>&]/g, '').trim().slice(0, 12)
  return s || '플레이어'
}

function roomList() {
  const out = []
  for (const room of rooms.values()) {
    const entry = room.listing()
    if (entry) out.push(entry)
  }
  return out.slice(0, 30)
}

class Room {
  constructor(code, teamSize, mapId, fillBots = true, difficulty = 'normal') {
    this.code = code
    this.teamSize = Math.max(1, Math.min(4, Number(teamSize) || 1))
    this.mapId = MAP_IDS.includes(mapId) ? mapId : 'foundry'
    this.fillBots = fillBots !== false
    this.difficulty = DIFFICULTIES.includes(difficulty) ? difficulty : 'normal'
    this.capacity = this.teamSize * 2
    this.players = [] // {id, conn, team, ready, nick}
    this.bots = [] // {id, team}
    this.entities = new Map() // id -> {team, hp, isBot}
    this.score = [0, 0]
    this.round = 0
    this.state = 'waiting' // waiting | countdown | combat | roundEnd | matchEnd
    this.timer = null
    this.destroyed = false
    this.nextPlayerNum = 1
    this.buckets = new Map() // attacker id -> Map(weapon -> {tokens, last})
    this.touch()
  }

  touch() {
    this.lastActivity = Date.now()
  }

  get hostId() {
    return this.players[0]?.id
  }

  broadcast(msg, exceptConn = null) {
    for (const p of this.players) {
      if (p.conn && p.conn !== exceptConn) p.conn.send(msg)
    }
  }

  addPlayer(conn, nick) {
    const id = `p${this.nextPlayerNum++}`
    const t0 = this.players.filter((p) => p.team === 0).length
    const t1 = this.players.filter((p) => p.team === 1).length
    // creator takes team 0; then balance, sending the 2nd player to team 1
    let team
    if (this.players.length === 0) team = 0
    else if (t1 < t0) team = 1
    else if (t0 < t1) team = 0
    else team = 0
    const player = { id, conn, team, ready: false, nick: cleanNick(nick), token: makeToken(), connected: true, graceTimer: null }
    this.players.push(player)
    conn.room = this
    conn.playerId = id
    this.sendLobby()
    return player
  }

  get hostNick() {
    return this.players[0]?.nick ?? '방장'
  }

  /** Public listing entry, or null if the room can't be joined. */
  listing() {
    if (this.state !== 'waiting' || this.players.length >= this.capacity) return null
    return {
      code: this.code,
      host: this.hostNick,
      count: this.players.length,
      cap: this.capacity,
      teamSize: this.teamSize,
      mapId: this.mapId,
      fillBots: this.fillBots,
    }
  }

  sendLobby() {
    for (const p of this.players) {
      if (!p.conn) continue
      p.conn.send({
        t: 'lobby',
        code: this.code,
        teamSize: this.teamSize,
        mapId: this.mapId,
        fillBots: this.fillBots,
        hostId: this.hostId,
        you: p.id,
        token: p.token,
        players: this.players.map((q) => ({ id: q.id, team: q.team, ready: q.ready, nick: q.nick, gone: !q.connected })),
      })
    }
  }

  /** Host chose to start now, filling every empty slot with bots. */
  startWithBots() {
    if (this.state !== 'waiting') return
    this.fillBots = true
    for (const p of this.players) p.ready = true
    this.sendLobby()
    this.tryStart()
  }

  tryStart() {
    if (this.state !== 'waiting') return
    if (this.players.length === 0 || !this.players.every((p) => p.ready)) return
    // without bot fill the match waits for a full human roster
    if (!this.fillBots && this.players.length < this.capacity) return
    // fill empty slots with bots (only when bot fill is enabled)
    this.bots = []
    let botNum = 1
    if (this.fillBots) {
      for (const team of [0, 1]) {
        const humans = this.players.filter((p) => p.team === team).length
        for (let i = humans; i < this.teamSize; i++) {
          this.bots.push({ id: `b${botNum++}`, team })
        }
      }
    }
    this.entities.clear()
    for (const p of this.players) this.entities.set(p.id, { team: p.team, hp: MAX_HP, isBot: false })
    for (const b of this.bots) this.entities.set(b.id, { team: b.team, hp: MAX_HP, isBot: true })

    for (const p of this.players) if (p.conn) p.conn.send(this.rosterMsg(p))
    this.startRound()
  }

  rosterMsg(p) {
    return {
      t: 'roster',
      teamSize: this.teamSize,
      mapId: this.mapId,
      difficulty: this.difficulty,
      hostId: this.hostId,
      you: p.id,
      token: p.token,
      players: this.players.map((q) => ({ id: q.id, team: q.team, nick: q.nick })),
      bots: this.bots.map((b) => ({ id: b.id, team: b.team })),
    }
  }

  hpSnapshot() {
    const out = {}
    for (const [id, e] of this.entities) out[id] = e.hp
    return out
  }

  phaseMsg(p, extra = {}) {
    return {
      t: 'round',
      phase: this.state,
      round: this.round,
      scoreYou: this.score[p.team],
      scoreEnemy: this.score[p.team ^ 1],
      hps: this.hpSnapshot(),
      ...('winner' in extra ? { youWon: extra.winner === p.team } : {}),
      ...(extra.draw ? { draw: true } : {}),
    }
  }

  sendPhase(extra = {}) {
    for (const p of this.players) if (p.conn) p.conn.send(this.phaseMsg(p, extra))
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

  /** Token-bucket throttle bounding a weapon's claim rate to its fire rate. */
  claimOk(attackerId, weapon, now) {
    const limit = Object.hasOwn(CLAIM_LIMIT, weapon) ? CLAIM_LIMIT[weapon] : null
    if (!limit) return false
    let byWeapon = this.buckets.get(attackerId)
    if (!byWeapon) {
      byWeapon = new Map()
      this.buckets.set(attackerId, byWeapon)
    }
    let b = byWeapon.get(weapon)
    if (!b) {
      b = { tokens: limit.burst, last: now }
      byWeapon.set(weapon, b)
    }
    b.tokens = Math.min(limit.burst, b.tokens + ((now - b.last) / 1000) * limit.rate)
    b.last = now
    if (b.tokens < 1) return false
    b.tokens -= 1
    return true
  }

  handleHit(conn, msg) {
    if (this.state !== 'combat') return
    // attribution: players claim as themselves; the host may claim for its bots
    let attackerId = conn.playerId
    if (typeof msg.attacker === 'string' && msg.attacker !== conn.playerId) {
      const bot = this.entities.get(msg.attacker)
      if (!bot?.isBot || conn.playerId !== this.hostId) return
      attackerId = msg.attacker
    }
    const attacker = this.entities.get(attackerId)
    const target = this.entities.get(String(msg.target ?? ''))
    if (!attacker || !target) return
    if (attacker.hp <= 0 || target.hp <= 0) return
    // friendly fire is off (self-damage allowed)
    if (attacker.team === target.team && attackerId !== String(msg.target)) return
    const weapon = String(msg.weapon ?? '')
    const cap = Object.hasOwn(DAMAGE_CAP, weapon) ? DAMAGE_CAP[weapon] : 0
    if (!cap) return
    if (!this.claimOk(attackerId, weapon, Date.now())) return
    const damage = Math.min(Math.max(0, Math.round(Number(msg.damage) || 0)), cap)
    if (damage <= 0) return

    target.hp = Math.max(0, target.hp - damage)
    this.broadcast({ t: 'hp', id: String(msg.target), hp: target.hp })
    if (target.hp <= 0) this.checkWipe()
  }

  checkWipe() {
    const alive0 = [...this.entities.values()].filter((e) => e.team === 0 && e.hp > 0).length
    const alive1 = [...this.entities.values()].filter((e) => e.team === 1 && e.hp > 0).length
    if (alive0 > 0 && alive1 > 0) return
    if (alive0 === 0 && alive1 === 0) this.endRound(-1) // mutual wipe → draw
    else this.endRound(alive0 === 0 ? 1 : 0)
  }

  endRound(winner) {
    if (this.destroyed || this.state !== 'combat') return
    clearTimeout(this.timer)
    const draw = winner !== 0 && winner !== 1
    if (!draw) this.score[winner]++
    if (!draw && this.score[winner] >= WIN_SCORE) {
      this.state = 'matchEnd'
      this.sendPhase({ winner })
      this.timer = setTimeout(() => this.destroy('match-over'), MATCH_END_MS)
    } else {
      this.state = 'roundEnd'
      this.sendPhase(draw ? { draw: true } : { winner })
      this.timer = setTimeout(() => this.startRound(), ROUND_END_MS)
    }
  }

  /** Relay a state/fire/grenade message with validated attribution. */
  relay(conn, msg, payload) {
    let id = conn.playerId
    if (typeof msg.id === 'string' && msg.id !== conn.playerId) {
      const e = this.entities.get(msg.id)
      if (!e?.isBot || conn.playerId !== this.hostId) return
      id = msg.id
    }
    this.broadcast({ ...payload, id }, conn)
  }

  /** Socket dropped: hold the slot open for a grace window so they can rejoin. */
  onDisconnect(conn) {
    const player = this.players.find((p) => p.conn === conn)
    if (!player) return
    player.connected = false
    player.conn = null
    conn.room = null
    clearTimeout(player.graceTimer)
    player.graceTimer = setTimeout(() => this.dropPlayer(player), RECONNECT_GRACE_MS)
    if (this.state === 'waiting') this.sendLobby() // show them as (gone) meanwhile
  }

  /** Reclaim an open slot on the same token; resume from current state. */
  reconnect(player, conn) {
    clearTimeout(player.graceTimer)
    player.graceTimer = null
    player.connected = true
    player.conn = conn
    conn.room = this
    conn.playerId = player.id
    this.touch()
    if (this.state === 'waiting') {
      this.sendLobby()
    } else {
      // mid-match: rebuild their world and drop them into the current phase
      conn.send(this.rosterMsg(player))
      conn.send(this.phaseMsg(player))
    }
  }

  /** Grace expired without a rejoin — remove the player for good. */
  dropPlayer(player) {
    if (player.connected) return // already rejoined
    const wasHost = this.hostId === player.id
    const idx = this.players.indexOf(player)
    if (idx >= 0) this.players.splice(idx, 1)
    const ent = this.entities.get(player.id)
    if (ent) ent.hp = 0 // count them eliminated so a round can still resolve

    if (!this.players.some((p) => p.connected)) return this.destroy('empty')

    if (this.state === 'waiting') {
      // players[0] shifted → host promotion is automatic via hostId
      this.sendLobby()
      this.tryStart()
    } else if (wasHost) {
      // bots are host-simulated; we can't hand that off mid-match (v1)
      this.destroy('host-left')
    } else {
      this.broadcast({ t: 'hp', id: player.id, hp: 0 })
      this.checkWipe()
    }
  }

  destroy(reason) {
    this.destroyed = true
    clearTimeout(this.timer)
    for (const p of this.players) clearTimeout(p.graceTimer)
    this.broadcast({ t: 'roomClosed', reason })
    for (const p of this.players) {
      if (p.conn) p.conn.room = null
    }
    rooms.delete(this.code)
  }
}

/** Handle one decoded client message on a connection. */
export function handleMessage(conn, msg) {
  if (!msg || typeof msg !== 'object') return
  const room = conn.room
  if (room) room.touch()

  switch (msg.t) {
    case 'list': {
      if (room) return
      conn.send({ t: 'roomList', rooms: roomList() })
      break
    }
    case 'create': {
      if (room) return
      const code = makeCode()
      if (!code) return conn.send({ t: 'error', reason: 'busy' })
      const newRoom = new Room(code, msg.teamSize, String(msg.mapId ?? 'foundry'), msg.fillBots, String(msg.difficulty ?? 'normal'))
      rooms.set(code, newRoom)
      const creator = newRoom.addPlayer(conn, msg.nick)
      conn.send({ t: 'created', code, token: creator.token })
      break
    }
    case 'join': {
      if (room) return
      const target = rooms.get(String(msg.code ?? '').toUpperCase())
      if (!target || target.state !== 'waiting' || target.players.length >= target.capacity) {
        return conn.send({ t: 'error', reason: 'no-room' })
      }
      target.addPlayer(conn, msg.nick)
      target.touch()
      break
    }
    case 'rejoin': {
      if (room) return
      const target = rooms.get(String(msg.code ?? '').toUpperCase())
      if (!target || target.destroyed) return conn.send({ t: 'error', reason: 'no-room' })
      const player = target.players.find((p) => !p.connected && p.token === String(msg.token ?? ''))
      if (!player) return conn.send({ t: 'error', reason: 'no-room' })
      target.reconnect(player, conn)
      break
    }
    case 'ready': {
      if (!room || room.state !== 'waiting') return
      const player = room.players.find((p) => p.conn === conn)
      if (!player) return
      player.ready = true
      room.sendLobby()
      room.tryStart()
      break
    }
    case 'fillStart': {
      if (!room || room.state !== 'waiting') return
      if (conn.playerId !== room.hostId) return
      room.startWithBots()
      break
    }
    case 'state': {
      if (!room) return
      const snap = sanitizeState(msg)
      if (snap) room.relay(conn, msg, { t: 'state', ...snap })
      break
    }
    case 'fire': {
      if (!room) return
      room.relay(conn, msg, { t: 'fire', weapon: String(msg.weapon ?? '') })
      break
    }
    case 'grenade': {
      if (!room) return
      const origin = sanitizeVec3(msg.origin)
      const dir = sanitizeVec3(msg.dir)
      if (origin && dir) room.relay(conn, msg, { t: 'grenade', origin, dir })
      break
    }
    case 'hit': {
      if (!room) return
      room.handleHit(conn, msg)
      break
    }
  }
}

/** Socket closed: hold the slot for a grace window so the player can rejoin. */
export function handleClose(conn) {
  const room = conn.room
  if (!room) return
  room.onDisconnect(conn)
}

let sweepTimer = null
/** Start the idle-room sweep (safe to call once per process). */
export function startIdleSweep() {
  if (sweepTimer) return
  sweepTimer = setInterval(() => {
    const now = Date.now()
    for (const room of rooms.values()) {
      if (now - room.lastActivity > ROOM_IDLE_TIMEOUT_MS) room.destroy('idle')
    }
  }, 30_000)
  // don't keep the Node process alive just for the sweep
  if (typeof sweepTimer?.unref === 'function') sweepTimer.unref()
}
