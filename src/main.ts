import * as THREE from 'three'
import './style.css'
import { Input } from './core/input'
import { TouchControls, isTouchDevice } from './core/touch'
import { PhysicsWorld, Damageable } from './world/physics'
import { buildMap } from './world/map'
import { PlayerController } from './player/controller'
import { Effects } from './combat/effects'
import { ProjectileManager } from './combat/projectiles'
import { WeaponController } from './combat/weaponController'
import { SLOT_ORDER } from './combat/weapons'
import { TargetDummy } from './entities/dummy'
import { Bot, Difficulty } from './entities/bot'
import { DuelManager } from './game/duel'
import { AudioEngine } from './core/audio'
import { loadSettings, saveSettings } from './core/settings'
import { OnlineManager, defaultServerUrl, RoundInfo, RosterInfo, LobbyInfo } from './net/online'
import { MAPS, mapById } from './world/maps'
import { RemotePlayer } from './entities/remote'
import { WEAPONS } from './combat/weapons'

const canvas = document.querySelector<HTMLCanvasElement>('#game')!
const menu = document.querySelector<HTMLDivElement>('#menu')!
const hud = document.querySelector<HTMLDivElement>('#hud')!
const dashFill = document.querySelector<HTMLSpanElement>('#dash-fill')!
const hpFill = document.querySelector<HTMLSpanElement>('#hp-fill')!
const hpNum = document.querySelector<HTMLSpanElement>('#hp-num')!
const ammoMag = document.querySelector<HTMLSpanElement>('#ammo-mag')!
const ammoMax = document.querySelector<HTMLSpanElement>('#ammo-max')!
const weaponName = document.querySelector<HTMLDivElement>('#weapon-name')!
const slotEls = [...document.querySelectorAll<HTMLSpanElement>('#weapon-slots span')]
const touchSlotEls = [...document.querySelectorAll<HTMLButtonElement>('.slot-btn')]
const crosshair = document.querySelector<HTMLDivElement>('#crosshair')!
const hitmarker = document.querySelector<HTMLDivElement>('#hitmarker')!
const killfeed = document.querySelector<HTMLDivElement>('#killfeed')!
const scoreWrap = document.querySelector<HTMLDivElement>('#score-wrap')!
const scorePlayer = document.querySelector<HTMLSpanElement>('#score-player')!
const scoreBot = document.querySelector<HTMLSpanElement>('#score-bot')!
const banner = document.querySelector<HTMLDivElement>('#banner')!
const bannerMain = document.querySelector<HTMLDivElement>('#banner-main')!
const bannerSub = document.querySelector<HTMLDivElement>('#banner-sub')!
const botHpWrap = document.querySelector<HTMLDivElement>('#bot-hp-wrap')!
const botHpFill = document.querySelector<HTMLSpanElement>('#bot-hp-fill')!
const vignette = document.querySelector<HTMLDivElement>('#vignette')!
const aliveRow = document.querySelector<HTMLDivElement>('#alive-row')!
const scoreboard = document.querySelector<HTMLDivElement>('#scoreboard')!
const sbScore = document.querySelector<HTMLSpanElement>('#sb-score')!
const sbTeamA = document.querySelector<HTMLUListElement>('#sb-team-a')!
const sbTeamB = document.querySelector<HTMLUListElement>('#sb-team-b')!
const aliveAllies = document.querySelector<HTMLSpanElement>('#alive-allies')!
const aliveEnemies = document.querySelector<HTMLSpanElement>('#alive-enemies')!
const onlineCreateBtn = document.querySelector<HTMLButtonElement>('#online-create-btn')!
const onlineJoinBtn = document.querySelector<HTMLButtonElement>('#online-join-btn')!
const onlineCodeInput = document.querySelector<HTMLInputElement>('#online-code')!
const onlineStatus = document.querySelector<HTMLDivElement>('#online-status')!
const onlineStatusText = document.querySelector<HTMLSpanElement>('#online-status-text')!
const onlineGoBtn = document.querySelector<HTMLButtonElement>('#online-go-btn')!
const onlineFillBtn = document.querySelector<HTMLButtonElement>('#online-fill-btn')!
const onlineCancelBtn = document.querySelector<HTMLButtonElement>('#online-cancel-btn')!
const loadoutPanel = document.querySelector<HTMLDivElement>('#loadout-panel')!
const nickGate = document.querySelector<HTMLDivElement>('#nick-gate')!
const nickInput = document.querySelector<HTMLInputElement>('#nick-input')!
const nickEnterBtn = document.querySelector<HTMLButtonElement>('#nick-enter-btn')!
const nickChangeBtn = document.querySelector<HTMLButtonElement>('#nick-change-btn')!
const lobbyEl = document.querySelector<HTMLDivElement>('#lobby')!
const lobbyNick = document.querySelector<HTMLElement>('#lobby-nick')!
const roomsList = document.querySelector<HTMLDivElement>('#rooms-list')!
const roomsRefreshBtn = document.querySelector<HTMLButtonElement>('#rooms-refresh-btn')!
const createPanel = document.querySelector<HTMLDivElement>('#create-panel')!
const createConfirmBtn = document.querySelector<HTMLButtonElement>('#create-confirm-btn')!
const createCancelBtn = document.querySelector<HTMLButtonElement>('#create-cancel-btn')!
const fillBotsBtn = document.querySelector<HTMLButtonElement>('#fill-bots-btn')!
const botDiffRow = document.querySelector<HTMLDivElement>('#bot-diff-row')!

const touchMode = isTouchDevice()
if (touchMode) document.body.classList.add('touch')

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
// map shadows are static and rendered once; dynamic objects (viewmodel,
// dummies, grenades) do not cast shadows so the cache stays valid
renderer.shadowMap.autoUpdate = false
renderer.shadowMap.needsUpdate = true

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x8fc4e8)
scene.fog = new THREE.Fog(0x8fc4e8, 60, 140)

const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 300)
scene.add(camera) // viewmodel is parented to the camera

const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x9a8f7a, 1.5)
scene.add(hemi)

const ambient = new THREE.AmbientLight(0xffffff, 0.35)
scene.add(ambient)

const sun = new THREE.DirectionalLight(0xfff2dd, 1.6)
sun.position.set(30, 50, 20)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.camera.left = -45
sun.shadow.camera.right = 45
sun.shadow.camera.top = 45
sun.shadow.camera.bottom = -45
sun.shadow.camera.far = 120
scene.add(sun)

// ---------- world / player ----------
const physics = new PhysicsWorld()
let map = buildMap(physics, MAPS[0])
scene.add(map.group)
let currentMapId = MAPS[0].id

/** Swap the arena theme: rebuild visuals + colliders + environment. The
 * collision layout is identical across maps, so bots/spawns are unaffected. */
function loadMap(mapId: string) {
  const def = mapById(mapId)
  currentMapId = def.id
  scene.remove(map.group)
  map.group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose()
      ;(o.material as THREE.Material).dispose()
    }
  })
  physics.clearColliders()
  map = buildMap(physics, def)
  scene.add(map.group)

  const t = def.theme
  scene.background = new THREE.Color(t.sky)
  scene.fog = new THREE.Fog(t.fog.color, t.fog.near, t.fog.far)
  hemi.color.setHex(t.hemi.sky)
  hemi.groundColor.setHex(t.hemi.ground)
  hemi.intensity = t.hemi.intensity
  sun.color.setHex(t.sun.color)
  sun.intensity = t.sun.intensity
  renderer.shadowMap.needsUpdate = true // re-render the static shadow map
}

const input = new Input()
const player = new PlayerController(physics, camera)

