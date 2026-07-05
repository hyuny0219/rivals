import * as THREE from 'three'
import { Damageable, PhysicsWorld } from '../world/physics'
import { Effects } from '../combat/effects'

const HEAD = { w: 0.34, h: 0.34 }
const TORSO = { w: 0.72, h: 0.95, d: 0.38 }
const TORSO_BOTTOM = 0.85 // pole height under the torso
const RESPAWN_SECONDS = 3
const MAX_HP = 100

/** Static practice target with head/body hitboxes; respawns after death. */
export class TargetDummy implements Damageable {
  readonly center = new THREE.Vector3()
  alive = true
  hp = MAX_HP
  readonly group = new THREE.Group()
  private respawnTimer = 0

  constructor(
    readonly name: string,
    position: THREE.Vector3,
    world: PhysicsWorld,
    private effects: Effects,
    private onKilled: (dummy: TargetDummy) => void,
  ) {
    const mat = (color: number) => new THREE.MeshLambertMaterial({ color })

    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.12, TORSO_BOTTOM, 0.12), mat(0x4a5561))
    pole.position.y = TORSO_BOTTOM / 2
    const torso = new THREE.Mesh(new THREE.BoxGeometry(TORSO.w, TORSO.h, TORSO.d), mat(0x3e8fb0))
    torso.position.y = TORSO_BOTTOM + TORSO.h / 2
    const head = new THREE.Mesh(new THREE.BoxGeometry(HEAD.w, HEAD.h, HEAD.w), mat(0xf2c14e))
    head.position.y = TORSO_BOTTOM + TORSO.h + HEAD.h / 2
    for (const m of [pole, torso, head]) {
      // no castShadow: the shadow map is a static cache (see main.ts) and a
      // despawning dummy would leave a stale shadow behind
      m.receiveShadow = true
      this.group.add(m)
    }
    this.group.position.copy(position)

    this.center.copy(position).y += TORSO_BOTTOM + TORSO.h / 2

    const p = position
    world.addHitbox({
      entity: this,
      part: 'body',
      box: new THREE.Box3(
        new THREE.Vector3(p.x - TORSO.w / 2, p.y + TORSO_BOTTOM, p.z - TORSO.d / 2),
        new THREE.Vector3(p.x + TORSO.w / 2, p.y + TORSO_BOTTOM + TORSO.h, p.z + TORSO.d / 2),
      ),
    })
    world.addHitbox({
      entity: this,
      part: 'head',
      box: new THREE.Box3(
        new THREE.Vector3(p.x - HEAD.w / 2, p.y + TORSO_BOTTOM + TORSO.h, p.z - HEAD.w / 2),
        new THREE.Vector3(p.x + HEAD.w / 2, p.y + TORSO_BOTTOM + TORSO.h + HEAD.h, p.z + HEAD.w / 2),
      ),
    })
  }

  takeDamage(amount: number, _isHead: boolean): boolean {
    if (!this.alive) return false
    this.hp -= amount
    if (this.hp <= 0) {
      this.alive = false
      this.group.visible = false
      this.respawnTimer = RESPAWN_SECONDS
      this.effects.puff(this.center, 0xf2c14e)
      this.onKilled(this)
      return true
    }
    return false
  }

  /** Practice targets are disabled entirely during duels. */
  private enabled = true

  setEnabled(v: boolean) {
    this.enabled = v
    this.alive = v
    this.hp = MAX_HP
    this.group.visible = v
  }

  update(dt: number) {
    if (!this.enabled || this.alive) return
    this.respawnTimer -= dt
    if (this.respawnTimer <= 0) {
      this.alive = true
      this.hp = MAX_HP
      this.group.visible = true
    }
  }
}
