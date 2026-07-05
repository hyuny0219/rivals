import * as THREE from 'three'
import { ControlSource, PlayerController } from '../player/controller'
import { Damageable, Hitbox, PhysicsWorld, isFriendly } from '../world/physics'
import { Effects } from '../combat/effects'
import { WEAPONS } from '../combat/weapons'
import { createRng } from '../combat/rng'
import { makeNameplate } from '../render/nameplate'

export type Difficulty = 'easy' | 'normal' | 'hard'

interface DifficultyParams {
  aimErrorRad: number
  reactionTime: number
  burstShots: number
  burstPause: number
  turnSpeed: number // rad/s toward the aim target
  engageRange: number
  dashChance: number // per second while chasing
}

const DIFFICULTY: Record<Difficulty, DifficultyParams> = {
  easy: { aimErrorRad: 0.1, reactionTime: 0.6, burstShots: 3, burstPause: 0.8, turnSpeed: 4, engageRange: 26, dashChance: 0.1 },
  normal: { aimErrorRad: 0.055, reactionTime: 0.35, burstShots: 4, burstPause: 0.55, turnSpeed: 7, engageRange: 32, dashChance: 0.2 },
  hard: { aimErrorRad: 0.028, reactionTime: 0.18, burstShots: 6, burstPause: 0.35, turnSpeed: 11, engageRange: 40, dashChance: 0.35 },
}

const MAX_HP = 100
const EYE = 1.62
const HEAD = { w: 0.4, h: 0.4 }
const TORSO = { w: 0.8, h: 0.85, d: 0.42 }
const LEGS_H = 0.75
const STRAFE_FLIP_MIN = 0.7
const STRAFE_FLIP_MAX = 1.8
/** Doorway waypoint in the center wall used when the direct path is blocked. */
const GAP_POINT = new THREE.Vector3(0, 0, 0)
/** Offset approach lane that clears the crates at (±14, 0) flanking the gap. */
const APPROACH_Z = 5
const APPROACH_X = 19
const STUCK_CHECK_INTERVAL = 0.5
const STUCK_MIN_DISTANCE = 0.9 // expected ~4m per check at walk speed
const AVOID_DURATION = 0.8

/** Virtual control source driven by the AI. */
class BotControls implements ControlSource {
  touchMoveX = 0
  touchMoveY = 0
  private pressed = new Set<string>()

  press(code: string) {
    this.pressed.add(code)
  }

  isDown(): boolean {
    return false
  }

  wasPressed(code: string): boolean {
    return this.pressed.has(code)
  }

  endStep() {
    this.pressed.clear()
  }
}

export type BotTarget = Damageable & { position: THREE.Vector3 }

/**
 * Duel/team-battle combatant: runs the same movement physics as the player
 * through a virtual control source; picks the nearest live enemy, navigates
 * via the center doorway, strafes in combat, and fires bursts with
 * difficulty-scaled aim error. Friendly fire is blocked.
 */
export class Bot implements Damageable {
  readonly name: string
  readonly team: number
  readonly center = new THREE.Vector3()
  alive = true
  hp = MAX_HP
  readonly controller: PlayerController
  readonly group = new THREE.Group()

  private controls = new BotControls()
  private params: DifficultyParams = DIFFICULTY.normal
  private rng = createRng(0xb07)
  private weapon = WEAPONS.ar
  private currentTarget: BotTarget | null = null
  private retargetTimer = 0

  /** Online host mode: HP lives on the server; local takeDamage is a no-op. */
  serverControlledHp = false
  /** Online host mode: shots report claims here instead of applying damage. */
  damageSink?: (target: Damageable, damage: number, isHead: boolean, bot: Bot) => void
  /** Online host mode: fired-shot relay (tracer/sound on other clients). */
  onFiredRelay?: (bot: Bot) => void

  private sawPlayerFor = 0
  private burstLeft = 0
  private fireTimer = 0
  private strafeDir = 1
  private strafeTimer = 0
  private dashTimer = 0
  private stuckTimer = 0
  private stuckAccum = 0
  private avoidTimer = 0
  private avoidDir = 1
  private lastPos = new THREE.Vector3()

