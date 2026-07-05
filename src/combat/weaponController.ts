import * as THREE from 'three'
import { Input } from '../core/input'
import { Damageable, PhysicsWorld } from '../world/physics'
import { PlayerController } from '../player/controller'
import { WEAPONS, SLOT_WEAPONS, SLOT_ORDER, WeaponDef, WeaponSlot } from './weapons'
import { Effects } from './effects'
import { ProjectileManager } from './projectiles'
import { createRng } from './rng'
import { AudioEngine } from '../core/audio'

const SWITCH_TIME = 0.28
const GRENADE_REGEN_SECONDS = 8
const ADS_SENS_SCALE = 0.55
const BLOOM_DECAY = 3.5 // fraction/s exponential decay of accumulated bloom

export interface HitInfo {
  target: Damageable
  isHead: boolean
  killed: boolean
}

/**
 * Owns the loadout: firing, ammo, reloads, slot switching, spread/recoil,
 * ADS zoom, and the first-person viewmodel. Runs once per physics step so
 * shot timing is deterministic (Phase 5 server re-simulation).
 */
export class WeaponController {
  private slotIndex: Record<WeaponSlot, number> = { primary: 0, secondary: 0, melee: 0, utility: 0 }
  private currentSlot: WeaponSlot = 'primary'
  private mag = new Map<string, number>()
  private fireCooldown = 0
  private reloadTimer = 0
  private switchTimer = 0
  private bloom = 0
  private grenadeRegen = 0
  private rng: () => number

