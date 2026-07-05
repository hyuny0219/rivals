import * as THREE from 'three'
import { Input } from '../core/input'
import { PhysicsWorld } from '../world/physics'

/**
 * What the movement sim reads each step. The DOM-backed Input satisfies this;
 * bots provide a virtual implementation — the controller itself is headless.
 */
export interface ControlSource {
  isDown(code: string): boolean
  wasPressed(code: string): boolean
  readonly touchMoveX: number
  readonly touchMoveY: number
}

const GRAVITY = 26
const DASH_GRAVITY_SCALE = 0.35 // dash floats: reduced gravity while dashTimer > 0
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
const EYE_EASE = 14

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
  /** Sensitivity multiplier (ADS lowers it). */
  sensScale = 1
  /** Decaying recoil offsets applied on top of pitch/yaw. */
  private punchPitch = 0
  private punchYaw = 0

  grounded = false
  sliding = false
  private coyote = 0

  private dashTimer = 0
  private dashCooldown = 0
  private dashDir = new THREE.Vector3()

  /** Smoothed eye height for crouch/stand transitions only. */
  private eyeSmooth = STAND_EYE

  // scratch objects, reused every frame to avoid GC churn
  private box = new THREE.Box3()
  private hits: THREE.Box3[] = []
  private wish = new THREE.Vector3()

  constructor(
    private world: PhysicsWorld,
    /** Omitted for headless simulation (bots, future server). */
    private camera?: THREE.PerspectiveCamera,
  ) {}

  /** Collision height, derived from stance so it can never desync. */
  private get height(): number {
    return this.sliding ? SLIDE_HEIGHT : STAND_HEIGHT
  }

  private get eyeHeight(): number {
    return this.sliding ? SLIDE_EYE : STAND_EYE
  }

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
    this.grounded = false
    this.coyote = 0
    this.eyeSmooth = STAND_EYE
    this.updateCamera(0)
  }

  /** Set the view angles directly (clamped) and sync the camera immediately. */
  setView(yaw: number, pitch: number) {
    this.yaw = yaw
    this.pitch = THREE.MathUtils.clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT)
    this.syncCameraRotation()
  }

  /** Weapon recoil: kick the view up (and a touch sideways), decaying over time. */
  punch(pitchKick: number, yawKick: number) {
    this.punchPitch = Math.min(this.punchPitch + pitchKick, 0.12)
    this.punchYaw += yawKick
  }

  /**
   * Apply accumulated mouse deltas and sync the camera rotation.
   * Call once per rendered frame (not per physics step) so high-refresh
   * displays get fresh look rotation even on zero-physics-step frames.
   */
  look(input: Input, dt: number) {
    this.yaw -= input.mouseDX * this.sensitivity * this.sensScale
    this.pitch -= input.mouseDY * this.sensitivity * this.sensScale
    this.pitch = THREE.MathUtils.clamp(this.pitch, -PITCH_LIMIT, PITCH_LIMIT)
    const decay = Math.min(1, dt * 9)
    this.punchPitch *= 1 - decay
    this.punchYaw *= 1 - decay
    this.syncCameraRotation()
  }

  private syncCameraRotation() {
    if (!this.camera) return
    this.camera.rotation.set(
      THREE.MathUtils.clamp(this.pitch + this.punchPitch, -PITCH_LIMIT, PITCH_LIMIT),
      this.yaw + this.punchYaw,
      0,
      'YXZ',
    )
  }

  /** One fixed physics step. */
  update(dt: number, input: ControlSource) {
    // input direction in world space (camera-relative, ground plane);
    // keyboard and virtual joystick share the same axes
    const forward = THREE.MathUtils.clamp(
      Number(input.isDown('KeyW')) - Number(input.isDown('KeyS')) + input.touchMoveY,
      -1,
      1,
    )
    const right = THREE.MathUtils.clamp(
      Number(input.isDown('KeyD')) - Number(input.isDown('KeyA')) + input.touchMoveX,
      -1,
      1,
    )
    this.wish.set(
      Math.sin(this.yaw) * -forward + Math.cos(this.yaw) * right,
      0,
      Math.cos(this.yaw) * -forward - Math.sin(this.yaw) * right,
    )
    if (this.wish.lengthSq() > 1) this.wish.normalize()

    this.updateDash(dt, input)
    this.updateSlide(input)

    if (this.dashTimer > 0) {
      // dash overrides horizontal steering; vertical physics keeps running
      // (reduced gravity below) so jumps during a dash survive and a
      // grounded dash keeps ground contact
      this.velocity.x = this.dashDir.x * DASH_SPEED
      this.velocity.z = this.dashDir.z * DASH_SPEED
    } else if (this.sliding) {
      this.applyFriction(dt, SLIDE_FRICTION)
    } else if (this.grounded) {
      this.applyFriction(dt, GROUND_FRICTION)
      this.accelerate(dt, GROUND_ACCEL, WALK_SPEED)
    } else {
      this.accelerate(dt, AIR_ACCEL, AIR_SPEED_CAP)
    }
    this.velocity.y -= GRAVITY * (this.dashTimer > 0 ? DASH_GRAVITY_SCALE : 1) * dt

    // jump (with a little coyote time off ledges)
    this.coyote = this.grounded ? COYOTE_TIME : Math.max(0, this.coyote - dt)
    if (input.wasPressed('Space') && this.coyote > 0) {
      this.velocity.y = JUMP_VELOCITY
      this.coyote = 0
      this.standUpIfPossible()
    }

    this.moveAndCollide(dt)
    this.updateCamera(dt)
  }

  private updateDash(dt: number, input: ControlSource) {
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
      this.standUpIfPossible()
    }
  }

  private updateSlide(input: ControlSource) {
    const slideKey = input.isDown('KeyC')
    const horizSpeed = this.horizontalSpeed()

    if (!this.sliding && slideKey && this.grounded && horizSpeed > SLIDE_MIN_START_SPEED) {
      this.sliding = true
      this.velocity.x *= SLIDE_BOOST
      this.velocity.z *= SLIDE_BOOST
    } else if (this.sliding && (!slideKey || horizSpeed < SLIDE_MIN_SPEED)) {
      this.standUpIfPossible()
    }
  }

  /** Leave the slide stance only when there is headroom to stand. */
  private standUpIfPossible() {
    if (!this.sliding) return
    this.computeBox(this.box, this.position, STAND_HEIGHT)
    this.box.min.y = this.position.y + SLIDE_HEIGHT
    if (this.world.isFree(this.box)) this.sliding = false
  }

  private horizontalSpeed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z)
  }

  private applyFriction(dt: number, friction: number) {
    const speed = this.horizontalSpeed()
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
    // step-up must not trigger mid-air (it would let players mantle walls),
    // so gate it on the ground state of the previous step
    const wasGrounded = this.grounded
    this.grounded = false
    this.moveAxis('x', this.velocity.x * dt, wasGrounded)
    this.moveAxis('y', this.velocity.y * dt, wasGrounded)
    this.moveAxis('z', this.velocity.z * dt, wasGrounded)
  }

  private moveAxis(axis: 'x' | 'y' | 'z', amount: number, wasGrounded: boolean) {
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
        if (wasGrounded && lift > 0 && lift <= STEP_HEIGHT && this.tryStepUp(hit.max.y)) continue
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
    // ease only the stance (crouch/stand) eye offset; body motion must not
    // leak into the easing or the camera drifts off the head during falls
    this.eyeSmooth = dt > 0 ? THREE.MathUtils.lerp(this.eyeSmooth, this.eyeHeight, Math.min(1, dt * EYE_EASE)) : this.eyeHeight
    if (!this.camera) return
    this.camera.position.set(this.position.x, this.position.y + this.eyeSmooth, this.position.z)
    this.syncCameraRotation()
  }
}
