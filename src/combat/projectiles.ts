import * as THREE from 'three'
import { Damageable, PhysicsWorld, isFriendly } from '../world/physics'
import { Effects } from './effects'

const GRAVITY = 22
const RESTITUTION = 0.45
const TANGENT_FRICTION = 0.75
const FUSE_SECONDS = 1.7
const SIZE = 0.16

interface Grenade {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  fuse: number
  radius: number
  maxDamage: number
  /** Thrower: self-damage applies, teammates are spared. */
  source: Damageable | null
}

/** Thrown grenades: bouncing AABB physics + timed radial explosion. */
export class ProjectileManager {
  private grenades: Grenade[] = []
  private geo = new THREE.SphereGeometry(SIZE, 10, 8)
  private mat = new THREE.MeshLambertMaterial({ color: 0x2f3a45 })
  private box = new THREE.Box3()
  private hits: THREE.Box3[] = []

  constructor(
    private scene: THREE.Scene,
    private world: PhysicsWorld,
    private effects: Effects,
    /** All damageable entities (dummies + player proxy). */
    private targets: () => Damageable[],
    private onExplosionHit: (target: Damageable, damage: number, killed: boolean) => void,
  ) {}

  throwGrenade(origin: THREE.Vector3, dir: THREE.Vector3, radius: number, maxDamage: number, source: Damageable | null = null) {
    const mesh = new THREE.Mesh(this.geo, this.mat)
    mesh.position.copy(origin)
    this.scene.add(mesh)
    this.grenades.push({
      mesh,
      velocity: dir.clone().multiplyScalar(17).addScaledVector(new THREE.Vector3(0, 1, 0), 3.5),
      fuse: FUSE_SECONDS,
      radius,
      maxDamage,
      source,
    })
  }

  get activeCount(): number {
    return this.grenades.length
  }

  /** Remove all live grenades without exploding (round reset). */
  clear() {
    for (const g of this.grenades) this.scene.remove(g.mesh)
    this.grenades.length = 0
  }

  update(dt: number) {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i]
      g.fuse -= dt
      if (g.fuse <= 0) {
        this.explode(g)
        this.scene.remove(g.mesh)
        this.grenades.splice(i, 1)
        continue
      }
      g.velocity.y -= GRAVITY * dt
      this.moveAxis(g, 'x', g.velocity.x * dt, dt)
      this.moveAxis(g, 'y', g.velocity.y * dt, dt)
      this.moveAxis(g, 'z', g.velocity.z * dt, dt)
    }
  }

  private moveAxis(g: Grenade, axis: 'x' | 'y' | 'z', amount: number, dt: number) {
    const p = g.mesh.position
    p[axis] += amount
    this.box.min.set(p.x - SIZE, p.y - SIZE, p.z - SIZE)
    this.box.max.set(p.x + SIZE, p.y + SIZE, p.z + SIZE)
    this.world.overlaps(this.box, this.hits)
    for (const hit of this.hits) {
      // only resolve against boxes whose shallowest penetration is on this
      // axis — a wall brushed sideways must not be "resolved" vertically
      // (that would teleport the grenade to the wall top)
      if (!this.penetrationIsOnAxis(hit, axis)) continue
      if (amount > 0) p[axis] = hit.min[axis] - SIZE - 0.001
      else p[axis] = hit.max[axis] + SIZE + 0.001
      // bounce: reflect this axis, damp the others (dt-scaled so contact
      // friction is frame-rate independent)
      g.velocity[axis] *= -RESTITUTION
      const friction = Math.pow(TANGENT_FRICTION, dt * 60)
      for (const other of ['x', 'y', 'z'] as const) {
        if (other !== axis) g.velocity[other] *= friction
      }
      // rest on the ground instead of micro-bouncing forever
      if (axis === 'y' && amount < 0 && Math.abs(g.velocity.y) < 1.2) g.velocity.y = 0
      this.box.min.set(p.x - SIZE, p.y - SIZE, p.z - SIZE)
      this.box.max.set(p.x + SIZE, p.y + SIZE, p.z + SIZE)
      break
    }
  }

  private penetrationIsOnAxis(hit: THREE.Box3, axis: 'x' | 'y' | 'z'): boolean {
    let minDepth = Infinity
    let minAxis: 'x' | 'y' | 'z' = axis
    for (const a of ['x', 'y', 'z'] as const) {
      const depth = Math.min(this.box.max[a], hit.max[a]) - Math.max(this.box.min[a], hit.min[a])
      if (depth < minDepth) {
        minDepth = depth
        minAxis = a
      }
    }
    return minAxis === axis
  }

  private losDir = new THREE.Vector3()

  private explode(g: Grenade) {
    const at = g.mesh.position
    this.effects.explosion(at, g.radius)
    for (const target of this.targets()) {
      if (!target.alive) continue
      // no team damage — but your own grenade still hurts you
      if (target !== g.source && isFriendly(g.source?.team, target)) continue
      const dist = target.center.distanceTo(at)
      if (dist > g.radius) continue
      // occlusion: static world geometry blocks the blast (other entities don't)
      if (dist > 0.01) {
        this.losDir.copy(target.center).sub(at).divideScalar(dist)
        const hit = this.world.raycast(at, this.losDir, dist)
        if (hit && !hit.hitbox) continue
      }
      const damage = Math.round(g.maxDamage * (1 - dist / g.radius))
      if (damage <= 0) continue
      const killed = target.takeDamage(damage, false)
      this.onExplosionHit(target, damage, killed)
    }
  }
}