  // viewmodel
  private viewmodel = new THREE.Group()
  private muzzle = new THREE.Object3D()
  private recoilZ = 0
  private bobPhase = 0
  private baseFov: number
  private flashLight = new THREE.PointLight(0xffc36b, 0, 7)
  private flashMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 6, 4),
    new THREE.MeshBasicMaterial({ color: 0xffd9a0 }),
  )

  // scratch
  private vDir = new THREE.Vector3()
  private vRight = new THREE.Vector3()
  private vUp = new THREE.Vector3()
  private vOrigin = new THREE.Vector3()
  private vMuzzle = new THREE.Vector3()

  constructor(
    private world: PhysicsWorld,
    private player: PlayerController,
    private camera: THREE.PerspectiveCamera,
    private effects: Effects,
    private projectiles: ProjectileManager,
    /** The shooter as a damage target (ignored by own rays, hit by own grenades). */
    private self: Damageable,
    private onHit: (info: HitInfo) => void,
    private audio?: AudioEngine,
    seed = 1337,
  ) {
    this.rng = createRng(seed)
    this.baseFov = camera.fov
    for (const def of Object.values(WEAPONS)) this.mag.set(def.id, def.magazine)
    camera.add(this.viewmodel)
    this.buildViewmodel()
  }

  get weapon(): WeaponDef {
    return WEAPONS[SLOT_WEAPONS[this.currentSlot][this.slotIndex[this.currentSlot]]]
  }

  get ammoInMag(): number {
    return this.mag.get(this.weapon.id) ?? 0
  }

  get isReloading(): boolean {
    return this.reloadTimer > 0
  }

  get aiming(): boolean {
    return this.adsHeld && this.weapon.adsFov > 0 && this.switchTimer <= 0
  }

  private adsHeld = false

  /** Crosshair gap in px for the HUD. */
  get crosshairGap(): number {
    const speed = Math.hypot(this.player.velocity.x, this.player.velocity.z)
    const spread = this.currentSpread()
    return 6 + spread * 800 + speed * 0.5
  }

  update(dt: number, input: Input) {
    this.fireCooldown = Math.max(0, this.fireCooldown - dt)
    this.switchTimer = Math.max(0, this.switchTimer - dt)
    this.bloom *= Math.max(0, 1 - BLOOM_DECAY * dt)
    this.adsHeld = input.isDown('Mouse2')

    // grenade regeneration
    const grenadeDef = WEAPONS.grenade
    if ((this.mag.get('grenade') ?? 0) < grenadeDef.magazine) {
      this.grenadeRegen += dt
      if (this.grenadeRegen >= GRENADE_REGEN_SECONDS) {
        this.grenadeRegen = 0
        this.mag.set('grenade', (this.mag.get('grenade') ?? 0) + 1)
      }
    }

    // slot switching (pressing the active slot key again cycles in-slot);
    // while a switch is raising, leave presses buffered instead of eating them
    if (this.switchTimer <= 0) {
      for (let i = 0; i < SLOT_ORDER.length; i++) {
        if (input.consumePress(`Digit${i + 1}`)) this.selectSlot(SLOT_ORDER[i])
      }
    }

    // reload
    if (this.reloadTimer > 0) {
      this.reloadTimer -= dt
      if (this.reloadTimer <= 0) this.mag.set(this.weapon.id, this.weapon.magazine)
    } else if (this.switchTimer <= 0 && input.consumePress('KeyR')) {
      this.tryReload()
    }

    // fire — only consume the press when it can actually produce a shot, so
    // a click landing during cooldown/switch stays buffered for this frame
    const w = this.weapon
    if (this.canFire()) {
      const wantsFire = w.auto
        ? input.isDown('Mouse0') || input.consumePress('Mouse0')
        : input.consumePress('Mouse0')
      if (wantsFire) this.fire()
    } else if (this.magEmpty() && this.reloadTimer <= 0 && this.switchTimer <= 0 && input.consumePress('Mouse0')) {
      this.tryReload()
    }

    this.updateAds(dt)
    this.updateViewmodel(dt)
  }

  private magEmpty(): boolean {
    return this.weapon.magazine > 0 && this.ammoInMag <= 0
  }

  private canFire(): boolean {
    return this.fireCooldown <= 0 && this.switchTimer <= 0 && this.reloadTimer <= 0 && !this.magEmpty()
  }

  private selectSlot(slot: WeaponSlot) {
    if (this.switchTimer > 0) return
    if (slot === this.currentSlot) {
      const list = SLOT_WEAPONS[slot]
      if (list.length < 2) return
      this.slotIndex[slot] = (this.slotIndex[slot] + 1) % list.length
    }
    this.currentSlot = slot
    this.reloadTimer = 0
    this.switchTimer = SWITCH_TIME
    this.bloom = 0
    this.audio?.weaponSwitch()
    this.buildViewmodel()
  }

  private tryReload() {
    const w = this.weapon
    if (w.magazine <= 0 || w.kind === 'projectile') return
    if (this.ammoInMag >= w.magazine) return
    this.reloadTimer = w.reloadTime
    this.audio?.reload()
  }

  private currentSpread(): number {
    const w = this.weapon
    let spread = w.spread + this.bloom
    if (this.aiming) spread *= w.id === 'sniper' ? 0.02 : 0.35
    if (!this.player.grounded) spread *= 1.6
    return spread
  }

  private fire() {
    const w = this.weapon
    this.fireCooldown = 60 / w.rpm

    if (w.kind === 'projectile') {
      const count = this.mag.get(w.id) ?? 0
      if (count <= 0) return
      this.mag.set(w.id, count - 1)
      this.camera.getWorldDirection(this.vDir)
      this.projectiles.throwGrenade(this.camera.position, this.vDir, w.range, w.damage)
      this.audio?.throwGrenade()
    } else if (w.kind === 'melee') {
      this.camera.getWorldDirection(this.vDir)
      const hit = this.world.raycast(this.camera.position, this.vDir, w.range, this.self)
      if (hit?.hitbox) {
        const killed = hit.hitbox.entity.takeDamage(w.damage, false)
        this.onHit({ target: hit.hitbox.entity, isHead: false, killed })
      }
      if (hit) this.effects.impact(hit.point)
    } else {
      if (w.magazine > 0) this.mag.set(w.id, this.ammoInMag - 1)
      this.muzzle.getWorldPosition(this.vMuzzle)
      for (let p = 0; p < w.pellets; p++) this.fireBullet(w)
      this.bloom += w.bloom
      this.flashLight.intensity = 8
      this.flashMesh.visible = true
    }
    this.audio?.shot(w.id)

    // recoil: permanent pitch kick + small random yaw + viewmodel push-back
    this.player.punch(w.kick, (this.rng() - 0.5) * w.kick * 0.6)
    this.recoilZ = Math.min(this.recoilZ + 0.06, 0.14)
  }

  private fireBullet(w: WeaponDef) {
    this.camera.getWorldDirection(this.vDir)
    this.vRight.set(1, 0, 0).applyQuaternion(this.camera.quaternion)
    this.vUp.set(0, 1, 0).applyQuaternion(this.camera.quaternion)
    const r = this.currentSpread() * Math.sqrt(this.rng())
    const theta = this.rng() * Math.PI * 2
    this.vDir
      .addScaledVector(this.vRight, r * Math.cos(theta))
      .addScaledVector(this.vUp, r * Math.sin(theta))
      .normalize()
    this.vOrigin.copy(this.camera.position)

    const hit = this.world.raycast(this.vOrigin, this.vDir, w.range, this.self)
    const end = hit ? hit.point : this.vOrigin.clone().addScaledVector(this.vDir, w.range)
    this.effects.tracer(this.vMuzzle, end)
    if (!hit) return
    this.effects.impact(hit.point)
    if (hit.hitbox) {
      const isHead = hit.hitbox.part === 'head'
      const damage = Math.round(w.damage * (isHead ? w.headshotMult : 1))
      const killed = hit.hitbox.entity.takeDamage(damage, isHead)
      this.onHit({ target: hit.hitbox.entity, isHead, killed })
    }
  }

  private updateAds(dt: number) {
    const targetFov = this.aiming ? this.weapon.adsFov : this.baseFov
    if (Math.abs(this.camera.fov - targetFov) > 0.1) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, Math.min(1, dt * 14))
      this.camera.updateProjectionMatrix()
    }
    this.player.sensScale = this.aiming ? ADS_SENS_SCALE : 1
  }

  /** Instantly drop ADS state (called when the game is paused). */
  resetAds() {
    this.adsHeld = false
    this.camera.fov = this.baseFov
    this.camera.updateProjectionMatrix()
    this.player.sensScale = 1
  }

  /** Change the base (non-ADS) field of view — from the settings menu. */
  setBaseFov(fov: number) {
    this.baseFov = fov
    if (!this.aiming) {
      this.camera.fov = fov
      this.camera.updateProjectionMatrix()
    }
  }

  /** Equip a loadout and refill everything (duel round start). */
  setLoadout(primaryId: string, secondaryId: string) {
    this.slotIndex.primary = Math.max(0, SLOT_WEAPONS.primary.indexOf(primaryId))
    this.slotIndex.secondary = Math.max(0, SLOT_WEAPONS.secondary.indexOf(secondaryId))
    this.currentSlot = 'primary'
    this.reloadTimer = 0
    this.fireCooldown = 0
    this.switchTimer = 0
    this.bloom = 0
    this.grenadeRegen = 0
    for (const def of Object.values(WEAPONS)) this.mag.set(def.id, def.magazine)
    this.resetAds()
    this.buildViewmodel()
  }

  // ---------- viewmodel ----------

  private buildViewmodel() {
    this.viewmodel.traverse((o) => {
      if (o instanceof THREE.Mesh && o !== this.flashMesh) {
        o.geometry.dispose()
        ;(o.material as THREE.Material).dispose()
      }
    })
    this.viewmodel.clear()
    this.muzzle = new THREE.Object3D()
    const w = this.weapon
    const dark = new THREE.MeshLambertMaterial({ color: 0x2c343d })
    const accent = new THREE.MeshLambertMaterial({ color: 0xff5a3c })
    const grip = new THREE.MeshLambertMaterial({ color: 0x1d232a })
    const boxMesh = (mat: THREE.Material, w_: number, h: number, d: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w_, h, d), mat)
      m.position.set(x, y, z)
      this.viewmodel.add(m)
      return m
    }

    if (w.kind === 'melee') {
      boxMesh(grip, 0.05, 0.14, 0.05, 0, -0.05, 0) // handle
      boxMesh(new THREE.MeshLambertMaterial({ color: 0xc8d2dc }), 0.012, 0.06, 0.34, 0, 0.02, -0.22) // blade
      this.muzzle.position.set(0, 0, -0.3)
    } else if (w.kind === 'projectile') {
      const nade = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), dark)
      this.viewmodel.add(nade)
      this.muzzle.position.set(0, 0, -0.15)
    } else {
      const len = w.id === 'sniper' ? 0.75 : w.id === 'shotgun' ? 0.6 : w.id === 'pistol' ? 0.3 : w.id === 'uzi' ? 0.35 : 0.55
      boxMesh(dark, 0.07, 0.11, len, 0, 0, -len / 2) // body
      boxMesh(dark, 0.035, 0.035, 0.22, 0, 0.02, -len - 0.1) // barrel
      boxMesh(grip, 0.05, 0.14, 0.06, 0, -0.11, 0.02) // grip
      if (w.id !== 'pistol') boxMesh(grip, 0.05, 0.12, 0.05, 0, -0.1, -len * 0.55) // front grip / mag
      boxMesh(accent, 0.072, 0.02, 0.1, 0, 0.065, -len * 0.3) // sight rail accent
      this.muzzle.position.set(0, 0.02, -len - 0.22)
    }
    // reusable muzzle flash (light + glow sphere) rides on the muzzle
    this.flashLight.intensity = 0
    this.flashMesh.visible = false
    this.muzzle.add(this.flashLight)
    this.muzzle.add(this.flashMesh)
    this.viewmodel.add(this.muzzle)
    this.viewmodel.position.set(0.32, -0.28, -0.5)
  }

  /** Purely visual decay that must keep running even when the sim freezes. */
  tickVisual(dt: number) {
    if (this.flashLight.intensity > 0) {
      this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dt * 160)
      if (this.flashLight.intensity < 1) {
        this.flashLight.intensity = 0
        this.flashMesh.visible = false
      }
    }
  }

  private updateViewmodel(dt: number) {
    this.recoilZ = Math.max(0, this.recoilZ - dt * 0.9)
    const speed = Math.hypot(this.player.velocity.x, this.player.velocity.z)
    if (this.player.grounded && speed > 0.5) this.bobPhase += dt * Math.min(speed, 10) * 1.6
    const bobX = Math.sin(this.bobPhase) * 0.008
    const bobY = -Math.abs(Math.cos(this.bobPhase)) * 0.008
    // raise/lower during switch and reload
    const switchDip = this.switchTimer > 0 ? (this.switchTimer / SWITCH_TIME) * 0.25 : 0
    const reloadDip = this.reloadTimer > 0 ? 0.12 : 0
    const aimX = this.aiming ? -0.32 : 0 // center the gun while aiming

    this.viewmodel.position.set(
      0.32 + bobX + aimX,
      -0.28 + bobY - switchDip - reloadDip,
      -0.5 + this.recoilZ,
    )
    this.viewmodel.rotation.x = this.recoilZ * 0.8 + (this.reloadTimer > 0 ? -0.35 : 0)
  }
}
