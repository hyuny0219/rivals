export type DuelState = 'idle' | 'countdown' | 'combat' | 'roundEnd' | 'matchEnd'

const WIN_SCORE = 5
const COUNTDOWN_SECONDS = 3
/** Round 1 gets extra time for the in-game loadout pick (10s pick + 3-2-1). */
const FIRST_COUNTDOWN_SECONDS = 13
const ROUND_END_SECONDS = 2.2
const MATCH_END_SECONDS = 4

export interface DuelCallbacks {
  /** Reset both fighters to their spawn points with full HP/ammo. */
  onRoundStart: (round: number) => void
  /** Round banner text ('3', '2', '1', 'GO!', '라운드 승리!', ...). */
  onBanner: (text: string, sub: string, seconds: number) => void
  onMatchEnd: (playerWon: boolean) => void
}

/**
 * 1v1 duel state machine: countdown → combat → round end, first to 5 wins.
 * Movement/combat updates are gated by `frozen`.
 */
export class DuelManager {
  state: DuelState = 'idle'
  playerScore = 0
  botScore = 0
  round = 0
  private timer = 0
  private lastCount = -1

  constructor(private cb: DuelCallbacks) {}

  get active(): boolean {
    return this.state !== 'idle'
  }

  /** True while fighters must not move or shoot. */
  get frozen(): boolean {
    return this.state === 'countdown' || this.state === 'roundEnd' || this.state === 'matchEnd'
  }

  startMatch() {
    this.playerScore = 0
    this.botScore = 0
    this.round = 0
    this.startRound()
  }

  private startRound() {
    this.round++
    this.state = 'countdown'
    this.timer = this.round === 1 ? FIRST_COUNTDOWN_SECONDS : COUNTDOWN_SECONDS
    this.lastCount = -1
    this.cb.onRoundStart(this.round)
  }

  /** Called when one side is fully eliminated. */
  roundWon(playerTeamWon: boolean) {
    if (this.state !== 'combat') return
    if (playerTeamWon) this.playerScore++
    else this.botScore++
    this.endRound(playerTeamWon)
  }

  /** Both teams wiped in the same instant (e.g. a mutual grenade) — no score,
   * replay the round instead of awarding the kill to whoever we checked first. */
  roundDraw() {
    if (this.state !== 'combat') return
    this.state = 'roundEnd'
    this.timer = ROUND_END_SECONDS
    this.cb.onBanner('무승부', `${this.playerScore} : ${this.botScore}`, 2)
  }

  private endRound(playerWon: boolean) {
    if (this.playerScore >= WIN_SCORE || this.botScore >= WIN_SCORE) {
      this.state = 'matchEnd'
      this.timer = MATCH_END_SECONDS
      this.cb.onBanner(
        this.playerScore >= WIN_SCORE ? '승리!' : '패배',
        `${this.playerScore} : ${this.botScore}`,
        MATCH_END_SECONDS - 0.5,
      )
      this.cb.onMatchEnd(this.playerScore >= WIN_SCORE)
    } else {
      this.state = 'roundEnd'
      this.timer = ROUND_END_SECONDS
      this.cb.onBanner(playerWon ? '라운드 승리!' : '라운드 패배', `${this.playerScore} : ${this.botScore}`, 2)
    }
  }

  stop() {
    this.state = 'idle'
  }

  update(dt: number) {
    if (this.state === 'countdown') {
      this.timer -= dt
      const count = Math.ceil(this.timer)
      if (count !== this.lastCount && count > 0 && count <= 3) {
        this.lastCount = count
        this.cb.onBanner(String(count), `라운드 ${this.round}`, 0.95)
      }
      if (this.timer <= 0) {
        this.state = 'combat'
        this.cb.onBanner('GO!', '', 0.7)
      }
    } else if (this.state === 'roundEnd') {
      this.timer -= dt
      if (this.timer <= 0) this.startRound()
    } else if (this.state === 'matchEnd') {
      this.timer -= dt
      if (this.timer <= 0) this.stop()
    }
  }
}
