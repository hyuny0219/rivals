import { Input } from './input'

const JOY_RADIUS = 56 // px, knob travel
const LOOK_SCALE = 2.4 // touch-drag px → equivalent mouse px

/** Pointer capture keeps drags working outside the zone; failure is non-fatal. */
function capture(el: HTMLElement, pointerId: number) {
  try {
    el.setPointerCapture(pointerId)
  } catch {
    /* synthetic events or already-released pointers can't be captured */
  }
}

/** True when the device is primarily touch-driven (no fine pointer). */
export function isTouchDevice(): boolean {
  return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window
}

/**
 * Mobile touch layer: dynamic virtual joystick on the left zone, look-drag
 * on the right zone, and action buttons that synthesize the same key codes
 * the keyboard path uses.
 */
export class TouchControls {
  private moveId: number | null = null
  private lookId: number | null = null
  private originX = 0
  private originY = 0
  private lastLookX = 0
  private lastLookY = 0

  constructor(
    private input: Input,
    private moveZone: HTMLElement,
    private lookZone: HTMLElement,
    private joyBase: HTMLElement,
    private joyKnob: HTMLElement,
  ) {
    moveZone.addEventListener('pointerdown', this.onMoveStart)
    moveZone.addEventListener('pointermove', this.onMoveDrag)
    moveZone.addEventListener('pointerup', this.onMoveEnd)
    moveZone.addEventListener('pointercancel', this.onMoveEnd)

    lookZone.addEventListener('pointerdown', this.onLookStart)
    lookZone.addEventListener('pointermove', this.onLookDrag)
    lookZone.addEventListener('pointerup', this.onLookEnd)
    lookZone.addEventListener('pointercancel', this.onLookEnd)
  }

  /** Wire a HUD button to a synthesized key code (hold semantics). */
  bindButton(el: HTMLElement, code: string) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      this.input.virtualDown(code)
    })
    const release = () => this.input.virtualUp(code)
    el.addEventListener('pointerup', release)
    el.addEventListener('pointercancel', release)
    el.addEventListener('pointerleave', release)
  }

  /**
   * Fire buttons double as a look pad: hold to shoot and drag with the same
   * thumb to keep turning — the standard mobile-FPS answer to "I can't aim
   * and fire at once". Pointer capture keeps the drag alive once the finger
   * slides off the button.
   */
  bindFireButton(el: HTMLElement, code: string) {
    let activeId: number | null = null
    let lastX = 0
    let lastY = 0
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      activeId = e.pointerId
      lastX = e.clientX
      lastY = e.clientY
      capture(el, e.pointerId)
      this.input.virtualDown(code)
    })
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== activeId) return
      this.input.addMouseDelta((e.clientX - lastX) * LOOK_SCALE, (e.clientY - lastY) * LOOK_SCALE)
      lastX = e.clientX
      lastY = e.clientY
    })
    const release = (e: PointerEvent) => {
      if (e.pointerId !== activeId) return
      activeId = null
      this.input.virtualUp(code)
    }
    el.addEventListener('pointerup', release)
    el.addEventListener('pointercancel', release)
  }

  private onMoveStart = (e: PointerEvent) => {
    if (this.moveId !== null) return
    this.moveId = e.pointerId
    this.originX = e.clientX
    this.originY = e.clientY
    capture(this.moveZone, e.pointerId)
    this.joyBase.style.display = 'block'
    this.joyBase.style.left = `${e.clientX}px`
    this.joyBase.style.top = `${e.clientY}px`
    this.setKnob(0, 0)
  }

  private onMoveDrag = (e: PointerEvent) => {
    if (e.pointerId !== this.moveId) return
    let dx = e.clientX - this.originX
    let dy = e.clientY - this.originY
    const len = Math.hypot(dx, dy)
    if (len > JOY_RADIUS) {
      dx *= JOY_RADIUS / len
      dy *= JOY_RADIUS / len
    }
    this.setKnob(dx, dy)
    // screen up = forward
    this.input.setTouchMove(dx / JOY_RADIUS, -dy / JOY_RADIUS)
  }

  private onMoveEnd = (e: PointerEvent) => {
    if (e.pointerId !== this.moveId) return
    this.moveId = null
    this.joyBase.style.display = 'none'
    this.input.setTouchMove(0, 0)
  }

  private setKnob(dx: number, dy: number) {
    this.joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`
  }

  private onLookStart = (e: PointerEvent) => {
    if (this.lookId !== null) return
    this.lookId = e.pointerId
    this.lastLookX = e.clientX
    this.lastLookY = e.clientY
    capture(this.lookZone, e.pointerId)
  }

  private onLookDrag = (e: PointerEvent) => {
    if (e.pointerId !== this.lookId) return
    this.input.addMouseDelta((e.clientX - this.lastLookX) * LOOK_SCALE, (e.clientY - this.lastLookY) * LOOK_SCALE)
    this.lastLookX = e.clientX
    this.lastLookY = e.clientY
  }

  private onLookEnd = (e: PointerEvent) => {
    if (e.pointerId !== this.lookId) return
    this.lookId = null
  }
}