// ---------- player as a damage target (grenade self-damage) ----------
const MAX_HP = 100
interface PlayerTarget extends Damageable {
  hp: number
  lastDamageAt: number
  readonly position: THREE.Vector3
  readonly team: number
}
const playerTarget: PlayerTarget = {
  center: new THREE.Vector3(),
  get position() {
    return player.position
  },
  get alive() {
    // dead players are not targetable/hittable; outside matches hp resets
    return playerTarget.hp > 0
  },
  get team() {
    return online.active ? onlineTeam : 0
  },
  hp: MAX_HP,
  lastDamageAt: -Infinity,
  takeDamage(amount: number): boolean {
    if (online.active) {
      // online: the server owns HP — report own-grenade self-damage as a claim
      if (online.phase === 'combat' && onlineYouId) online.sendHit('grenade', amount, onlineYouId)
      return false
    }
    if (duel.active && (duel.frozen || playerTarget.hp <= 0)) return false
    playerTarget.hp = Math.max(0, playerTarget.hp - amount)
    playerTarget.lastDamageAt = elapsed
    audio.hurt()
    damageFlash = Math.min(1, damageFlash + amount / 50)
    if (playerTarget.hp <= 0) {
      if (duel.active) {
        addFeedEntry('<b>YOU</b> 사망')
        // the round continues while teammates are alive; the wipe check
        // in the game loop decides the round
        if (teamSize > 1 && allyBots.some((b) => b.alive)) {
          showBanner('사망', '아군의 승리를 기다리는 중…', 2.5)
        }
      } else {
        addFeedEntry('<b>YOU</b> 자폭했습니다')
        respawn()
      }
      return true
    }
    return false
  },
}

// player hitboxes so the bot's shots can land (updated per physics step)
const playerBodyHitbox = { entity: playerTarget as Damageable, part: 'body' as const, box: new THREE.Box3() }
const playerHeadHitbox = { entity: playerTarget as Damageable, part: 'head' as const, box: new THREE.Box3() }
physics.addHitbox(playerBodyHitbox)
physics.addHitbox(playerHeadHitbox)

function syncPlayerHitboxes() {
  const p = player.position
  const h = player.sliding ? 0.95 : 1.8
  const split = p.y + h * 0.78
  playerBodyHitbox.box.min.set(p.x - 0.35, p.y, p.z - 0.35)
  playerBodyHitbox.box.max.set(p.x + 0.35, split, p.z + 0.35)
  playerHeadHitbox.box.min.set(p.x - 0.2, split, p.z - 0.2)
  playerHeadHitbox.box.max.set(p.x + 0.2, p.y + h, p.z + 0.2)
}

function respawn() {
  player.spawn(map.spawns[0].position, map.spawns[0].yaw)
  playerTarget.hp = MAX_HP
  syncPlayerCenter()
}

function syncPlayerCenter() {
  // mass center follows the stance so bots aim at (and blasts measure to)
  // a point inside the actual hitbox even while sliding
  const h = player.sliding ? 0.95 : 1.8
  playerTarget.center.copy(player.position).y += h * 0.5
}
respawn()

// ---------- audio / combat ----------
const audio = new AudioEngine()
const effects = new Effects(scene, audio, () => camera.position)

const dummies: TargetDummy[] = []
// keep clear of the stair colliders (x ±8.45..12.95, z ±13..19) and crates
const dummySpots: [number, number, number][] = [
  [10, 0, -8],
  [-10, 0, -8],
  [18, 0, 3],
  [-18, 0, 3],
  [4, 2.4, 16],
  [-4, 2.4, -16],
]
for (let i = 0; i < dummySpots.length; i++) {
  const [x, y, z] = dummySpots[i]
  const dummy = new TargetDummy(`표적 ${i + 1}`, new THREE.Vector3(x, y, z), physics, effects, (d) => {
    addFeedEntry(`<b>YOU</b> ${d.name} 파괴`)
  })
  scene.add(dummy.group)
  dummies.push(dummy)
}

const projectiles = new ProjectileManager(
  scene,
  physics,
  effects,
  () => [...dummies, playerTarget, ...allyBots, ...enemyBots, ...remotePool],
  (target, damage, killed) => {
    if (target !== playerTarget) {
      showHitmarker(killed)
      audio.hit(killed)
      if (online.active) {
        const id = idByEntity.get(target)
        if (id) online.sendHit('grenade', damage, id)
      }
    }
  },
)

const weapons = new WeaponController(
  physics,
  player,
  camera,
  effects,
  projectiles,
  playerTarget,
  (info) => {
    showHitmarker(info.killed && info.isHead ? true : info.killed)
    audio.hit(info.killed)
    if (online.active) {
      const id = idByEntity.get(info.target)
      if (id) online.sendHit(weapons.weapon.id, info.damage, id)
    }
  },
  audio,
)

// online relays: tell the opponent about shots/grenades for their visuals
weapons.onFired = (weaponId) => {
  if (online.active && online.phase === 'combat') online.sendFire(weaponId)
}
weapons.onGrenadeThrown = (origin, dir) => {
  if (online.active && online.phase === 'combat') {
    online.sendGrenade([origin.x, origin.y, origin.z], [dir.x, dir.y, dir.z])
  }
}

// ---------- bot duel / team battles ----------
let teamSize = 1 // 1v1 .. 4v4; empty human slots are bots (local mode: all bots)
const ALLY_COLOR = 0x3f6fc9
const ENEMY_COLOR = 0xc94f4f

function makeBot(name: string, team: number, color: number, seed: number, getEnemies: () => import('./entities/bot').BotTarget[]): Bot {
  const b: Bot = new Bot(
    physics,
    effects,
    { name, team, color, seed },
    getEnemies,
    () => {
      /* target HP HUD reflects damage already */
    },
    (dead) => addFeedEntry(`<b>${dead.name}</b> 사망`),
    () => {
      // gunshot attenuated by distance to the listener
      const dist = player.position.distanceTo(b.controller.position)
      audio.shot('ar', Math.max(0.1, 0.7 * (1 - dist / 70)))
    },
  )
  scene.add(b.group)
  b.deactivate()
  return b
}

/** Enemies for a bot on `team` — local rosters offline, registry online. */
function enemiesOfTeam(team: number): import('./entities/bot').BotTarget[] {
  if (online.active) {
    const out: import('./entities/bot').BotTarget[] = []
    if (onlineTeam !== team) out.push(playerTarget)
    for (const e of onlineEntities.values()) {
      if (e.team === team) continue
      const entity = e.remote ?? e.bot
      if (entity) out.push(entity)
    }
    return out
  }
  return team === 0 ? enemyBots : [playerTarget, ...allyBots]
}

const allyBots: Bot[] = [0, 1, 2].map((i) => makeBot(`아군 ${i + 1}`, 0, ALLY_COLOR, 0xa110 + i, () => enemiesOfTeam(0)))
const enemyBots: Bot[] = [0, 1, 2, 3].map((i) => makeBot(`적 ${i + 1}`, 1, ENEMY_COLOR, 0xe4e0 + i, () => enemiesOfTeam(1)))

function aliveCounts(): { allies: number; enemies: number } {
  return {
    allies: (playerTarget.alive ? 1 : 0) + allyBots.filter((b) => b.alive).length,
    enemies: enemyBots.filter((b) => b.alive).length,
  }
}

let selectedDifficulty: Difficulty = 'normal'
let selectedPrimary = 'ar'
let selectedSecondary = 'pistol'
let selectedMap = 'random'
let fillBots = true // create-room: fill empty slots with bots
let bannerTimeout = 0

function showBanner(text: string, sub = '', seconds = 1) {
  bannerMain.textContent = text
  bannerSub.textContent = sub
  banner.classList.remove('hidden')
  window.clearTimeout(bannerTimeout)
  bannerTimeout = window.setTimeout(() => banner.classList.add('hidden'), seconds * 1000)
}

const duel = new DuelManager({
  onRoundStart: (round) => {
    respawn()
    weapons.setLoadout(selectedPrimary, selectedSecondary)
    // player + (teamSize-1) ally bots vs teamSize enemy bots
    for (let i = 0; i < allyBots.length; i++) {
      if (i < teamSize - 1) {
        allyBots[i].setDifficulty(selectedDifficulty)
        const sp = map.teamSpawns[0][i + 1]
        allyBots[i].reset(sp.position.clone(), sp.yaw)
      } else {
        allyBots[i].deactivate()
      }
    }
    for (let i = 0; i < enemyBots.length; i++) {
      if (i < teamSize) {
        enemyBots[i].setDifficulty(selectedDifficulty)
        const sp = map.teamSpawns[1][i]
        enemyBots[i].reset(sp.position.clone(), sp.yaw)
      } else {
        enemyBots[i].deactivate()
      }
    }
    projectiles.clear()
    if (round === 1) showLoadoutPanel(10) // pick window before the 3-2-1
  },
  onBanner: (text, sub, seconds) => {
    showBanner(text, sub, seconds)
    if (text === 'GO!') audio.go()
    else if (/^[123]$/.test(text)) audio.countdownBeep()
    else if (text === '승리!') audio.win()
    else if (text === '패배') audio.lose()
    else if (text === '라운드 승리!') audio.roundWin()
    else if (text === '라운드 패배') audio.roundLose()
  },
  onMatchEnd: () => {
    /* the manager returns to idle after its timer; cleanup happens below */
  },
})

