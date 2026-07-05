import * as THREE from 'three'
import './style.css'
import { Input } from './core/input'
import { PhysicsWorld } from './world/physics'
import { buildMap } from './world/map'
import { PlayerController } from './player/controller'

const canvas = document.querySelector<HTMLCanvasElement>('#game')!
const menu = document.querySelector<HTMLDivElement>('#menu')!
const hud = document.querySelector<HTMLDivElement>('#hud')!
const playBtn = document.querySelector<HTMLButtonElement>('#play-btn')!
const dashFill = document.querySelector<HTMLSpanElement>('#dash-fill')!

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x8fc4e8)
scene.fog = new THREE.Fog(0x8fc4e8, 60, 140)

const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 300)

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
player.spawn(map.spawns[0].position, map.spawns[0].yaw)

// ---------- pointer lock / menu flow ----------
function startGame() {
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
  const locked = document.pointerLockElement === canvas
  menu.classList.toggle('hidden', locked)
  hud.classList.toggle('hidden', !locked)
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
let lastTime = performance.now()
let accumulator = 0

function frame(now: number) {
  const dt = Math.min((now - lastTime) / 1000, 0.25)
  lastTime = now

  if (document.pointerLockElement === canvas) {
    player.look(input) // mouse look once per frame, not per physics step
    accumulator += dt
    let steps = 0
    while (accumulator >= PHYSICS_STEP && steps < MAX_STEPS_PER_FRAME) {
      player.update(PHYSICS_STEP, input)
      accumulator -= PHYSICS_STEP
      steps++
    }
    if (steps === MAX_STEPS_PER_FRAME) accumulator = 0
    dashFill.style.width = `${player.dashCharge * 100}%`
  } else {
    accumulator = 0
  }
  input.endFrame()

  // safety net: fell out of the map somehow → respawn
  if (player.position.y < -20) {
    player.spawn(map.spawns[0].position, map.spawns[0].yaw)
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
    }
  },
  spawnAt(x: number, y: number, z: number, yaw: number) {
    player.spawn(new THREE.Vector3(x, y, z), yaw)
  },
}
