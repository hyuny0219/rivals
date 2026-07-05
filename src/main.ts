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

const canvas = document.querySelector<HTMLCanvasElement>('#game')!
const menu = document.querySelector<HTMLDivElement>('#menu')!
const hud = document.querySelector<HTMLDivElement>('#hud')!
const playBtn = document.querySelector<HTMLButtonElement>('#play-btn')!
const dashFill = document.querySelector<HTMLSpanElement>('#dash-fill')!
const hpFill = document.querySelector<HTMLSpanElement>('#hp-fill')!
const hpNum = document.querySelector<HTMLSpanElement>('#hp-num')!
const ammoMag = document.querySelector<HTMLSpanElement>('#ammo-mag')!
const ammoMax = document.querySelector<HTMLSpanElement>('#ammo-max')!
const weaponName = document.querySelector<HTMLDivElement>('#weapon-name')!
const slotEls = [...document.querySelectorAll<HTMLSpanElement>('#weapon-slots span')]
const crosshair = document.querySelector<HTMLDivElement>('#crosshair')!
const hitmarker = document.querySelector<HTMLDivElement>('#hitmarker')!
const killfeed = document.querySelector<HTMLDivElement>('#killfeed')!
const duelBtn = document.querySelector<HTMLButtonElement>('#duel-btn')!
const scoreWrap = document.querySelector<HTMLDivElement>('#score-wrap')!
const scorePlayer = document.querySelector<HTMLSpanElement>('#score-player')!
const scoreBot = document.querySelector<HTMLSpanElement>('#score-bot')!
const banner = document.querySelector<HTMLDivElement>('#banner')!
const bannerMain = document.querySelector<HTMLDivElement>('#banner-main')!
const bannerSub = document.querySelector<HTMLDivElement>('#banner-sub')!
const botHpWrap = document.querySelector<HTMLDivElement>('#bot-hp-wrap')!
const botHpFill = document.querySelector<HTMLSpanElement>('#bot-hp-fill')!
const vignette = document.querySelector<HTMLDivElement>('#vignette')!

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
const map = buildMap(physics)
scene.add(map.group)

const input = new Input()
const player = new PlayerController(physics, camera)