function endDuelCleanup() {
  hideLoadoutPanel()
  for (const b of allyBots) b.deactivate()
  for (const b of enemyBots) b.deactivate()
  aliveRow.classList.add('hidden')
  weapons.allowCycling = true
  for (const d of dummies) d.setEnabled(true)
  projectiles.clear()
  playerTarget.hp = MAX_HP // don't carry a dead/damaged state into practice
  playerTarget.lastDamageAt = -Infinity
  scoreWrap.classList.add('hidden')
  botHpWrap.classList.add('hidden')
  if (document.pointerLockElement === canvas) document.exitPointerLock()
  else setPlaying(false)
}

function beginDuel() {
  loadMap(resolveMapId()) // pick the arena for this match
  for (const d of dummies) d.setEnabled(false)
  weapons.allowCycling = false // duel loadout is locked
  duel.startMatch()
  scoreWrap.classList.remove('hidden')
  botHpWrap.classList.remove('hidden')
}

// ---------- online team matches ----------
// pool of opponents/teammates rendered from snapshots (max 7 others in 4v4)
const remotePool: RemotePlayer[] = Array.from({ length: 7 }, () => {
  const r = new RemotePlayer(physics)
  scene.add(r.group)
  return r
})

interface OnlineEntity {
  team: number
  hp: number
  spawnIdx: number
  name: string
  remote?: RemotePlayer
  bot?: Bot
}

let onlineYouId = ''
let onlineTeam = 0
let onlineTeamSize = 1
let onlineDifficulty: Difficulty = 'normal'
let onlineIsHost = false
let mySpawnIdx = 0
let onlineMyHp = MAX_HP
let onlineScoreYou = 0
let onlineScoreEnemy = 0
let onlineRound = 0
let onlineGoRequested = false
let onlineFillRequested = false
let onlineSendTimer = 0
const onlineEntities = new Map<string, OnlineEntity>()
const idByEntity = new Map<Damageable, string>()
const onlineTimers: number[] = []
const tmpEye = new THREE.Vector3()
const tmpDir = new THREE.Vector3()

function setOnlineStatus(html: string, showGo = false, showFill = false) {
  onlineStatus.classList.remove('hidden')
  onlineStatusText.innerHTML = html
  onlineGoBtn.classList.toggle('hidden', !showGo)
  onlineFillBtn.classList.toggle('hidden', !showFill)
}

function clearOnlineTimers() {
  for (const id of onlineTimers) window.clearTimeout(id)
  onlineTimers.length = 0
}

function onlineAliveCounts(): { allies: number; enemies: number } {
  let allies = onlineMyHp > 0 ? 1 : 0
  let enemies = 0
  for (const e of onlineEntities.values()) {
    if (e.hp <= 0) continue
    if (e.team === onlineTeam) allies++
    else enemies++
  }
  return { allies, enemies }
}

function firstEnemyEntry(): [string, OnlineEntity] | null {
  let fallback: [string, OnlineEntity] | null = null
  for (const [id, e] of onlineEntities) {
    if (e.team === onlineTeam) continue
    if (e.hp > 0) return [id, e]
    fallback ??= [id, e]
  }
  return fallback
}

/** Build the roster: remotes for other humans (and bots when not hosting),
 * local Bot instances for bots when we are the host. */
function setupRoster(info: RosterInfo) {
  teardownRoster()
  loadMap(info.mapId) // server-chosen arena, identical for everyone
  onlineYouId = info.you
  onlineTeamSize = info.teamSize
  onlineDifficulty = (info.difficulty as Difficulty) ?? 'normal'
  onlineIsHost = info.you === info.hostId
  onlineTeam = info.players.find((p) => p.id === info.you)?.team ?? 0
  idByEntity.set(playerTarget, info.you)

  const teamIdx = [0, 0]
  const poolIdx = [0, 0] // host bot pools consumed per team
  let remoteIdx = 0
  let botNum = 1

  for (const p of info.players) {
    const spawnIdx = teamIdx[p.team]++
    if (p.id === info.you) {
      mySpawnIdx = spawnIdx
      continue
    }
    const r = remotePool[remoteIdx++]
    const nick = p.nick ?? p.id.toUpperCase()
    r.setAppearance(nick, p.team, p.team === onlineTeam ? ALLY_COLOR : ENEMY_COLOR, p.team === onlineTeam)
    onlineEntities.set(p.id, { team: p.team, hp: MAX_HP, spawnIdx, name: nick, remote: r })
    idByEntity.set(r, p.id)
  }
  for (const b of info.bots) {
    const spawnIdx = teamIdx[b.team]++
    const name = `BOT ${botNum++}`
    if (onlineIsHost) {
      // the host runs the actual bot AI from the local pools (team 0 = ally
      // pool since the host/creator is always team 0) and relays its state
      const bot = b.team === 0 ? allyBots[poolIdx[0]++] : enemyBots[poolIdx[1]++]
      bot.serverControlledHp = true
      bot.damageSink = (target, damage, _isHead, botRef) => {
        const targetId = idByEntity.get(target)
        const attackerId = idByEntity.get(botRef)
        if (targetId && attackerId) online.sendHit('ar', damage, targetId, attackerId)
      }
      bot.onFiredRelay = (botRef) => {
        const attackerId = idByEntity.get(botRef)
        if (attackerId) online.sendFire('ar', attackerId)
      }
      onlineEntities.set(b.id, { team: b.team, hp: MAX_HP, spawnIdx, name, bot })
      idByEntity.set(bot, b.id)
    } else {
      const r = remotePool[remoteIdx++]
      r.setAppearance(name, b.team, b.team === onlineTeam ? ALLY_COLOR : ENEMY_COLOR, b.team === onlineTeam)
      onlineEntities.set(b.id, { team: b.team, hp: MAX_HP, spawnIdx, name, remote: r })
      idByEntity.set(r, b.id)
    }
  }

  // position everyone at their team spawns now, so a mid-match reconnect
  // (roster re-sent) drops them back in place with entities live rather than at
  // the origin / frozen; the round countdown re-spawns everyone on a normal
  // start, so this is redundant there but harmless
  const mySp = map.teamSpawns[onlineTeam]?.[mySpawnIdx]
  if (mySp) player.spawn(mySp.position, mySp.yaw)
  for (const e of onlineEntities.values()) {
    const sp = map.teamSpawns[e.team]?.[e.spawnIdx]
    if (!sp) continue
    if (e.remote) e.remote.activate(sp.position, sp.yaw)
    if (e.bot) {
      e.bot.setDifficulty(onlineDifficulty)
      e.bot.reset(sp.position.clone(), sp.yaw)
      e.bot.serverControlledHp = true
    }
  }
}

function teardownRoster() {
  for (const e of onlineEntities.values()) {
    e.remote?.deactivate()
    if (e.bot) {
      e.bot.serverControlledHp = false
      e.bot.damageSink = undefined
      e.bot.onFiredRelay = undefined
      e.bot.deactivate()
    }
  }
  onlineEntities.clear()
  idByEntity.clear()
}

