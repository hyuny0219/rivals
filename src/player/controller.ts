import * as THREE from 'three'
import { Input } from '../core/input'
import { PhysicsWorld } from '../world/physics'

const GRAVITY = 26
const WALK_SPEED = 8.5
const GROUND_ACCEL = 90
const GROUND_FRICTION = 11
const AIR_ACCEL = 28
const AIR_SPEED_CAP = 9.5
const JUMP_VELOCITY = 8.8
const COYOTE_TIME = 0.1

const DASH_SPEED = 22
const DASH_DURATION = 0.16
const DASH_COOLDOWN = 2.0

const SLIDE_BOOST = 1.35
const SLIDE_FRICTION = 2.2
const SLIDE_MIN_SPEED = 5.5
const SLIDE_MIN_START_SPEED = 6

const HALF_WIDTH = 0.4
const STAND_HEIGHT = 1.8
const SLIDE_HEIGHT = 0.95
const STAND_EYE = 1.62
const SLIDE_EYE = 0.75
const STEP_HEIGHT = 0.55
const EPS = 0.001

const PITCH_LIMIT = Math.PI / 2 - 0.01

/**
 * First-person character controller.
 * `position` is the player's feet. Movement resolves an AABB against the
 * static world one axis at a time, with a step-up assist for stairs.
 */
export class PlayerController {
  readonly position = new THREE.Vector3()
  readonly velocity = new THREE.Vector3()
  yaw = 0
  pitch = 0
  sensitivity = 0.0023

  grounded = false
  private coyote = 0

  private dashTimer = 0
  private dashCooldown = 0
  private dashDir = new THREE.Vector3()

  sliding = false
  private height = STAND_HEIGHT
  private eye = STAND_EYE

  // scratch objects, reused every frame to avoid GC churn
  private box = new THREE.Box3()
  private hits: THREE.Box3[] = []
  private wish = new THREE.Vector3()

  constructor(
    private world: PhysicsWorld,
    private camera: THREE.PerspectiveCamera,
  ) {}

  /** 0..1, how much of the dash cooldown has recovered. */
  get dashCharge(): number {
    return 1 - this.dashCooldown / DASH_COOLDOWN
  }

  spawn(point: THREE.Vector3, yaw: number) {
    this.position.copy(point)
    this.velocity.set(0, 0, 0)
    this.yaw = yaw
    this.pitch = 0
    this.dashTimer = 0
    this.dashCooldown = 0
    this.sliding = false
    this.setHeight(STAND_HEIGHT, STAND_EYE)
    // snap the camera so there is no eye-height easing artifact on spawn
    this.camera.position.set(point.x, point.y + STAND_EYE, point.z)
    this.camera.rotation.set(0, yaw, 0, 'YXZ')
  }

  /** Apply accumulated mouse deltas. Call once per rendered frame (not per physics step). */
  look(input: Input) {
    this.yaw -= input.mouseDX * this.sensitivity
    this.pitch -= input.mouseDY * this.sensitivity
    this.pitch = THREE.MathUtils.clamp(this.pitch, -PITCH_LIMIT, PITCH_LIMIT)
  }

  /** One fixed physics step. */
  update(dt: number, input: Input) {
    // input direction in world space (camera-relative, ground plane)
    const forward = Number(input.isDown('KeyW')) - Number(input.isDown('KeyS'))
    const right = Number(input.isDown('KeyD')) - Number(input.isDown('KeyA'))
    this.wish
      .set(Math.sin(this.yaw) * -forward + Math.cos(this.yaw) * right, 0, Math.cos(this.yaw) * -forward - Math.sin(this.yaw) * right)
    if (this.wish.lengthSq() > 1) this.wish.normalize()

    this.updateDash(dt, input)
    this.updateSlide(input)

    if (this.dashTimer > 0) {
      // dash overrides normal steering; keep vertical velocity frozen
      this.velocity.x = this.dashDir.x * DASH_SPEED
      this.velocity.z = this.dashDir.z * DASH_SPEED
      this.velocity.y = 0
    } else if (this.sliding) {
      this.applyFriction(dt, SLIDE_FRICTION)
      this.velocity.y -= GRAVITY * dt
    } else if (this.grounded) {
      this.applyFriction(dt, GROUND_FRICTION)
      this.accelerate(dt, GROUND_ACCEL, WALK_SPEED)
      this.velocity.y -= GRAVITY * dt
    } else {
      this.accelerate(dt, AIR_ACCEL, AIR_SPEED_CAP)
      this.velocity.y -= GRAVITY * dt
    }

    // jump (with a little coyote time off ledges)
    this.coyote = this.grounded ? COYOTE_TIME : Math.max(0, this.coyote - dt)
    if (input.wasPressed('Space') && this.coyote > 0) {
      this.velocity.y = JUMP_VELOCITY
      this.coyote = 0
      this.sliding = false
      this.setHeight(STAND_HEIGHT, STAND_EYE)
    }

    this.moveAndCollide(dt)
    this.updateCamera(dt)
  }

