
import eventBus from "./EventBus";
import { AppEvent } from "./event-type";

export class SentencePlayListManager {
  private playQueue: Sentence[] = [];
  private currentIndex: number = 0;
  private _bookId: string = ''

  // 是否还有更多数据（由外部加载后通过 append/setNoMore 更新）
  private hasMore: boolean = true;
  // 已发出加载请求但数据尚未返回，防止重复发事件
  private waitingMore: boolean = false;

  // 预加载阈值：当剩余未播句子少于等于 3 条时，通知外部加载数据
  private readonly PRELOAD_THRESHOLD = 3;

  /**
   * 初始化播放队列
   * @param book 所属书本
   * @param initialData 初始数据列表
   */
  public init(book: Book, initialData: SentencePlaylistResult): void {
    this.reset(); // 初始化前先重置
    this._bookId = book._id;
    this.playQueue = initialData.list || [];
    this.hasMore = initialData.hasMore ?? false;
  }

  public get currentIndexNum(): number {
    return this.currentIndex;
  }

  public get queueLength(): number {
    return this.playQueue.length;
  }

  public get sentenceList(): Sentence[] {
    return this.playQueue;
  }

  public get bookId() {
    return this._bookId
  }

  public getCurrent(): Sentence | null {
    if (this.currentIndex >= 0 && this.currentIndex < this.playQueue.length) {
      return this.playQueue[this.currentIndex];
    }
    return null;
  }

  public get currentSentence(): Sentence | null {
    return this.getCurrent();
  }

  /**
   * 播放下一句（剩余句子不足时通知外部加载数据）
   */
  public next(): Sentence | null {
    if (this.currentIndex < this.playQueue.length - 1) {
      this.currentIndex++;
      this.checkNeedMore();
      return this.getCurrent();
    }
    return null;
  }

  /**
   * 剩余未播句子不足时，发事件通知外部加载数据
   */
  private checkNeedMore(): void {
    const remainCount = this.playQueue.length - 1 - this.currentIndex;
    if (remainCount <= this.PRELOAD_THRESHOLD && this.hasMore && !this.waitingMore) {
      this.waitingMore = true;
      eventBus.emit(AppEvent.NEED_MORE_SENTENCES, { bookId: this._bookId });
    }
  }

  /**
   * 外部加载完成后，把新数据追加进队列
   */
  public append(list: Sentence[], hasMore?: boolean): void {
    if (!Array.isArray(list) || list.length === 0) {
      this.waitingMore = false;
      return;
    }
    this.playQueue = this.playQueue.concat(list);
    if (hasMore !== undefined) {
      this.hasMore = hasMore;
    }
    this.waitingMore = false;
  }

  /**
   * 外部确认已没有更多数据
   */
  public setNoMore(): void {
    this.hasMore = false;
    this.waitingMore = false;
  }

  /**
   * 播放上一句
   */
  public prev(): Sentence | null {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      return this.getCurrent();
    }
    return null;
  }

  /**
   * 偷看当前指针前后第 offset 个位置的句子
   */
  public peek(offset: number): Sentence | null {
    const idx = this.currentIndex + offset;
    if (idx >= 0 && idx < this.playQueue.length) {
      return this.playQueue[idx];
    }
    return null;
  }

  /**
   * 更新队列中指定句子的属性（例如修改收藏状态/掌握状态）
   */
  public updateSentence(sentenceId: string, partialData: Partial<Sentence>): void {
    const target = this.playQueue.find(s => s._id === sentenceId);
    if (target) {
      Object.assign(target, partialData);
    }
  }

  /**
   * 从当前队列中移除某句子（适用于“标记为掌握后不再播放”等场景）
   */
  public removeSentence(sentenceId: string): void {
    const idx = this.playQueue.findIndex(s => s._id === sentenceId);
    if (idx !== -1) {
      this.playQueue.splice(idx, 1);
      // 如果删除的是当前节点之前的项，指针往前平移
      if (idx < this.currentIndex) {
        this.currentIndex = Math.max(0, this.currentIndex - 1);
      }
      // 边界兜底保护
      if (this.currentIndex >= this.playQueue.length) {
        this.currentIndex = Math.max(0, this.playQueue.length - 1);
      }
    }
  }

  /**
   * 清空重置队列
   */
  public reset(): void {
    this.playQueue = [];
    this.currentIndex = 0;
    this.hasMore = true;
    this.waitingMore = false;
    this._bookId = ''
  }
}

export default new SentencePlayListManager();