function handleOnlineRound(info: RoundInfo) {
  onlineRound = info.round
  onlineScoreYou = info.scoreYou
  onlineScoreEnemy = info.scoreEnemy
  onlineMyHp = info.hps[onlineYouId] ?? MAX_HP
  playerTarget.hp = onlineMyHp
  clearOnlineTimers()

  if (info.phase === 'countdown') {
    for (const d of dummies) d.setEnabled(false)
    weapons.allowCycling = false // online loadout is locked
    const mySp = map.teamSpawns[onlineTeam][mySpawnIdx]
    player.spawn(mySp.position, mySp.yaw)
    weapons.setLoadout(selectedPrimary, selectedSecondary)
    projectiles.clear()
    for (const e of onlineEntities.values()) {
      e.hp = MAX_HP
      const sp = map.teamSpawns[e.team][e.spawnIdx]
      if (e.remote) e.remote.activate(sp.position, sp.yaw)
      if (e.bot) {
        e.bot.setDifficulty(onlineDifficulty)
        e.bot.reset(sp.position.clone(), sp.yaw)
        e.bot.serverControlledHp = true
      }
    }
    scoreWrap.classList.remove('hidden')
    // round 1 opens with a 10s loadout window (server countdown is 13s);
    // later rounds go straight into the local 3-2-1 display
    const pickOffset = info.round === 1 ? 10000 : 0
    if (info.round === 1) showLoadoutPanel(10)
    for (const [delay, label] of [
      [0, '3'],
      [1000, '2'],
      [2000, '1'],
    ] as const) {
      onlineTimers.push(
        window.setTimeout(() => {
          showBanner(label, `라운드 ${info.round}`, 0.95)
          audio.countdownBeep()
        }, pickOffset + delay),
      )
    }
  } else if (info.phase === 'combat') {
    hideLoadoutPanel()
    showBanner('GO!', '', 0.7)
    audio.go()
  } else if (info.phase === 'roundEnd') {
    if (info.draw) {
      showBanner('무승부', `${info.scoreYou} : ${info.scoreEnemy}`, 2)
      audio.roundLose()
    } else {
      showBanner(info.youWon ? '라운드 승리!' : '라운드 패배', `${info.scoreYou} : ${info.scoreEnemy}`, 2)
      if (info.youWon) audio.roundWin()
      else audio.roundLose()
    }
  } else if (info.phase === 'matchEnd') {
    showBanner(info.youWon ? '승리!' : '패배', `${info.scoreYou} : ${info.scoreEnemy}`, 3.5)
    if (info.youWon) audio.win()
    else audio.lose()
  }
}

function endOnlineCleanup() {
  hideLoadoutPanel()
  clearOnlineTimers()
  online.leave()
  teardownRoster()
  weapons.allowCycling = true
  for (const d of dummies) d.setEnabled(true)
  projectiles.clear()
  playerTarget.hp = MAX_HP
  playerTarget.lastDamageAt = -Infinity
  scoreWrap.classList.add('hidden')
  botHpWrap.classList.add('hidden')
  aliveRow.classList.add('hidden')
  onlineStatus.classList.add('hidden')
  onlineGoBtn.classList.add('hidden')
  onlineFillBtn.classList.add('hidden')
  lobbyEl.classList.remove('hidden') // back to the room browser
  refreshRooms()
  if (document.pointerLockElement === canvas) document.exitPointerLock()
  else if (playing) setPlaying(false)
}

function renderLobby(info: LobbyInfo) {
  const cap = info.teamSize * 2
  const label = (team: number) =>
    info.players
      .filter((p) => p.team === team)
      .map((p) => `${p.id === info.you ? `${p.nick}(나)` : p.nick}${p.id === info.hostId ? '👑' : ''}${p.ready ? ' ✓' : ''}`)
      .join(', ') || '—'
  const me = info.players.find((p) => p.id === info.you)
  const fillNote = info.fillBots === false ? '봇 없음 (정원이 차면 시작)' : '빈자리는 봇'
  const isHost = info.you === info.hostId
  const notFull = info.players.length < cap
  setOnlineStatus(
    `방 <b>${info.code}</b> (${info.teamSize}v${info.teamSize}) · 맵: ${mapById(info.mapId).name} · ${info.players.length}/${cap}명 · ${fillNote}<br/>` +
      `<span style="color:#57d38c">팀 A: ${label(0)}</span> · <span style="color:#ff5a3c">팀 B: ${label(1)}</span>`,
    !(me?.ready ?? false),
    isHost && notFull, // host can fill the shortage with bots and start now
  )
}

const online = new OnlineManager({
  onCreated: (code) => {
    lobbyEl.classList.add('hidden') // hide the browser while in a room
    // creator is always host and alone (not full) → offer immediate bot-fill
    setOnlineStatus(`방 코드: <b>${code}</b> — 참가자 대기 중…`, true, true)
  },
  onLobby: (info) => {
    lobbyEl.classList.add('hidden')
    renderLobby(info)
  },
  onRoster: setupRoster,
  onRound: handleOnlineRound,
  onHp: (id, hp) => {
    if (id === onlineYouId) {
      if (hp < onlineMyHp) {
        audio.hurt()
        damageFlash = Math.min(1, damageFlash + (onlineMyHp - hp) / 50)
      }
      const wasAlive = onlineMyHp > 0
      onlineMyHp = hp
      playerTarget.hp = hp
      if (hp <= 0 && wasAlive) {
        addFeedEntry('<b>YOU</b> 사망')
        const { allies } = onlineAliveCounts()
        if (allies > 0) showBanner('사망', '아군의 승리를 기다리는 중…', 2.5)
      }
      return
    }
    const e = onlineEntities.get(id)
    if (!e) return
    const wasAlive = e.hp > 0
    e.hp = hp
    if (e.remote) {
      if (hp <= 0 && wasAlive) {
        effects.puff(e.remote.center, 0xc94f4f)
        e.remote.deactivate()
        addFeedEntry(`<b>${e.name}</b> 사망`)
      }
    } else if (e.bot) {
      e.bot.applyServerHp(hp) // die() handles the puff + feed via onDied
    }
  },
  onPeerState: (id, snap) => onlineEntities.get(id)?.remote?.pushSnapshot(snap),
  onPeerFire: (id, weaponId) => {
    const r = onlineEntities.get(id)?.remote
    if (!r?.alive) return
    r.eyePosition(tmpEye)
    tmpDir.set(-Math.sin(r.yaw) * Math.cos(r.pitch), Math.sin(r.pitch), -Math.cos(r.yaw) * Math.cos(r.pitch))
    const hit = physics.raycast(tmpEye, tmpDir, 150)
    const end = hit ? hit.point : tmpEye.clone().addScaledVector(tmpDir, 150)
    effects.tracer(tmpEye.clone().addScaledVector(tmpDir, 0.6), end)
    const dist = player.position.distanceTo(r.position)
    audio.shot(weaponId, Math.max(0.15, 0.8 * (1 - dist / 70)))
  },
  onPeerGrenade: (_id, origin, dir) => {
    // visual-only: damage authority stays with the thrower's claims
    projectiles.throwGrenade(new THREE.Vector3(...origin), new THREE.Vector3(...dir), WEAPONS.grenade.range, 0)
  },
  onRoomList: (rooms) => renderRooms(rooms),
  onError: (reason) => {
    setOnlineStatus(reason === 'no-room' ? '방을 찾을 수 없습니다 (코드/정원 확인)' : '서버 오류가 발생했습니다')
  },
  onReconnecting: () => {
    if (playing) showBanner('연결 끊김 · 재접속 중…', '', 6)
    else setOnlineStatus('연결이 끊겼습니다 · 재접속 중…')
  },
  onDisconnect: (reason) => {
    if (reason === 'peer-left') addFeedEntry('플레이어가 나가 방이 종료되었습니다')
    else if (reason === 'host-left') addFeedEntry('방장이 나가 방이 종료되었습니다')
    else if (reason === 'reconnect-failed') addFeedEntry('재접속에 실패했습니다')
    endOnlineCleanup()
  },
})

function setFillBots(on: boolean) {
  fillBots = on
  fillBotsBtn.classList.toggle('on', on)
  fillBotsBtn.textContent = on ? '봇으로 채우기' : '사람만 (봇 없음)'
  botDiffRow.classList.toggle('hidden', !on)
}

// 방 만들기 opens the config panel; the actual create happens on 만들기
onlineCreateBtn.addEventListener('click', () => {
  if (online.active) return
  audio.ensure()
  lobbyEl.classList.add('hidden')
  createPanel.classList.remove('hidden')
})

fillBotsBtn.addEventListener('click', () => setFillBots(!fillBots))

createCancelBtn.addEventListener('click', () => {
  createPanel.classList.add('hidden')
  lobbyEl.classList.remove('hidden')
})

