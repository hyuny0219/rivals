import * as THREE from 'three'
import { Damageable, Hitbox, PhysicsWorld } from '../world/physics'
import { PeerSnapshot } from '../net/online'

const HEAD = { w: 0.4, h: 0.4 }
const TORSO = { w: 0.8, h: 0.85, d: 0.42 }
const LEGS_H = 0.75
const SLIDE_SCALE = 0.55 // visual squash while the peer slides
/** Render this far in the past so we always interpolate between snapshots. */
const INTERP_DELAY = 0.1

interface TimedSnapshot extends PeerSnapshot {
  at: number
}

/**
 * The opponent in an online duel: renders interpolated snapshots and exposes
 * hitboxes so the local player's shots can claim damage against it.
 * takeDamage does not mutate HP — the server owns HP; it reports the claim.
 */
export class RemotePlayer implements Damageable {
  readonly name = '상대'
  readonly center = new THREE.Vector3()
  alive = false
  readonly group = new THREE.Group()
  readonly position = new THREE.Vector3()
  yaw = 0
  pitch = 0

  /** Called with the claimed damage when a local shot lands. */
  onDamageClaim: (damage: number, isHead: boolean, weaponId: string) => void = () => {}

  private buffer: TimedSnapshot[] = []
  private clock = 0
  private sliding = false
  private body: THREE.Group
  private headBox: Hitbox
  private bodyBox: Hitbox

  constructor(world: PhysicsWorld) {
    const mat = (color: number) => new THREE.MeshLambertMaterial({ color })
    this.body = new THREE.Group()
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.3, LEGS_H, 0.34), mat(0x2f3a45))
    legL.position.set(-0.21, LEGS_H / 2, 0)
    const legR = legL.clone()
    legR.position.x = 0.21
    const torso = new THREE.Mesh(new THREE.BoxGeometry(TORSO.w, TORSO.h, TORSO.d), mat(0x3f6fc9))
    torso.position.y = LEGS_H + TORSO.h / 2
    const head = new THREE.Mesh(new THREE.BoxGeometry(HEAD.w, HEAD.h, HEAD.w), mat(0xf2c14e))
    head.position.y = LEGS_H + TORSO.h + HEAD.h / 2
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.55), mat(0x22282f))
    gun.position.set(0.28, LEGS_H + TORSO.h * 0.7, -0.3)
    for (const m of [legL, legR, torso, head, gun]) {
      m.receiveShadow = true
      this.body.add(m)
    }
    this.group.add(this.body)
    this.group.visible = false

    this.headBox = { entity: this, part: 'head', box: new THREE.Box3() }
    this.bodyBox = { entity: this, part: 'body', box: new THREE.Box3() }
    world.addHitbox(this.headBox)
    world.addHitbox(this.bodyBox)
  }

  takeDamage(amount: number, isHead: boolean): boolean {
    if (!this.alive) return false
    this.onDamageClaim(amount, isHead, '')
    return false // the server decides kills
  }

  activate(position: THREE.Vector3, yaw: number) {
    this.alive = true
    this.group.visible = true
    this.buffer.length = 0
    this.clock = 0
    this.position.copy(position)
    this.yaw = yaw
    this.sync()
  }

  deactivate() {
    this.alive = false
    this.group.visible = false
    this.buffer.length = 0
  }

  pushSnapshot(snap: PeerSnapshot) {
    this.buffer.push({ ...snap, at: this.clock })
    // keep a short history only
    while (this.buffer.length > 30) this.buffer.shift()
  }

  /** The eye position peers shoot from (for remote tracer visuals). */
  eyePosition(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.position.x, this.position.y + 1.62, this.position.z)
  }

  update(dt: number) {
    if (!this.alive) return
    this.clock += dt
    const renderAt = this.clock - INTERP_DELAY

    // find the snapshot pair straddling renderAt
    const buf = this.buffer
    if (buf.length > 0) {
      let next = buf.length - 1
      for (let i = 0; i < buf.length; i++) {
        if (buf[i].at >= renderAt) {
          next = i
          break
        }
      }
      const b = buf[next]
      const a = next > 0 ? buf[next - 1] : b
      const span = b.at - a.at
      const t = span > 0.0001 ? THREE.MathUtils.clamp((renderAt - a.at) / span, 0, 1) : 1
      this.position.set(
        THREE.MathUtils.lerp(a.x, b.x, t),
        THREE.MathUtils.lerp(a.y, b.y, t),
        THREE.MathUtils.lerp(a.z, b.z, t),
      )
      // shortest-path yaw lerp
      let dy = b.yaw - a.yaw
      while (dy > Math.PI) dy -= Math.PI * 2
      while (dy < -Math.PI) dy += Math.PI * 2
      this.yaw = a.yaw + dy * t
      this.pitch = THREE.MathUtils.lerp(a.pitch, b.pitch, t)
      this.sliding = t < 0.5 ? a.sliding : b.sliding
      // drop history older than the render point
      while (buf.length > 2 && buf[1].at < renderAt) buf.shift()
    }
    this.sync()
  }

  private sync() {
    this.group.position.copy(this.position)
    this.group.rotation.y = this.yaw
    this.body.scale.y = this.sliding ? SLIDE_SCALE : 1
    const h = this.sliding ? (LEGS_H + TORSO.h) * SLIDE_SCALE : LEGS_H + TORSO.h
    const p = this.position
    this.center.set(p.x, p.y + h / 2, p.z)
    this.bodyBox.box.min.set(p.x - TORSO.w / 2, p.y, p.z - TORSO.w / 2)
    this.bodyBox.box.max.set(p.x + TORSO.w / 2, p.y + h, p.z + TORSO.w / 2)
    const headH = this.sliding ? HEAD.h * SLIDE_SCALE : HEAD.h
    this.headBox.box.min.set(p.x - HEAD.w / 2, p.y + h, p.z - HEAD.w / 2)
    this.headBox.box.max.set(p.x + HEAD.w / 2, p.y + h + headH, p.z + HEAD.w / 2)
  }
}
