/**
 * Procedural sound engine — every effect is synthesized with WebAudio
 * (oscillators + filtered noise), so the game ships zero audio assets.
 * The context is created lazily on the first user gesture.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noiseBuf: AudioBuffer | null = null
  private volume = 0.8

  /** Call from a user-gesture handler (play button). */
  ensure() {
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.master = this.ctx.createGain()
      this.master.gain.value = this.volume
      this.master.connect(this.ctx.destination)

      const len = this.ctx.sampleRate
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
      const data = this.noiseBuf.getChannelData(0)
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  setVolume(v: number) {
    this.volume = v
    if (this.master) this.master.gain.value = v
  }

  /** Filtered white-noise burst with an exponential decay envelope. */
  private noise(duration: number, gain: number, filterType: BiquadFilterType, freq: number, freqEnd?: number) {
    if (!this.ctx || !this.master || !this.noiseBuf) return
    const t = this.ctx.currentTime
    const src = this.ctx.createBufferSource()
    src.buffer = this.noiseBuf
    src.loop = true
    const filter = this.ctx.createBiquadFilter()
    filter.type = filterType
    filter.frequency.setValueAtTime(freq, t)
    if (freqEnd !== undefined) filter.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + duration)
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + duration)
    src.connect(filter).connect(g).connect(this.master)
    src.start(t, Math.random())
    src.stop(t + duration + 0.02)
  }

  /** Single oscillator blip with decay (and optional pitch sweep). */
  private tone(freq: number, duration: number, gain: number, type: OscillatorType = 'sine', freqEnd?: number, delay = 0) {
    if (!this.ctx || !this.master) return
    const t = this.ctx.currentTime + delay
    const osc = this.ctx.createOscillator()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t)
    if (freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + duration)
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + duration)
    osc.connect(g).connect(this.master)
    osc.start(t)
    osc.stop(t + duration + 0.02)
  }

  /** Weapon report, character varies per weapon; scale attenuates distance. */
  shot(weaponId: string, scale = 1) {
    switch (weaponId) {
      case 'sniper':
        this.noise(0.35, 0.5 * scale, 'lowpass', 3200, 300)
        this.tone(160, 0.25, 0.4 * scale, 'triangle', 50)
        break
      case 'shotgun':
        this.noise(0.28, 0.55 * scale, 'lowpass', 2200, 250)
        this.tone(120, 0.22, 0.45 * scale, 'triangle', 45)
        break
      case 'pistol':
        this.noise(0.12, 0.35 * scale, 'bandpass', 1800)
        this.tone(220, 0.08, 0.2 * scale, 'square', 90)
        break
      case 'uzi':
        this.noise(0.08, 0.28 * scale, 'bandpass', 2400)
        break
      case 'knife':
        this.noise(0.12, 0.18 * scale, 'bandpass', 4000, 900)
        break
      default: // ar
        this.noise(0.14, 0.38 * scale, 'bandpass', 1500, 500)
        this.tone(180, 0.1, 0.22 * scale, 'square', 70)
    }
  }

  emptyClick() {
    this.tone(1200, 0.04, 0.15, 'square')
  }

  reload() {
    this.tone(900, 0.05, 0.2, 'square')
    this.tone(600, 0.05, 0.2, 'square', undefined, 0.12)
  }

  weaponSwitch() {
    this.tone(500, 0.06, 0.15, 'square', 700)
  }

  hit(kill: boolean) {
    if (kill) {
      this.tone(880, 0.09, 0.35, 'sine')
      this.tone(1320, 0.14, 0.35, 'sine', undefined, 0.07)
    } else {
      this.tone(1600, 0.05, 0.25, 'sine', 1200)
    }
  }

  hurt() {
    this.tone(140, 0.18, 0.4, 'triangle', 70)
    this.noise(0.12, 0.15, 'lowpass', 600)
  }

  footstep() {
    this.noise(0.06, 0.08, 'lowpass', 500, 200)
  }

  jump() {
    this.noise(0.1, 0.08, 'bandpass', 900, 1500)
  }

  land() {
    this.noise(0.09, 0.15, 'lowpass', 400, 150)
  }

  dash() {
    this.noise(0.2, 0.2, 'bandpass', 700, 2400)
  }

  slide() {
    this.noise(0.25, 0.12, 'lowpass', 900, 300)
  }

  explosion(scale = 1) {
    this.noise(0.6, 0.7 * scale, 'lowpass', 1400, 80)
    this.tone(70, 0.5, 0.5 * scale, 'sine', 30)
  }

  throwGrenade() {
    this.noise(0.12, 0.12, 'bandpass', 1200, 2000)
  }

  countdownBeep() {
    this.tone(880, 0.1, 0.25, 'sine')
  }

  go() {
    this.tone(1174, 0.18, 0.3, 'sine')
  }

  win() {
    this.tone(659, 0.14, 0.3, 'sine')
    this.tone(830, 0.14, 0.3, 'sine', undefined, 0.13)
    this.tone(988, 0.3, 0.3, 'sine', undefined, 0.26)
  }

  lose() {
    this.tone(440, 0.2, 0.3, 'sine')
    this.tone(330, 0.35, 0.3, 'sine', undefined, 0.18)
  }

  roundWin() {
    this.tone(659, 0.12, 0.25, 'sine')
    this.tone(880, 0.2, 0.25, 'sine', undefined, 0.11)
  }

  roundLose() {
    this.tone(392, 0.12, 0.25, 'sine')
    this.tone(294, 0.2, 0.25, 'sine', undefined, 0.11)
  }
}