// free-tier servers sleep after idle; report the wake-up while retrying
function wakingStatus(attempt: number, max: number) {
  setOnlineStatus(`무료 서버를 깨우는 중… 잠시만요 (${attempt}/${max})`)
}

createConfirmBtn.addEventListener('click', async () => {
  if (online.active) return
  createPanel.classList.add('hidden')
  audio.ensure()
  setOnlineStatus('서버 연결 중…')
  try {
    await online.create(defaultServerUrl(), teamSize, resolveMapId(), fillBots, selectedDifficulty, wakingStatus)
  } catch (e) {
    if ((e as Error).message !== 'cancelled') setOnlineStatus('서버에 연결할 수 없습니다 (잠시 후 다시 시도해주세요)')
  }
})

onlineJoinBtn.addEventListener('click', async () => {
  if (online.active) return
  const code = onlineCodeInput.value.trim().toUpperCase()
  if (code.length !== 4) return setOnlineStatus('4자리 방 코드를 입력하세요')
  audio.ensure()
  setOnlineStatus('입장 중…')
  try {
    await online.join(defaultServerUrl(), code, wakingStatus)
  } catch (e) {
    if ((e as Error).message !== 'cancelled') setOnlineStatus('서버에 연결할 수 없습니다 (잠시 후 다시 시도해주세요)')
  }
})

onlineGoBtn.addEventListener('click', () => {
  onlineGoRequested = true
  void startGame()
})

onlineFillBtn.addEventListener('click', () => {
  onlineFillRequested = true
  void startGame()
})

onlineCancelBtn.addEventListener('click', () => {
  online.leave()
  teardownRoster()
  onlineStatus.classList.add('hidden')
  onlineGoBtn.classList.add('hidden')
  onlineFillBtn.classList.add('hidden')
  lobbyEl.classList.remove('hidden')
  refreshRooms() // reconnect + re-list after leaving a room
})

// ---------- nickname gate + room browser ----------
const NICK_KEY = 'rifle-gg-nick'
let roomPollTimer = 0

function renderRooms(rooms: import('./net/online').RoomSummary[]) {
  if (rooms.length === 0) {
    roomsList.innerHTML = '<div class="rooms-empty">열린 방이 없습니다 · 방을 만들어보세요</div>'
    return
  }
  roomsList.innerHTML = ''
  for (const r of rooms) {
    const el = document.createElement('div')
    el.className = 'room-item'
    const mapName = mapById(r.mapId).name
    const botTag = r.fillBots === false ? ' · 봇 없음' : ' · 봇'
    el.innerHTML =
      `<span class="r-host">${escapeHtml(r.host)}</span>` +
      `<span class="r-meta">${r.teamSize}v${r.teamSize} · ${mapName} · ${r.count}/${r.cap}${botTag}</span>` +
      `<button class="r-join">참가</button>`
    el.querySelector('.r-join')!.addEventListener('click', () => joinRoom(r.code))
    roomsList.appendChild(el)
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]!)
}

function refreshRooms() {
  if (online.active) return
  if (roomsList.querySelector('.room-item') === null) {
    roomsList.innerHTML = '<div class="rooms-empty">서버 연결 중… (무료 서버는 첫 접속에 최대 ~30초)</div>'
  }
  const onWaking = (attempt: number, max: number) => {
    if (online.active) return
    roomsList.innerHTML = `<div class="rooms-empty">무료 서버를 깨우는 중… (${attempt}/${max})</div>`
  }
  online.browse(defaultServerUrl(), onWaking).catch(() => {
    roomsList.innerHTML = '<div class="rooms-empty">서버에 연결할 수 없습니다 · 새로고침을 눌러 다시 시도하세요</div>'
  })
}

async function joinRoom(code: string) {
  if (online.active) return
  audio.ensure()
  setOnlineStatus('입장 중…')
  try {
    await online.join(defaultServerUrl(), code, wakingStatus)
  } catch (e) {
    if ((e as Error).message !== 'cancelled') setOnlineStatus('입장에 실패했습니다')
  }
}

function enterLobby(nick: string) {
  const clean = nick.trim().slice(0, 12) || '플레이어'
  online.nick = clean
  try {
    localStorage.setItem(NICK_KEY, clean)
  } catch {
    /* private mode */
  }
  lobbyNick.textContent = clean
  nickGate.classList.add('hidden')
  lobbyEl.classList.remove('hidden')
  refreshRooms()
  // poll the room list while the lobby is on screen and we're not in a room
  window.clearInterval(roomPollTimer)
  roomPollTimer = window.setInterval(() => {
    if (!lobbyEl.classList.contains('hidden') && !online.active) online.list()
  }, 4000)
}

nickEnterBtn.addEventListener('click', () => enterLobby(nickInput.value))
nickInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') enterLobby(nickInput.value)
})
nickChangeBtn.addEventListener('click', () => {
  lobbyEl.classList.add('hidden')
  nickGate.classList.remove('hidden')
  nickInput.focus()
})
roomsRefreshBtn.addEventListener('click', refreshRooms)

// returning players skip the gate; prefill the input either way
const savedNick = (() => {
  try {
    return localStorage.getItem(NICK_KEY) ?? ''
  } catch {
    return ''
  }
})()
if (savedNick) {
  nickInput.value = savedNick
  enterLobby(savedNick)
}

// ---------- scoreboard (hold Tab on desktop, tap the pips on touch) ----------
interface SbRow {
  name: string
  alive: boolean
}

function scoreboardRows(): { allies: SbRow[]; enemies: SbRow[]; score: string } | null {
  if (duel.active) {
    const allies: SbRow[] = [{ name: 'YOU', alive: playerTarget.hp > 0 }]
    for (let i = 0; i < teamSize - 1; i++) allies.push({ name: allyBots[i].name, alive: allyBots[i].alive })
    const enemies: SbRow[] = []
    for (let i = 0; i < teamSize; i++) enemies.push({ name: enemyBots[i].name, alive: enemyBots[i].alive })
    return { allies, enemies, score: `${duel.playerScore} : ${duel.botScore}` }
  }
  if (online.active && onlineEntities.size > 0) {
    const allies: SbRow[] = [{ name: 'YOU', alive: onlineMyHp > 0 }]
    const enemies: SbRow[] = []
    for (const e of onlineEntities.values()) {
      ;(e.team === onlineTeam ? allies : enemies).push({ name: e.name, alive: e.hp > 0 })
    }
    return { allies, enemies, score: `${onlineScoreYou} : ${onlineScoreEnemy}` }
  }
  return null
}

function renderScoreboard() {
  const data = scoreboardRows()
  if (!data) return false
  sbScore.textContent = data.score
  const fill = (ul: HTMLUListElement, rows: SbRow[]) => {
    ul.innerHTML = rows
      .map((r) => `<li class="${r.alive ? '' : 'dead'}"><span>${r.name}</span><span>${r.alive ? '생존' : '사망'}</span></li>`)
      .join('')
  }
  fill(sbTeamA, data.allies)
  fill(sbTeamB, data.enemies)
  return true
}

function setScoreboardVisible(v: boolean) {
  if (v && !renderScoreboard()) return
  scoreboard.classList.toggle('hidden', !v)
}

window.addEventListener('keydown', (e) => {
  if (e.code !== 'Tab' || e.repeat) return
  e.preventDefault()
  if (playing) setScoreboardVisible(true)
})
window.addEventListener('keyup', (e) => {
  if (e.code === 'Tab') setScoreboardVisible(false)
})
aliveRow.addEventListener('click', () => {
  setScoreboardVisible(scoreboard.classList.contains('hidden'))
})

// ---------- HUD helpers ----------
function showHitmarker(kill: boolean) {
  hitmarker.classList.remove('show', 'kill')
  void hitmarker.offsetWidth // restart the CSS animation
  if (kill) hitmarker.classList.add('kill')
  hitmarker.classList.add('show')
}

function addFeedEntry(html: string) {
  const el = document.createElement('div')
  el.className = 'feed-entry'
  el.innerHTML = html
  killfeed.appendChild(el)
  while (killfeed.children.length > 5) killfeed.firstChild?.remove()
  setTimeout(() => el.remove(), 3000)
}

