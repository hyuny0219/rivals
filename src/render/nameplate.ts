import * as THREE from 'three'

/**
 * Floating name label as a canvas sprite. Ally plates render through walls
 * (depthTest off); enemy plates are occluded by geometry like the body.
 */
export function makeNameplate(text: string, colorCss: string, showThroughWalls: boolean): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const ctx = canvas.getContext('2d')!
  ctx.font = 'bold 32px "Segoe UI", "Apple SD Gothic Neo", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const width = Math.min(244, ctx.measureText(text).width + 30)
  ctx.fillStyle = 'rgba(10, 14, 22, 0.6)'
  ctx.beginPath()
  ctx.roundRect(128 - width / 2, 8, width, 48, 12)
  ctx.fill()
  ctx.fillStyle = colorCss
  ctx.fillText(text, 128, 34)

  const texture = new THREE.CanvasTexture(canvas)
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: !showThroughWalls,
  })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(1.7, 0.42, 1)
  sprite.position.y = 2.35
  return sprite
}

export function disposeNameplate(sprite: THREE.Sprite) {
  sprite.material.map?.dispose()
  sprite.material.dispose()
}

export interface Healthbar {
  group: THREE.Group
  setHealth(frac: number): void
  dispose(): void
}

/**
 * Floating HP bar (two camera-facing sprites: dark track + colored fill that
 * scales/left-aligns with health). Cheap to update — no per-frame texture
 * redraw. Ally bars render through walls like ally nameplates.
 */
export function makeHealthbar(colorHex: number, showThroughWalls: boolean): Healthbar {
  const W = 1.5
  const H = 0.15
  const depthTest = !showThroughWalls
  const bgMat = new THREE.SpriteMaterial({ color: 0x0a0e16, transparent: true, opacity: 0.72, depthTest, depthWrite: false })
  const fillMat = new THREE.SpriteMaterial({ color: colorHex, transparent: true, depthTest, depthWrite: false })
  const bg = new THREE.Sprite(bgMat)
  bg.scale.set(W, H, 1)
  bg.renderOrder = 2
  const fill = new THREE.Sprite(fillMat)
  fill.scale.set(W, H, 1)
  fill.renderOrder = 3
  const group = new THREE.Group()
  group.add(bg, fill)
  group.position.y = 2.06 // just under the nameplate (which sits at 2.35)

  function setHealth(frac: number) {
    const f = Math.max(0, Math.min(1, frac))
    const w = Math.max(0.0001, f * W)
    fill.scale.x = w
    fill.position.x = -(W - w) / 2 // grow/shrink from the left edge
    fill.visible = f > 0
  }
  setHealth(1)

  return {
    group,
    setHealth,
    dispose() {
      bgMat.dispose()
      fillMat.dispose()
    },
  }
}
