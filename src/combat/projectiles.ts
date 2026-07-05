import * as THREE from 'three'
import { Damageable, PhysicsWorld } from '../world/physics'
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
  thrower: Damageable | null
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

  throwGrenade(origin: THREE.Vector3, dir: THREE.Vector3, radius: number, maxDamage: number, thrower: Damageable | null) {
    const mesh = new THREE.Mesh(this.geo, this.mat)
    mesh.position.copy(origin)
    this.scene.add(mesh)
    this.grenades.push({
      mesh,
      velocity: dir.clone().multiplyScalar(17).addScaledVector(new THREE.Vector3(0, 1, 0), 3.5),
      fuse: FUSE_SECONDS,
      radius,
      maxDamage,
      thrower,
    })
  }

  get activeCount(): number {
    return this.grenades.length
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
      this.moveAxis(g, 'x', g.velocity.x * dt)
      this.moveAxis(g, 'y', g.velocity.y * dt)
      this.moveAxis(g, 'z', g.velocity.z * dt)
    }
  }

  private moveAxis(g: Grenade, axis: 'x' | 'y' | 'z', amount: number) {
    const p = g.mesh.position
    p[axis] += amount
    this.box.min.set(p.x - SIZE, p.y - SIZE, p.z - SIZE)
    this.box.max.set(p.x + SIZE, p.y + SIZE, p.z + SIZE)
    this.world.overlaps(this.box, this.hits)
    for (const hit of this.hits) {
      if (amount > 0) p[axis] = hit.min[axis] - SIZE - 0.001
      else p[axis] = hit.max[axis] + SIZE + 0.001
      // bounce: reflect this axis, damp the others
      g.velocity[axis] *= -RESTITUTION
      for (const other of ['x', 'y', 'z'] as const) {
        if (other !== axis) g.velocity[other] *= TANGENT_FRICTION
      }
      this.box.min.set(p.x - SIZE, p.y - SIZE, p.z - SIZE)
      this.box.max.set(p.x + SIZE, p.y + SIZE, p.z + SIZE)
    }
  }

  private explode(g: Grenade) {
    const at = g.mesh.position
    this.effects.explosion(at, g.radius)
    for (const target of this.targets()) {
      if (!target.alive) continue
      const dist = target.center.distanceTo(at)
      if (dist > g.radius) continue
      const damage = Math.round(g.maxDamage * (1 - dist / g.radius))
      if (damage <= 0) continue
      const killed = target.takeDamage(damage, false)
      this.onExplosionHit(target, damage, killed)
    }
  }
}