function updateHud() {
  dashFill.style.width = `${player.dashCharge * 100}%`

  const hpShown = online.active ? onlineMyHp : playerTarget.hp
  hpFill.style.width = `${(hpShown / MAX_HP) * 100}%`
  hpFill.classList.toggle('low', hpShown <= 30)
  hpNum.textContent = String(Math.round(hpShown))

  const w = weapons.weapon
  if (w.kind === 'melee') {
    ammoMag.textContent = '—'
    ammoMax.textContent = ''
  } else {
    ammoMag.textContent = weapons.isReloading ? '장전중' : String(weapons.ammoInMag)
    ammoMax.textContent = `/ ${w.magazine}`
  }
  ammoMag.classList.toggle('reloading', weapons.isReloading)
  weaponName.textContent = w.name

  for (let i = 0; i < slotEls.length; i++) {
    slotEls[i].textContent = String(i + 1)
    slotEls[i].classList.toggle('active', w.slot === SLOT_ORDER[i])
  }
  for (let i = 0; i < touchSlotEls.length; i++) {
    touchSlotEls[i].classList.toggle('active', w.slot === SLOT_ORDER[i])
  }

  crosshair.style.setProperty('--gap', `${weapons.crosshairGap.toFixed(1)}px`)
  crosshair.style.display = weapons.aiming && w.id === 'sniper' ? 'none' : ''

  if (!scoreboard.classList.contains('hidden')) renderScoreboard()

  // the zoom button is sniper-only (AR keeps right-click ADS on desktop)
  const hasZoom = w.id === 'sniper'
  btnAds.classList.toggle('hidden', !hasZoom)
  if (!hasZoom && adsToggled) setAdsToggle(false)

  if (duel.active) {
    scorePlayer.textContent = String(duel.playerScore)
    scoreBot.textContent = String(duel.botScore)
    if (teamSize === 1) {
      botHpWrap.classList.remove('hidden')
      aliveRow.classList.add('hidden')
      botHpFill.style.width = `${Math.max(0, enemyBots[0].hp)}%`
    } else {
      botHpWrap.classList.add('hidden')
      aliveRow.classList.remove('hidden')
      const { allies, enemies } = aliveCounts()
      aliveAllies.textContent = '●'.repeat(allies) + '○'.repeat(Math.max(0, teamSize - allies))
      aliveEnemies.textContent = '●'.repeat(enemies) + '○'.repeat(Math.max(0, teamSize - enemies))
    }
  } else if (online.active) {
    scorePlayer.textContent = String(onlineScoreYou)
    scoreBot.textContent = String(onlineScoreEnemy)
    if (onlineTeamSize === 1) {
      botHpWrap.classList.remove('hidden')
      aliveRow.classList.add('hidden')
      botHpFill.style.width = `${Math.max(0, firstEnemyEntry()?.[1].hp ?? 0)}%`
    } else {
      botHpWrap.classList.add('hidden')
      aliveRow.classList.remove('hidden')
      const { allies, enemies } = onlineAliveCounts()
      aliveAllies.textContent = '●'.repeat(allies) + '○'.repeat(Math.max(0, onlineTeamSize - allies))
      aliveEnemies.textContent = '●'.repeat(enemies) + '○'.repeat(Math.max(0, onlineTeamSize - enemies))
    }
  }
}

// ---------- touch controls ----------
const btnAds = document.querySelector<HTMLButtonElement>('#btn-ads')!
const pauseOverlay = document.querySelector<HTMLDivElement>('#pause-overlay')!
let adsToggled = false

function setAdsToggle(on: boolean) {
  adsToggled = on
  if (on) input.virtualDown('Mouse2')
  else input.virtualUp('Mouse2')
  btnAds.classList.toggle('active', on)
}

if (touchMode) {
  const touch = new TouchControls(
    input,
    document.querySelector('#touch-move-zone')!,
    document.querySelector('#touch-look-zone')!,
    document.querySelector('#joy-base')!,
    document.querySelector('#joy-knob')!,
  )
  touch.bindButton(document.querySelector('#btn-jump')!, 'Space')
  touch.bindButton(document.querySelector('#btn-dash')!, 'ShiftLeft')
  touch.bindButton(document.querySelector('#btn-slide')!, 'KeyC')
  // the fire button also steers the view while held (drag-to-aim)
  touch.bindFireButton(document.querySelector('#btn-fire')!, 'Mouse0')
  touch.bindButton(document.querySelector('#btn-reload')!, 'KeyR')
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.slot-btn')) {
    touch.bindButton(btn, btn.dataset.key!)
  }
  // ADS is tap-to-toggle on touch: holding a button ties up a whole finger
  btnAds.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    setAdsToggle(!adsToggled)
  })
  // pause asks for confirmation instead of instantly quitting the match
  document.querySelector('#btn-pause')!.addEventListener('click', () => {
    pauseOverlay.classList.remove('hidden')
  })
}

document.querySelector('#pause-resume-btn')!.addEventListener('click', () => {
  pauseOverlay.classList.add('hidden')
  // desktop pause released pointer lock; resume needs to re-acquire it
  if (!touchMode && !playing) void startGame()
})
document.querySelector('#pause-quit-btn')!.addEventListener('click', () => {
  pauseOverlay.classList.add('hidden')
  setPlaying(false)
})
window.addEventListener('contextmenu', (e) => e.preventDefault())

// ---------- play state / pointer lock ----------
let playing = false

function setPlaying(p: boolean) {
  playing = p
  menu.classList.toggle('hidden', p)
  hud.classList.toggle('hidden', !p)
  document.body.classList.toggle('playing', p) // gates the rotate overlay
  scoreboard.classList.add('hidden')
  if (touchMode && !p) {
    // back to the menu: release the landscape lock so portrait works again
    try {
      ;(screen.orientation as ScreenOrientation & { unlock?: () => void }).unlock?.()
    } catch {
      /* not supported — fine */
    }
  }
  input.releaseAll()
  setAdsToggle(false) // releaseAll dropped the virtual key; keep UI in sync
  pauseOverlay.classList.add('hidden')
  if (p && pendingDuel && !duel.active) {
    pendingDuel = false
    beginDuel()
  }
  if (p && onlineFillRequested) {
    onlineFillRequested = false
    onlineGoRequested = false // fill implies ready+start
    online.fillStart()
    showBanner('빈자리를 봇으로 채우는 중…', '', 2.5)
  } else if (p && onlineGoRequested) {
    onlineGoRequested = false
    online.ready()
    showBanner('상대 준비 대기 중…', '', 3)
  }
  if (!p) {
    weapons.resetAds() // don't leave the menu zoomed in
    if (duel.active) {
      duel.stop()
      endDuelCleanup()
    }
    if (online.active) endOnlineCleanup() // leaving the game exits the match
  }
}

let pendingDuel = false

// ---------- settings ----------
const settings = loadSettings()

function applySettings() {
  player.sensitivity = 0.0023 * settings.sensitivity
  audio.setVolume(settings.volume)
  weapons.setBaseFov(settings.fov) // respects an active ADS zoom
}

function wireSettingSlider(
  inputId: string,
  valueId: string,
  get: () => number,
  set: (v: number) => void,
  format: (v: number) => string,
) {
  const input = document.querySelector<HTMLInputElement>(inputId)!
  const label = document.querySelector<HTMLSpanElement>(valueId)!
  input.value = String(get())
  label.textContent = format(get())
  input.addEventListener('input', () => {
    set(Number(input.value))
    label.textContent = format(get())
    applySettings()
    saveSettings(settings)
  })
}

wireSettingSlider('#set-sens', '#set-sens-val', () => settings.sensitivity, (v) => (settings.sensitivity = v), (v) => `${v.toFixed(2)}x`)
wireSettingSlider('#set-vol', '#set-vol-val', () => settings.volume, (v) => (settings.volume = v), (v) => `${Math.round(v * 100)}%`)
wireSettingSlider('#set-fov', '#set-fov-val', () => settings.fov, (v) => (settings.fov = v), (v) => `${v}°`)
applySettings()

