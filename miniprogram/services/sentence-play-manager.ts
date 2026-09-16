
// 定义分页加载器函数类型，解耦具体 API 服务
export type ListFetcher = (cursor: PlayListCursor | null, limit: number) => Promise<PlayListResult>;

export class SentencePlayListManager {
  private playQueue: Sentence[] = [];
  private currentIndex: number = 0;
  private _bookId: string = ''

  // 分页/预加载状态控制
  private fetcher: ListFetcher | null = null;
  private nextCursor: PlayListCursor | null = null;
  private hasMore: boolean = true;
  private isLoading: boolean = false;

  // 预加载阈值：当剩余未播句子少于等于 3 条时，自动触发 loadMore
  private readonly PRELOAD_THRESHOLD = 3;

  /**
   * 初始化播放队列
   * @param initialData 初始数据列表
   * @param fetcher 可选：获取后续分页数据的回调函数（解耦不同来源的数据请求）
   */
  public init(bookId: string, initialData: PlayListResult, fetcher?: ListFetcher): void {
    this.reset(); // 初始化前先重置
    this._bookId = bookId;
    this.playQueue = initialData.list || [];
    this.nextCursor = initialData.nextCursor || null;
    this.hasMore = initialData.hasMore ?? false;
    this.fetcher = fetcher || null;
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

  public get bookId(){
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
   * 播放下一句（附带自动预加载判定）
   */
  public next(): Sentence | null {
    if (this.currentIndex < this.playQueue.length - 1) {
      this.currentIndex++;

      const remainCount = this.playQueue.length - 1 - this.currentIndex;
      if (remainCount <= this.PRELOAD_THRESHOLD && this.hasMore && !this.isLoading) {
        this.loadMore();
      }

      return this.getCurrent();
    }
    return null;
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
   * 静默预加载更多句子追加到队列末尾
   */
  public async loadMore(targetCount = 20): Promise<boolean> {
    if (this.isLoading || !this.hasMore || !this.fetcher) {
      return false;
    }

    this.isLoading = true;
    try {
      const res = await this.fetcher(this.nextCursor, targetCount);

      if (res && res.list && res.list.length > 0) {
        this.playQueue = [...this.playQueue, ...res.list];
        this.nextCursor = res.nextCursor || null;
        this.hasMore = res.hasMore ?? false;
        return true;
      } else {
        this.hasMore = false;
      }
    } catch (error) {
      console.error('[SentencePlayListManager] 预加载句子失败:', error);
    } finally {
      this.isLoading = false;
    }
    return false;
  }

  /**
   * 清空重置队列
   */
  public reset(): void {
    this.playQueue = [];
    this.currentIndex = 0;
    this.nextCursor = null;
    this.hasMore = true;
    this.isLoading = false;
    this.fetcher = null;
    this._bookId = ''
  }
}

export default new SentencePlayListManager();