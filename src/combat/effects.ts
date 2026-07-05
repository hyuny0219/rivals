import * as THREE from 'three'
import { AudioEngine } from '../core/audio'

interface Transient {
  object: THREE.Object3D
  ttl: number
  life: number
  update?: (t: number, object: THREE.Object3D) => void // t: 0 → 1 over lifetime
}

/** Short-lived visual effects: tracers, impact sparks, explosions. */
export class Effects {
  private items: Transient[] = []
  private tracerMat = new THREE.LineBasicMaterial({ color: 0xffe0a0, transparent: true })
  private sparkGeo = new THREE.SphereGeometry(0.06, 6, 4)
  private sparkMat = new THREE.MeshBasicMaterial({ color: 0xffc36b })
  private boomGeo = new THREE.SphereGeometry(1, 16, 12)

  constructor(
    private scene: THREE.Scene,
    private audio?: AudioEngine,
    /** Listener position for distance attenuation (the camera). */
    private listener?: () => THREE.Vector3,
  ) {}

  private add(object: THREE.Object3D, ttl: number, update?: Transient['update']) {
    this.scene.add(object)
    this.items.push({ object, ttl, life: ttl, update })
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to])
    const line = new THREE.Line(geo, this.tracerMat.clone())
    this.add(line, 0.07, (t, obj) => {
      ;((obj as THREE.Line).material as THREE.LineBasicMaterial).opacity = 1 - t
    })
  }

  impact(point: THREE.Vector3) {
    const m = new THREE.Mesh(this.sparkGeo, this.sparkMat)
    m.position.copy(point)
    this.add(m, 0.12, (t, obj) => obj.scale.setScalar(1 - t * 0.7))
  }

  explosion(point: THREE.Vector3, radius: number) {
    const dist = this.listener ? point.distanceTo(this.listener()) : 0
    this.audio?.explosion(Math.max(0.15, 1 - dist / 45))
    const mat = new THREE.MeshBasicMaterial({ color: 0xff8b3c, transparent: true, opacity: 0.85 })
    const m = new THREE.Mesh(this.boomGeo, mat)
    m.position.copy(point)
    this.add(m, 0.35, (t, obj) => {
      obj.scale.setScalar(0.4 + t * radius)
      ;((obj as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - t)
    })
  }

  /** Floating damage number that rises off the target and fades. */
  damageNumber(point: THREE.Vector3, amount: number, isHead = false) {
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 72
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.font = 'bold 52px system-ui, Arial, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineWidth = 7
    ctx.strokeStyle = 'rgba(0,0,0,0.9)'
    ctx.fillStyle = isHead ? '#ffd24a' : '#ffffff'
    const text = String(Math.round(amount))
    ctx.strokeText(text, 64, 38)
    ctx.fillText(text, 64, 38)
    const tex = new THREE.CanvasTexture(canvas)
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false })
    const spr = new THREE.Sprite(mat)
    spr.position.copy(point)
    spr.position.y += 0.35
    const scale = isHead ? 0.95 : 0.72
    spr.scale.set(scale * 1.6, scale, 1)
    spr.userData.baseY = spr.position.y
    this.add(spr, 0.75, (t, obj) => {
      obj.position.y = (obj.userData.baseY as number) + t * 0.8
      ;((obj as THREE.Sprite).material as THREE.SpriteMaterial).opacity = 1 - t * t
    })
  }

  puff(point: THREE.Vector3, color = 0x9aa5b1) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7 })
    const m = new THREE.Mesh(this.boomGeo, mat)
    m.position.copy(point)
    this.add(m, 0.3, (t, obj) => {
      obj.scale.setScalar(0.2 + t * 1.2)
      ;((obj as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - t)
    })
  }

  update(dt: number) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]
      it.ttl -= dt
      if (it.ttl <= 0) {
        this.scene.remove(it.object)
        disposeObject(it.object)
        this.items.splice(i, 1)
        continue
      }
      it.update?.(1 - it.ttl / it.life, it.object)
    }
  }
}

function disposeObject(obj: THREE.Object3D) {
  const anyObj = obj as THREE.Mesh
  // shared geometries/materials are reused via clone-less references; only
  // dispose what each effect uniquely allocated (tracer lines)
  if (obj instanceof THREE.Line) {
    anyObj.geometry.dispose()
    ;(anyObj.material as THREE.Material).dispose()
  } else if (obj instanceof THREE.Sprite) {
    const m = obj.material as THREE.SpriteMaterial
    m.map?.dispose()
    m.dispose()
  } else if (anyObj.material && (anyObj.material as THREE.Material).transparent) {
    ;(anyObj.material as THREE.Material).dispose()
  }
}