async function startGame() {
  audio.ensure() // AudioContext requires a user gesture
  if (touchMode) {
    // best effort: fullscreen + landscape lock (not available on iOS Safari,
    // where the portrait rotate-overlay is the fallback)
    try {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
      type LockableOrientation = ScreenOrientation & { lock?: (o: string) => Promise<void> }
      await (screen.orientation as LockableOrientation).lock?.('landscape')
    } catch {
      /* unsupported — overlay handles portrait */
    }
    setPlaying(true)
    return
  }
  // requestPointerLock rejects if called too soon after Esc (browser cooldown)
  try {
    const result = canvas.requestPointerLock() as unknown
    if (result instanceof Promise) result.catch(() => {})
  } catch {
    /* ignore; user can click again */
  }
}

// menu option toggles (difficulty / loadout)
function wireToggleGroup(selector: string, onPick: (id: string) => void) {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>(selector)]
  for (const btn of buttons) {
    btn.addEventListener('click', () => {
      for (const b of buttons) b.classList.remove('active')
      btn.classList.add('active')
      onPick(btn.dataset.diff ?? btn.dataset.id ?? '')
    })
  }
}
wireToggleGroup('.diff-btn', (id) => (selectedDifficulty = id as Difficulty))
wireToggleGroup('.size-btn', (id) => (teamSize = Math.max(1, Math.min(4, Number(id) || 1))))
wireToggleGroup('.map-btn', (id) => (selectedMap = id))

/** Resolve the menu map choice ('random' → a concrete map id). */
function resolveMapId(): string {
  if (selectedMap !== 'random') return selectedMap
  return MAPS[Math.floor(Math.random() * MAPS.length)].id
}
wireToggleGroup('.primary-btn', (id) => {
  selectedPrimary = id
  applyLoadoutPick()
})
wireToggleGroup('.secondary-btn', (id) => {
  selectedSecondary = id
  applyLoadoutPick()
})

// ---------- in-match loadout pick (round 1 countdown) ----------
let loadoutHideTimer = 0

function applyLoadoutPick() {
  // picks apply instantly while the selection window is open
  if (!loadoutPanel.classList.contains('hidden')) {
    weapons.setLoadout(selectedPrimary, selectedSecondary)
  }
}

function showLoadoutPanel(seconds: number) {
  loadoutPanel.classList.remove('hidden')
  window.clearTimeout(loadoutHideTimer)
  loadoutHideTimer = window.setTimeout(hideLoadoutPanel, seconds * 1000)
}

function hideLoadoutPanel() {
  window.clearTimeout(loadoutHideTimer)
  loadoutPanel.classList.add('hidden')
}

// number keys 1-5 pick weapons while the panel is open (pointer is locked)
const LOADOUT_KEYS: Record<string, { kind: 'p' | 's'; id: string }> = {
  Digit1: { kind: 'p', id: 'ar' },
  Digit2: { kind: 'p', id: 'shotgun' },
  Digit3: { kind: 'p', id: 'sniper' },
  Digit4: { kind: 's', id: 'pistol' },
  Digit5: { kind: 's', id: 'uzi' },
}
window.addEventListener('keydown', (e) => {
  if (loadoutPanel.classList.contains('hidden')) return
  const pick = LOADOUT_KEYS[e.code]
  if (!pick) return
  const selector = pick.kind === 'p' ? '.primary-btn' : '.secondary-btn'
  for (const btn of document.querySelectorAll<HTMLButtonElement>(selector)) {
    btn.classList.toggle('active', btn.dataset.id === pick.id)
  }
  if (pick.kind === 'p') selectedPrimary = pick.id
  else selectedSecondary = pick.id
  applyLoadoutPick()
  audio.weaponSwitch?.()
})

document.addEventListener('pointerlockchange', () => {
  if (touchMode) return
  const locked = document.pointerLockElement === canvas
  if (locked) {
    pauseOverlay.classList.add('hidden')
    setPlaying(true)
    return
  }
  // Esc during a match pauses instead of forfeiting; the sim freezes
  // (playing=false) and 계속하기 re-locks the pointer
  if (playing && (duel.active || online.active)) {
    playing = false
    hud.classList.add('hidden')
    input.releaseAll()
    setAdsToggle(false)
    weapons.resetAds()
    pauseOverlay.classList.remove('hidden')
  } else if (playing) {
    setPlaying(false)
  }
})

// mouse wheel steps weapon slots (desktop)
window.addEventListener(
  'wheel',
  (e) => {
    if (document.pointerLockElement !== canvas) return
    if (e.deltaY !== 0) input.pressOnce(e.deltaY > 0 ? 'WheelDown' : 'WheelUp')
  },
  { passive: true },
)

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === canvas) {
    input.addMouseDelta(e.movementX, e.movementY)
  }
})

// ---------- resize ----------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

// ---------- game loop ----------
// Physics runs on a fixed timestep so game speed is identical at any frame
// rate; rendering samples the latest physics state.
const PHYSICS_STEP = 1 / 120
const MAX_STEPS_PER_FRAME = 10 // below ~12fps the game slows instead of spiraling
const HP_REGEN_DELAY = 5
const HP_REGEN_PER_SECOND = 12
let lastTime = performance.now()
let accumulator = 0
let elapsed = 0
let damageFlash = 0

// movement-sound state (transitions detected frame to frame)
let prevGrounded = true
let prevSliding = false
let prevDashCharge = 1
let footstepDist = 0

let prevVy = 0

function updateMovementSounds(dt: number) {
  const speed = Math.hypot(player.velocity.x, player.velocity.z)
  // require a real fall so a respawn's grounded=false reset doesn't thud
  if (!prevGrounded && player.grounded && prevVy < -3) audio.land()
  if (prevGrounded && !player.grounded && player.velocity.y > 2) audio.jump()
  if (!prevSliding && player.sliding) audio.slide()
  if (player.dashCharge < prevDashCharge - 0.4) audio.dash()
  if (player.grounded && !player.sliding && speed > 3) {
    footstepDist += speed * dt
    if (footstepDist > 2.7) {
      footstepDist = 0
      audio.footstep()
    }
  } else {
    footstepDist = 0
  }
  prevGrounded = player.grounded
  prevSliding = player.sliding
  prevDashCharge = player.dashCharge
  prevVy = player.velocity.y
}