  private updateDash(dt: number, input: Input) {
    this.dashTimer = Math.max(0, this.dashTimer - dt)
    this.dashCooldown = Math.max(0, this.dashCooldown - dt)
    if ((input.wasPressed('ShiftLeft') || input.wasPressed('ShiftRight')) && this.dashCooldown === 0) {
      this.dashTimer = DASH_DURATION
      this.dashCooldown = DASH_COOLDOWN
      // dash toward movement input, or facing direction when standing still
      if (this.wish.lengthSq() > 0.01) {
        this.dashDir.copy(this.wish).normalize()
      } else {
        this.dashDir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw))
      }
      this.sliding = false
      this.setHeight(STAND_HEIGHT, STAND_EYE)
    }
  }

  private updateSlide(input: Input) {
    const slideKey = input.isDown('KeyC') || input.isDown('ControlLeft')
    const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z)

    if (!this.sliding && slideKey && this.grounded && horizSpeed > SLIDE_MIN_START_SPEED) {
      this.sliding = true
      this.velocity.x *= SLIDE_BOOST
      this.velocity.z *= SLIDE_BOOST
      this.setHeight(SLIDE_HEIGHT, SLIDE_EYE)
    } else if (this.sliding && (!slideKey || horizSpeed < SLIDE_MIN_SPEED)) {
      // only stand back up if there is headroom
      if (this.canStand()) {
        this.sliding = false
        this.setHeight(STAND_HEIGHT, STAND_EYE)
      }
    }
  }

  private canStand(): boolean {
    this.computeBox(this.box, this.position, STAND_HEIGHT)
    this.box.min.y = this.position.y + SLIDE_HEIGHT
    return this.world.isFree(this.box)
  }

  private setHeight(h: number, eye: number) {
    this.height = h
    this.eye = eye
  }

  private applyFriction(dt: number, friction: number) {
    const speed = Math.hypot(this.velocity.x, this.velocity.z)
    if (speed < 0.01) {
      this.velocity.x = 0
      this.velocity.z = 0
      return
    }
    const drop = speed * friction * dt
    const scale = Math.max(0, speed - drop) / speed
    this.velocity.x *= scale
    this.velocity.z *= scale
  }

  private accelerate(dt: number, accel: number, maxSpeed: number) {
    if (this.wish.lengthSq() < 0.0001) return
    // Quake-style: only add speed up to the cap in the wish direction,
    // preserving momentum from dashes and slides
    const current = this.velocity.x * this.wish.x + this.velocity.z * this.wish.z
    const add = Math.min(accel * dt, maxSpeed - current)
    if (add <= 0) return
    this.velocity.x += this.wish.x * add
    this.velocity.z += this.wish.z * add
  }

  private computeBox(out: THREE.Box3, feet: THREE.Vector3, height: number): THREE.Box3 {
    out.min.set(feet.x - HALF_WIDTH, feet.y, feet.z - HALF_WIDTH)
    out.max.set(feet.x + HALF_WIDTH, feet.y + height, feet.z + HALF_WIDTH)
    return out
  }

  private moveAndCollide(dt: number) {
    this.grounded = false
    this.moveAxis('x', this.velocity.x * dt)
    this.moveAxis('y', this.velocity.y * dt)
    this.moveAxis('z', this.velocity.z * dt)
  }

  private moveAxis(axis: 'x' | 'y' | 'z', amount: number) {
    if (amount === 0 && axis !== 'y') return
    this.position[axis] += amount
    this.computeBox(this.box, this.position, this.height)
    this.world.overlaps(this.box, this.hits)

    for (const hit of this.hits) {
      if (axis === 'y') {
        if (amount <= 0) {
          this.position.y = hit.max.y + EPS
          this.velocity.y = 0
          this.grounded = true
        } else {
          this.position.y = hit.min.y - this.height - EPS
          this.velocity.y = 0
        }
      } else {
        // step-up assist: low obstacles (stairs, curbs) don't stop grounded movement
        const lift = hit.max.y - this.position.y
        if (this.grounded || this.velocity.y <= 0) {
          if (lift > 0 && lift <= STEP_HEIGHT && this.tryStepUp(hit.max.y)) continue
        }
        if (amount > 0) {
          this.position[axis] = hit.min[axis] - HALF_WIDTH - EPS
        } else {
          this.position[axis] = hit.max[axis] + HALF_WIDTH + EPS
        }
        this.velocity[axis] = 0
      }
      this.computeBox(this.box, this.position, this.height)
    }
  }

  private tryStepUp(topY: number): boolean {
    const oldY = this.position.y
    this.position.y = topY + EPS
    this.computeBox(this.box, this.position, this.height)
    if (this.world.isFree(this.box)) {
      this.grounded = true
      return true
    }
    this.position.y = oldY
    return false
  }

  private updateCamera(dt: number) {
    // smooth eye height changes (slide crouch/stand)
    const targetEye = this.eye
    const currentEye = this.camera.position.y - this.position.y
    const eased = THREE.MathUtils.lerp(currentEye, targetEye, Math.min(1, dt * 14))

    this.camera.position.set(this.position.x, this.position.y + eased, this.position.z)
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ')
  }
}
