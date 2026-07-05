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
}
const playerTarget: PlayerTarget = {
  center: new THREE.Vector3(),
  alive: true,
  hp: MAX_HP,
  lastDamageAt: -Infinity,
  takeDamage(amount: number): boolean {
    playerTarget.hp = Math.max(0, playerTarget.hp - amount)
    playerTarget.lastDamageAt = elapsed
    if (playerTarget.hp <= 0) {
      addFeedEntry('<b>YOU</b> 자폭했습니다')
      respawn()
      return true
    }
    return false
  },
}

function respawn() {
  player.spawn(map.spawns[0].position, map.spawns[0].yaw)
  playerTarget.hp = MAX_HP
}
respawn()

// ---------- combat ----------
const effects = new Effects(scene)

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
  () => [...dummies, playerTarget],
  (target, _damage, killed) => {
    if (target !== playerTarget) showHitmarker(killed)
  },
)

const weapons = new WeaponController(physics, player, camera, effects, projectiles, playerTarget, (info) => {
  showHitmarker(info.killed && info.isHead ? true : info.killed)
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
}

async function startGame() {
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

playBtn.addEventListener('click', startGame)

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

function frame(now: number) {
  const dt = Math.min((now - lastTime) / 1000, 0.25)
  lastTime = now

  if (playing) {
    player.look(input, dt) // mouse look once per frame, not per physics step
    input.clearMouse()
    accumulator += dt
    let steps = 0
    while (accumulator >= PHYSICS_STEP && steps < MAX_STEPS_PER_FRAME) {
      elapsed += PHYSICS_STEP
      player.update(PHYSICS_STEP, input)
      weapons.update(PHYSICS_STEP, input)
      projectiles.update(PHYSICS_STEP)
      accumulator -= PHYSICS_STEP
      steps++
    }
    if (steps === MAX_STEPS_PER_FRAME) accumulator = 0
    // keep presses buffered across frames that ran zero physics steps
    // (high-refresh displays) so taps are never dropped
    if (steps > 0) input.clearPressed()

    // out-of-combat regen
    if (playerTarget.hp < MAX_HP && elapsed - playerTarget.lastDamageAt > HP_REGEN_DELAY) {
      playerTarget.hp = Math.min(MAX_HP, playerTarget.hp + HP_REGEN_PER_SECOND * dt)
    }
    playerTarget.center.copy(player.position).y += 0.9

    for (const d of dummies) d.update(dt)
    effects.update(dt)
    updateHud()
  } else {
    accumulator = 0
    input.clearMouse()
    input.clearPressed()
  }

  // safety net: fell out of the map somehow → respawn
  if (player.position.y < -20) respawn()

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
  spawnAt(x: number, y: number, z: number, yaw: number) {
    player.spawn(new THREE.Vector3(x, y, z), yaw)
  },
  /** Point the camera at a world position (test helper). */
  aimAt(x: number, y: number, z: number) {
    const dir = new THREE.Vector3(x, y, z).sub(camera.position).normalize()
    player.yaw = Math.atan2(-dir.x, -dir.z)
    player.pitch = Math.asin(dir.y)
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
