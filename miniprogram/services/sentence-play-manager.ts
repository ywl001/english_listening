export class SentencePlayListManager {
  private playQueue: Sentence[] = []
  private currentIndex = 0
  private _bookId = ''

  public init(book: Book, list: Sentence[]): void {
    this.reset()
    this._bookId = book._id
    this.playQueue = list
  }

  public get currentIndexNum(): number {
    return this.currentIndex
  }

  public get queueLength(): number {
    return this.playQueue.length
  }

  public get sentenceList(): Sentence[] {
    return this.playQueue
  }

  public get bookId(): string {
    return this._bookId
  }

  public getCurrent(): Sentence | null {
    return this.playQueue[this.currentIndex] || null
  }

  public get currentSentence(): Sentence | null {
    return this.getCurrent()
  }

  public next(): Sentence | null {
    if (this.currentIndex < this.playQueue.length - 1) {
      this.currentIndex++
      return this.getCurrent()
    }
    return null
  }

  public prev(): Sentence | null {
    if (this.currentIndex > 0) {
      this.currentIndex--
      return this.getCurrent()
    }
    return null
  }

  public peek(offset: number): Sentence | null {
    const idx = this.currentIndex + offset
    return this.playQueue[idx] || null
  }

  public updateSentence(sentenceId: string, partialData: Partial<Sentence>): void {
    const target = this.playQueue.find(s => s._id === sentenceId)
    if (target) Object.assign(target, partialData)
  }

  public removeSentence(sentenceId: string): void {
    const idx = this.playQueue.findIndex(s => s._id === sentenceId)
    if (idx === -1) return

    this.playQueue.splice(idx, 1)

    if (idx < this.currentIndex) {
      this.currentIndex--
    } else if (this.currentIndex >= this.playQueue.length) {
      this.currentIndex = Math.max(0, this.playQueue.length - 1)
    }
  }

  public replace(list: Sentence[]): void {
    const currentId = this.getCurrent()?._id
    this.playQueue = list

    const index = currentId
      ? this.playQueue.findIndex(x => x._id === currentId)
      : -1

    this.currentIndex = index >= 0 ? index : 0
  }

  public reset(): void {
    this.playQueue = []
    this.currentIndex = 0
    this._bookId = ''
  }
}

export default new SentencePlayListManager()