  private headBox: Hitbox
  private bodyBox: Hitbox

  // scratch
  private vEye = new THREE.Vector3()
  private vTargetEye = new THREE.Vector3()
  private vDir = new THREE.Vector3()
  private vMove = new THREE.Vector3()

  constructor(
    private world: PhysicsWorld,
    private effects: Effects,
    opts: { name: string; team: number; color: number; seed?: number },
    /** Live list of potential enemies (filtered by alive/team here). */
    private getEnemies: () => BotTarget[],
    private onShotHit: (damage: number, killed: boolean) => void,
    private onDied: (bot: Bot) => void,
    private onFired?: () => void,
  ) {
    this.name = opts.name
    this.team = opts.team
    this.rng = createRng(opts.seed ?? 0xb07)
    this.controller = new PlayerController(world) // headless

    const mat = (color: number) => new THREE.MeshLambertMaterial({ color })
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.3, LEGS_H, 0.34), mat(0x30373f))
    legL.position.set(-0.21, LEGS_H / 2, 0)
    const legR = legL.clone()
    legR.position.x = 0.21
    const torso = new THREE.Mesh(new THREE.BoxGeometry(TORSO.w, TORSO.h, TORSO.d), mat(opts.color))
    torso.position.y = LEGS_H + TORSO.h / 2
    const head = new THREE.Mesh(new THREE.BoxGeometry(HEAD.w, HEAD.h, HEAD.w), mat(0xf2c14e))
    head.position.y = LEGS_H + TORSO.h + HEAD.h / 2
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.55), mat(0x22282f))
    gun.position.set(0.28, LEGS_H + TORSO.h * 0.7, -0.3)
    for (const m of [legL, legR, torso, head, gun]) {
      m.receiveShadow = true
      this.group.add(m)
    }
    // team 0 = the local player's side: ally plates show through walls
    this.group.add(makeNameplate(this.name, this.team === 0 ? '#57d38c' : '#ff8a75', this.team === 0))

    this.headBox = { entity: this, part: 'head', box: new THREE.Box3() }
    this.bodyBox = { entity: this, part: 'body', box: new THREE.Box3() }
    world.addHitbox(this.headBox)
    world.addHitbox(this.bodyBox)
  }

  /** Feet position (BotTarget contract, same shape as the player proxy). */
  get position(): THREE.Vector3 {
    return this.controller.position
  }

  setDifficulty(d: Difficulty) {
    this.params = DIFFICULTY[d]
  }

  reset(position: THREE.Vector3, yaw: number) {
    this.controller.spawn(position, yaw)
    this.hp = MAX_HP
    this.alive = true
    this.group.visible = true
    this.sawPlayerFor = 0
    this.burstLeft = 0
    this.fireTimer = 0
    this.stuckTimer = 0
    this.stuckAccum = 0
    this.avoidTimer = 0
    this.currentTarget = null
    this.retargetTimer = 0
    this.lastPos.copy(position)
    this.syncBody()
  }

  deactivate() {
    this.alive = false
    this.group.visible = false
  }

  takeDamage(amount: number, _isHead: boolean): boolean {
    if (!this.alive || this.serverControlledHp) return false
    this.hp -= amount
    if (this.hp <= 0) {
      this.die()
      return true
    }
    return false
  }

  /** Server HP broadcast (online host mode). */
  applyServerHp(hp: number) {
    this.hp = hp
    if (hp <= 0 && this.alive) this.die()
  }

  private die() {
    this.alive = false
    this.group.visible = false
    this.effects.puff(this.center, 0xc94f4f)
    this.onDied(this)
  }

  /** Nearest live enemy; re-evaluated periodically or when the target dies. */
  private pickTarget(dt: number): BotTarget | null {
    this.retargetTimer -= dt
    if (this.currentTarget?.alive && this.retargetTimer > 0) return this.currentTarget
    this.retargetTimer = 0.5
    const pos = this.controller.position
    let best: BotTarget | null = null
    let bestDist = Infinity
    for (const enemy of this.getEnemies()) {
      if (!enemy.alive) continue
      const d = pos.distanceToSquared(enemy.position)
      if (d < bestDist) {
        bestDist = d
        best = enemy
      }
    }
    this.currentTarget = best
    return best
  }

  /** One fixed physics step. */
  update(dt: number) {
    if (!this.alive) return
    const target = this.pickTarget(dt)
    const pos = this.controller.position
    this.vEye.set(pos.x, pos.y + EYE, pos.z)

    if (!target) {
      // nobody left to fight — hold position
      this.controls.touchMoveX = 0
      this.controls.touchMoveY = 0
      this.controller.update(dt, this.controls)
      this.controls.endStep()
      this.syncBody()
      return
    }

    // aim at the target's mass center: it tracks stance (slide) so shots
    // stay inside the actual hitbox
    this.vTargetEye.copy(target.center)
    const dist = this.vEye.distanceTo(this.vTargetEye)
    const los = this.hasLineOfSight(target, dist)

    if (los) {
      this.sawPlayerFor += dt
      this.combatMove(dt, dist, target)
      this.aimAndFire(dt)
    } else {
      this.sawPlayerFor = 0
      this.burstLeft = 0
      this.navigateToward(dt, target)
    }

    this.controller.update(dt, this.controls)
    this.controls.endStep()
    this.syncBody()
  }

  private hasLineOfSight(target: BotTarget, dist: number): boolean {
    if (dist > this.params.engageRange) return false
    this.vDir.copy(this.vTargetEye).sub(this.vEye).divideScalar(dist)
    const hit = this.world.raycast(this.vEye, this.vDir, dist, this)
    // anything hit before reaching the target's eye is an obstruction
    // (including teammates — don't shoot through allies), unless it is the
    // target's own hitbox
    return !hit || hit.hitbox?.entity === target
  }

  /** Face a world direction and translate it into local move axes. */
  private steerToward(x: number, z: number, forwardAmount: number, strafeAmount: number, dt: number) {
    const desiredYaw = Math.atan2(-(x - this.controller.position.x), -(z - this.controller.position.z))
    let delta = desiredYaw - this.controller.yaw
    while (delta > Math.PI) delta -= Math.PI * 2
    while (delta < -Math.PI) delta += Math.PI * 2
    const maxTurn = this.params.turnSpeed * dt
    this.controller.yaw += THREE.MathUtils.clamp(delta, -maxTurn, maxTurn)
    this.controls.touchMoveY = forwardAmount
    this.controls.touchMoveX = strafeAmount
  }

  private navigateToward(dt: number, target: BotTarget) {
    const pos = this.controller.position
    const t = target.position
    // the center wall splits the arena at x=0 with a doorway near z=0;
    // approach it on an offset lane that clears the crates at (±14, 0)
    let goal = t
    if (Math.sign(pos.x) !== Math.sign(t.x)) {
      const wx = Math.sign(pos.x) * APPROACH_X
      const distToApproach = Math.hypot(pos.x - wx, pos.z - APPROACH_Z)
      // head to the approach lane until actually reaching it, then the gap
      if (Math.abs(pos.x) > APPROACH_X - 3 && distToApproach > 2.5) goal = this.vMove.set(wx, 0, APPROACH_Z)
      else if (Math.abs(pos.x) > 1.5) goal = GAP_POINT
    }
    const strafe = this.avoidTimer > 0 ? this.avoidDir : 0
    this.steerToward(goal.x, goal.z, 1, strafe, dt)
    this.controller.pitch = 0

    // stuck detection: walking but not covering ground → jump + sidestep
    this.stuckAccum += Math.hypot(pos.x - this.lastPos.x, pos.z - this.lastPos.z)
    this.lastPos.copy(pos)
    this.stuckTimer += dt
    this.avoidTimer = Math.max(0, this.avoidTimer - dt)
    if (this.stuckTimer >= STUCK_CHECK_INTERVAL) {
      if (this.stuckAccum < STUCK_MIN_DISTANCE) {
        this.controls.press('Space')
        this.avoidDir = -this.avoidDir
        this.avoidTimer = AVOID_DURATION
      }
      this.stuckTimer = 0
      this.stuckAccum = 0
    }

    this.dashTimer -= dt
    if (this.dashTimer <= 0) {
      this.dashTimer = 1
      if (this.rng() < this.params.dashChance) this.controls.press('ShiftLeft')
    }
  }

  private combatMove(dt: number, dist: number, target: BotTarget) {
    this.strafeTimer -= dt
    if (this.strafeTimer <= 0) {
      this.strafeDir = this.rng() < 0.5 ? -1 : 1
      this.strafeTimer = STRAFE_FLIP_MIN + this.rng() * (STRAFE_FLIP_MAX - STRAFE_FLIP_MIN)
      if (this.rng() < 0.25) this.controls.press('Space')
    }
    // keep a medium engagement distance while strafing
    const forward = dist > 18 ? 0.7 : dist < 7 ? -0.6 : 0
    this.steerToward(target.position.x, target.position.z, forward, this.strafeDir, dt)
  }

  private aimAndFire(dt: number) {
    // pitch toward the target eye height
    const dy = this.vTargetEye.y - this.vEye.y
    this.controller.pitch = Math.atan2(dy, Math.hypot(this.vTargetEye.x - this.vEye.x, this.vTargetEye.z - this.vEye.z))

    if (this.sawPlayerFor < this.params.reactionTime) return
    this.fireTimer -= dt
    if (this.fireTimer > 0) return

    if (this.burstLeft <= 0) {
      this.burstLeft = this.params.burstShots
      this.fireTimer = this.params.burstPause
      return
    }
    this.burstLeft--
    this.fireTimer = 60 / this.weapon.rpm
    this.onFired?.()
    this.onFiredRelay?.(this)

    // fire one bullet with difficulty-scaled error
    this.vDir.copy(this.vTargetEye).sub(this.vEye).normalize()
    const err = this.params.aimErrorRad
    this.vMove.set((this.rng() - 0.5) * 2, (this.rng() - 0.5) * 2, (this.rng() - 0.5) * 2)
    this.vDir.addScaledVector(this.vMove, err).normalize()

    const hit = this.world.raycast(this.vEye, this.vDir, this.weapon.range, this)
    const end = hit ? hit.point : this.vEye.clone().addScaledVector(this.vDir, this.weapon.range)
    this.effects.tracer(this.vEye.clone().addScaledVector(this.vDir, 0.6), end)
    if (!hit) return
    this.effects.impact(hit.point)
    if (hit.hitbox && !isFriendly(this.team, hit.hitbox.entity)) {
      const isHead = hit.hitbox.part === 'head'
      const damage = Math.round(this.weapon.damage * (isHead ? this.weapon.headshotMult : 1))
      if (this.damageSink) {
        this.damageSink(hit.hitbox.entity, damage, isHead, this)
        this.onShotHit(damage, false)
      } else {
        const killed = hit.hitbox.entity.takeDamage(damage, isHead)
        this.onShotHit(damage, killed)
      }
    }
  }

  private syncBody() {
    const p = this.controller.position
    this.group.position.copy(p)
    this.group.rotation.y = this.controller.yaw
    this.center.set(p.x, p.y + LEGS_H + TORSO.h / 2, p.z)

    this.bodyBox.box.min.set(p.x - TORSO.w / 2, p.y, p.z - TORSO.w / 2)
    this.bodyBox.box.max.set(p.x + TORSO.w / 2, p.y + LEGS_H + TORSO.h, p.z + TORSO.w / 2)
    this.headBox.box.min.set(p.x - HEAD.w / 2, p.y + LEGS_H + TORSO.h, p.z - HEAD.w / 2)
    this.headBox.box.max.set(p.x + HEAD.w / 2, p.y + LEGS_H + TORSO.h + HEAD.h, p.z + HEAD.w / 2)
  }
}
