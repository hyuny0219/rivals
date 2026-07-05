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