// ---------- player as a damage target (grenade self-damage) ----------
const MAX_HP = 100
interface PlayerTarget extends Damageable {
  hp: number
  lastDamageAt: number
  readonly position: THREE.Vector3
}
const playerTarget: PlayerTarget = {
  center: new THREE.Vector3(),
  get position() {
    return player.position
  },
  alive: true,
  hp: MAX_HP,
  lastDamageAt: -Infinity,
  takeDamage(amount: number): boolean {
    if (duel.active && duel.frozen) return false // no damage during countdown/round end
    playerTarget.hp = Math.max(0, playerTarget.hp - amount)
    playerTarget.lastDamageAt = elapsed
    audio.hurt()
    damageFlash = Math.min(1, damageFlash + amount / 50)
    if (playerTarget.hp <= 0) {
      if (duel.active) {
        addFeedEntry('<b>BOT</b> YOU 처치')
        duel.playerDied()
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
  () => [...dummies, playerTarget, bot],
  (target, _damage, killed) => {
    if (target !== playerTarget) {
      showHitmarker(killed)
      audio.hit(killed)
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
  },
  audio,
)

// ---------- 1v1 duel ----------
const bot = new Bot(
  physics,
  effects,
  playerTarget,
  () => {
    /* bot hit the player — HP bar already reflects it */
  },
  () => {
    addFeedEntry('<b>YOU</b> BOT 처치')
    duel.botDied()
  },
  () => {
    // bot gunshot, attenuated by distance to the listener
    const dist = player.position.distanceTo(bot.controller.position)
    audio.shot('ar', Math.max(0.1, 0.7 * (1 - dist / 70)))
  },
)
scene.add(bot.group)
bot.alive = false
bot.group.visible = false

let selectedDifficulty: Difficulty = 'normal'
let selectedPrimary = 'ar'
let selectedSecondary = 'pistol'
let bannerTimeout = 0

function showBanner(text: string, sub = '', seconds = 1) {
  bannerMain.textContent = text
  bannerSub.textContent = sub
  banner.classList.remove('hidden')
  window.clearTimeout(bannerTimeout)
  bannerTimeout = window.setTimeout(() => banner.classList.add('hidden'), seconds * 1000)
}

const duel = new DuelManager({
  onRoundStart: () => {
    respawn()
    weapons.setLoadout(selectedPrimary, selectedSecondary)
    bot.setDifficulty(selectedDifficulty)
    bot.reset(map.spawns[1].position.clone(), map.spawns[1].yaw)
    projectiles.clear()
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
  bot.alive = false
  bot.group.visible = false
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
  for (const d of dummies) d.setEnabled(false)
  duel.startMatch()
  scoreWrap.classList.remove('hidden')
  botHpWrap.classList.remove('hidden')
}

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

  hpFill.style.width = `${(playerTarget.hp / MAX_HP) * 100}%`
  hpFill.classList.toggle('low', playerTarget.hp <= 30)
  hpNum.textContent = String(Math.round(playerTarget.hp))

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

  crosshair.style.setProperty('--gap', `${weapons.crosshairGap.toFixed(1)}px`)
  crosshair.style.display = weapons.aiming && w.id === 'sniper' ? 'none' : ''

  if (duel.active) {
    scorePlayer.textContent = String(duel.playerScore)
    scoreBot.textContent = String(duel.botScore)
    botHpFill.style.width = `${Math.max(0, bot.hp)}%`
  }
}

// ---------- touch controls ----------
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
  touch.bindButton(document.querySelector('#btn-fire')!, 'Mouse0')
  touch.bindButton(document.querySelector('#btn-ads')!, 'Mouse2')
  touch.bindButton(document.querySelector('#btn-reload')!, 'KeyR')
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.slot-btn')) {
    touch.bindButton(btn, btn.dataset.key!)
  }
  document.querySelector('#btn-pause')!.addEventListener('click', () => setPlaying(false))
}
window.addEventListener('contextmenu', (e) => e.preventDefault())

// ---------- play state / pointer lock ----------
let playing = false

function setPlaying(p: boolean) {
  playing = p
  menu.classList.toggle('hidden', p)
  hud.classList.toggle('hidden', !p)
  input.releaseAll()
  if (p && pendingDuel && !duel.active) {
    pendingDuel = false
    beginDuel()
  }
  if (!p) {
    weapons.resetAds() // don't leave the menu zoomed in
    if (duel.active) {
      duel.stop()
      endDuelCleanup()
    }
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

playBtn.addEventListener('click', () => {
  pendingDuel = false
  void startGame()
})
duelBtn.addEventListener('click', () => {
  pendingDuel = true
  void startGame()
})

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
wireToggleGroup('.primary-btn', (id) => (selectedPrimary = id))
wireToggleGroup('.secondary-btn', (id) => (selectedSecondary = id))

document.addEventListener('pointerlockchange', () => {
  if (!touchMode) setPlaying(document.pointerLockElement === canvas)
})

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
      if (!(duel.active && duel.frozen)) {
        player.update(PHYSICS_STEP, input)
        syncPlayerCenter() // explosions this step must see the current position
        syncPlayerHitboxes()
        weapons.update(PHYSICS_STEP, input)
        projectiles.update(PHYSICS_STEP)
        if (duel.active) bot.update(PHYSICS_STEP)
        // out-of-combat regen (practice only — duel rounds reset HP instead,
        // and regen would reward stalling behind cover)
        if (!duel.active && playerTarget.hp < MAX_HP && elapsed - playerTarget.lastDamageAt > HP_REGEN_DELAY) {
          playerTarget.hp = Math.min(MAX_HP, playerTarget.hp + HP_REGEN_PER_SECOND * PHYSICS_STEP)
        }
      }
      accumulator -= PHYSICS_STEP
      steps++
    }
    if (duelWasActive && !duel.active) endDuelCleanup() // match finished
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
      // falling out during a duel loses the round; no free heal
      player.spawn(map.spawns[0].position, map.spawns[0].yaw)
      if (duel.state === 'combat') {
        addFeedEntry('<b>YOU</b> 추락')
        duel.playerDied()
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
    }
  },
  get dummies() {
    return dummies.map((d) => ({ name: d.name, hp: d.hp, alive: d.alive }))
  },
  get duel() {
    return {
      state: duel.state,
      playerScore: duel.playerScore,
      botScore: duel.botScore,
      round: duel.round,
      botHp: bot.hp,
      botAlive: bot.alive,
      botX: bot.controller.position.x,
      botZ: bot.controller.position.z,
    }
  },
  get polish() {
    return {
      fov: camera.fov,
      sensitivity: player.sensitivity,
      vignette: vignette.style.opacity,
      audioState: (audio as unknown as { ctx: AudioContext | null })['ctx']?.state ?? 'none',
    }
  },
  damageBot(amount: number) {
    bot.takeDamage(amount, false)
  },
  damagePlayer(amount: number) {
    playerTarget.takeDamage(amount, false)
  },
  startDuel(difficulty: string) {
    selectedDifficulty = difficulty as Difficulty
    pendingDuel = true
    if (playing) {
      pendingDuel = false
      beginDuel()
    }
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