function frame(now: number) {
  const dt = Math.min((now - lastTime) / 1000, 0.25)
  lastTime = now

  if (playing) {
    player.look(input, dt) // mouse look once per frame, not per physics step
    input.clearMouse()
    accumulator += dt
    let steps = 0
    const duelWasActive = duel.active
    while (accumulator >= PHYSICS_STEP && steps < MAX_STEPS_PER_FRAME) {
      elapsed += PHYSICS_STEP
      duel.update(PHYSICS_STEP)
      const frozen = (duel.active && duel.frozen) || (online.active && online.frozen)
      if (!frozen) {
        // a dead player spectates until the team round resolves
        const playerDead = (duel.active || online.active) && playerTarget.hp <= 0
        if (!playerDead) {
          player.update(PHYSICS_STEP, input)
          syncPlayerCenter() // explosions this step must see the current position
          syncPlayerHitboxes()
          weapons.update(PHYSICS_STEP, input)
        }
        projectiles.update(PHYSICS_STEP)
        if (duel.active) {
          for (const b of allyBots) b.update(PHYSICS_STEP)
          for (const b of enemyBots) b.update(PHYSICS_STEP)
          // team elimination decides the round
          if (duel.state === 'combat') {
            const { allies, enemies } = aliveCounts()
            // check the mutual-wipe case first so a suicide-trade isn't a win
            if (enemies === 0 && allies === 0) duel.roundDraw()
            else if (enemies === 0) duel.roundWon(true)
            else if (allies === 0) duel.roundWon(false)
          }
        } else if (online.active && onlineIsHost) {
          // the host simulates the fill bots (the server owns their HP)
          for (const e of onlineEntities.values()) e.bot?.update(PHYSICS_STEP)
        }
        // out-of-combat regen (practice only — duel rounds reset HP instead,
        // and regen would reward stalling behind cover)
        if (!duel.active && !online.active && playerTarget.hp < MAX_HP && elapsed - playerTarget.lastDamageAt > HP_REGEN_DELAY) {
          playerTarget.hp = Math.min(MAX_HP, playerTarget.hp + HP_REGEN_PER_SECOND * PHYSICS_STEP)
        }
      }
      accumulator -= PHYSICS_STEP
      steps++
    }
    if (duelWasActive && !duel.active) endDuelCleanup() // match finished

    // online: animate remotes every frame; stream our state (and, as host,
    // the simulated bots' states) at ~20Hz
    if (online.active) {
      for (const e of onlineEntities.values()) e.remote?.update(dt)
      onlineSendTimer += dt
      if (onlineSendTimer >= 0.05) {
        onlineSendTimer = 0
        online.sendState({
          x: player.position.x,
          y: player.position.y,
          z: player.position.z,
          yaw: player.yaw,
          pitch: player.pitch,
          sliding: player.sliding,
        })
        if (onlineIsHost) {
          for (const [id, e] of onlineEntities) {
            if (!e.bot || !e.bot.alive) continue
            const p = e.bot.controller.position
            online.sendState(
              {
                x: p.x,
                y: p.y,
                z: p.z,
                yaw: e.bot.controller.yaw,
                pitch: e.bot.controller.pitch,
                sliding: e.bot.controller.sliding,
              },
              id,
            )
          }
        }
      }
    }
    if (steps === MAX_STEPS_PER_FRAME) accumulator = 0
    // keep presses buffered across frames that ran zero physics steps
    // (high-refresh displays) so taps are never dropped
    if (steps > 0) input.clearPressed()

    // movement sounds advance on simulated time (steps), not wall time, and
    // stay silent while the duel freezes the simulation
    if (steps > 0 && !(duel.active && duel.frozen)) updateMovementSounds(steps * PHYSICS_STEP)
    weapons.tickVisual(dt) // muzzle flash decays even while frozen
    for (const d of dummies) d.update(dt)
    effects.update(dt)
    updateHud()
  } else {
    accumulator = 0
    input.clearMouse()
    input.clearPressed()
  }

  // safety net: fell out of the map somehow
  if (player.position.y < -20) {
    if (duel.active) {
      // falling out during a duel counts as dying; no free heal
      player.spawn(map.spawns[0].position, map.spawns[0].yaw)
      if (duel.state === 'combat' && playerTarget.hp > 0) {
        playerTarget.hp = 0
        addFeedEntry('<b>YOU</b> 추락')
      }
    } else {
      respawn()
    }
  }

  // hurt vignette fades out over ~0.8s
  if (damageFlash > 0) {
    damageFlash = Math.max(0, damageFlash - dt * 1.3)
    vignette.style.opacity = damageFlash.toFixed(3)
  }

  renderer.render(scene, camera)
  requestAnimationFrame(frame)
}

requestAnimationFrame(frame)

// debug handle for automated smoke tests
;(window as unknown as Record<string, unknown>).__rifle = {
  get player() {
    return {
      x: player.position.x,
      y: player.position.y,
      z: player.position.z,
      vx: player.velocity.x,
      vy: player.velocity.y,
      vz: player.velocity.z,
      grounded: player.grounded,
      sliding: player.sliding,
      yaw: player.yaw,
      hp: playerTarget.hp,
    }
  },
  get combat() {
    return {
      weapon: weapons.weapon.id,
      ammo: weapons.ammoInMag,
      reloading: weapons.isReloading,
      grenades: projectiles.activeCount,
      aiming: weapons.aiming,
    }
  },
  get dummies() {
    return dummies.map((d) => ({ name: d.name, hp: d.hp, alive: d.alive }))
  },
  get duel() {
    const counts = aliveCounts()
    return {
      state: duel.state,
      playerScore: duel.playerScore,
      botScore: duel.botScore,
      round: duel.round,
      teamSize,
      aliveAllies: counts.allies,
      aliveEnemies: counts.enemies,
      botHp: enemyBots[0].hp,
      botAlive: enemyBots[0].alive,
      botX: enemyBots[0].controller.position.x,
      botZ: enemyBots[0].controller.position.z,
    }
  },
  get online() {
    return {
      phase: online.phase,
      code: online.code,
      side: onlineTeam,
      teamSize: onlineTeamSize,
      isHost: onlineIsHost,
      youId: onlineYouId,
      entities: [...onlineEntities.entries()].map(([id, e]) => ({
        id,
        team: e.team,
        hp: e.hp,
        kind: e.bot ? 'hostBot' : 'remote',
        x: (e.remote?.position ?? e.bot!.controller.position).x,
        z: (e.remote?.position ?? e.bot!.controller.position).z,
      })),
      round: onlineRound,
      myHp: onlineMyHp,
      enemyHp: firstEnemyEntry()?.[1].hp ?? 0,
      scoreYou: onlineScoreYou,
      scoreEnemy: onlineScoreEnemy,
      remoteVisible: firstEnemyEntry()?.[1].remote?.alive ?? firstEnemyEntry()?.[1].bot?.alive ?? false,
      remoteX: (firstEnemyEntry()?.[1].remote?.position ?? firstEnemyEntry()?.[1].bot?.controller.position)?.x ?? 0,
      remoteZ: (firstEnemyEntry()?.[1].remote?.position ?? firstEnemyEntry()?.[1].bot?.controller.position)?.z ?? 0,
    }
  },
  get map() {
    return { id: currentMapId, sky: (scene.background as THREE.Color).getHex(), colliders: physics.colliders.length }
  },
  /** Load a map's structure for inspection without starting a match (tests). */
  previewMap(id: string) {
    if (!online.active && !duel.active) loadMap(id)
  },
  /** Pass the nickname gate straight into the lobby (tests). */
  enter(nick = 'TESTER') {
    enterLobby(nick)
  },
  get polish() {
    return {
      fov: camera.fov,
      sensitivity: player.sensitivity,
      vignette: vignette.style.opacity,
      audioState: (audio as unknown as { ctx: AudioContext | null })['ctx']?.state ?? 'none',
    }
  },
  /** Online test helper: claim damage on the opponent as if a shot landed. */
  onlineClaim(damage: number) {
    const entry = firstEnemyEntry()
    if (entry) online.sendHit('sniper', damage, entry[0])
  },
  /** Test helper: simulate a network drop (triggers auto-reconnect). */
  dropSocket() {
    online.simulateDrop()
  },
  damageBot(amount: number, index = 0) {
    enemyBots[index]?.takeDamage(amount, false)
  },
  damageAllBots(amount: number) {
    for (const b of enemyBots) b.takeDamage(amount, false)
  },
  damagePlayer(amount: number) {
    playerTarget.takeDamage(amount, false)
  },
  startDuel(difficulty: string, size = 1) {
    selectedDifficulty = difficulty as Difficulty
    teamSize = Math.max(1, Math.min(4, size))
    pendingDuel = true
    if (playing) {
      pendingDuel = false
      beginDuel()
    }
  },
  /** Enter the practice range (dummies, no rounds) — test helper. */
  startPractice() {
    if (online.active) return
    pendingDuel = false
    loadMap('foundry')
    void startGame()
  },
  spawnAt(x: number, y: number, z: number, yaw: number) {
    player.spawn(new THREE.Vector3(x, y, z), yaw)
  },
  /** Point the camera at a world position (test helper). */
  aimAt(x: number, y: number, z: number) {
    const dir = new THREE.Vector3(x, y, z).sub(camera.position).normalize()
    player.setView(Math.atan2(-dir.x, -dir.z), Math.asin(dir.y))
  },
  press(code: string) {
    input.virtualDown(code)
  },
  release(code: string) {
    input.virtualUp(code)
  },
  /** Raycast straight down the camera; returns what it hits (test helper). */
  testRay() {
    const dir = new THREE.Vector3()
    camera.getWorldDirection(dir)
    const hit = physics.raycast(camera.position, dir, 300)
    if (!hit) return null
    return {
      distance: Number(hit.distance.toFixed(2)),
      part: hit.hitbox ? hit.hitbox.part : 'world',
      point: { x: Number(hit.point.x.toFixed(2)), y: Number(hit.point.y.toFixed(2)), z: Number(hit.point.z.toFixed(2)) },
      camera: {
        x: Number(camera.position.x.toFixed(2)),
        y: Number(camera.position.y.toFixed(2)),
        z: Number(camera.position.z.toFixed(2)),
      },
      dir: { x: Number(dir.x.toFixed(2)), y: Number(dir.y.toFixed(2)), z: Number(dir.z.toFixed(2)) },
    }
  },
}
