
import { signal } from "@preact/signals-core";
import eventBus from "./EventBus";
import { AppEvent } from "./event-type";

export class SentencePlayListManager {
  /**
   * 播放队列（signal 化单一事实源）：
   * 所有变更一律替换数组引用（不可变更新），页面通过 bindSignal 自动同步，
   * 消灭散布各页面的 setData({ sentenceList: [...] }) 手动拷贝。
   */
  readonly queue = signal<Sentence[]>([]);
  /** 当前播放指针（signal 化） */
  readonly index = signal(0);

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
    this.queue.value = initialData.list || [];
    this.hasMore = initialData.hasMore ?? false;
  }

  public get currentIndexNum(): number {
    return this.index.value;
  }

  public get queueLength(): number {
    return this.queue.value.length;
  }

  public get sentenceList(): Sentence[] {
    return this.queue.value;
  }

  public get bookId() {
    return this._bookId
  }

  public getCurrent(): Sentence | null {
    const queue = this.queue.value;
    const idx = this.index.value;
    if (idx >= 0 && idx < queue.length) {
      return queue[idx];
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
    if (this.index.value < this.queue.value.length - 1) {
      this.index.value = this.index.value + 1;
      this.checkNeedMore();
      return this.getCurrent();
    }
    return null;
  }

  /**
   * 剩余未播句子不足时，发事件通知外部加载数据
   */
  private checkNeedMore(): void {
    const remainCount = this.queue.value.length - 1 - this.index.value;
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
    this.queue.value = this.queue.value.concat(list);
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
    if (this.index.value > 0) {
      this.index.value = this.index.value - 1;
      return this.getCurrent();
    }
    return null;
  }

  /**
   * 偷看当前指针前后第 offset 个位置的句子
   */
  public peek(offset: number): Sentence | null {
    const idx = this.index.value + offset;
    const queue = this.queue.value;
    if (idx >= 0 && idx < queue.length) {
      return queue[idx];
    }
    return null;
  }

  /**
   * 更新队列中指定句子的属性（例如修改收藏状态/掌握状态）
   * 不可变更新：替换目标句子对象及整个数组引用，触发 signal 通知页面自动刷新
   */
  public updateSentence(sentenceId: string, partialData: Partial<Sentence>): void {
    const idx = this.queue.value.findIndex(s => s._id === sentenceId);
    if (idx === -1) return;
    const list = this.queue.value.slice();
    list[idx] = { ...list[idx], ...partialData };
    this.queue.value = list;
  }

  /**
   * 从当前队列中移除某句子（适用于"标记为掌握后不再播放"等场景）
   */
  public removeSentence(sentenceId: string): void {
    const idx = this.queue.value.findIndex(s => s._id === sentenceId);
    if (idx !== -1) {
      const list = this.queue.value.slice();
      list.splice(idx, 1);
      this.queue.value = list;
      // 如果删除的是当前节点之前的项，指针往前平移
      if (idx < this.index.value) {
        this.index.value = Math.max(0, this.index.value - 1);
      }
      // 边界兜底保护
      if (this.index.value >= list.length) {
        this.index.value = Math.max(0, list.length - 1);
      }
    }
  }

  /**
   * 清空重置队列
   */
  public reset(): void {
    this.queue.value = [];
    this.index.value = 0;
    this.hasMore = true;
    this.waitingMore = false;
    this._bookId = ''
  }
}

export default new SentencePlayListManager();
