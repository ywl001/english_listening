import sentenceService from "./sentence-service";

export class SentencePlayListManager {
  private playQueue: Sentence[] = [];
  private currentIndex: number = 0;
  
  // 分页/预加载状态控制
  private bookId: string = '';
  private nextCursor: PlayListCursor | null = null;
  private hasMore: boolean = true;
  private isLoading: boolean = false;
  
  // 预加载阈值：当剩余未播句子少于等于 3 条时，自动触发 loadMore
  private readonly PRELOAD_THRESHOLD = 3; 

  /**
   * 初始化播放队列
   * @param bookId 句子书ID
   * @param initialData 首次调用 getPlayList 接口返回的数据
   */
  public init(bookId: string, initialData: PlayListResult): void {
    this.bookId = bookId;
    this.playQueue = initialData.list || [];
    this.nextCursor = initialData.nextCursor || null;
    this.hasMore = initialData.hasMore ?? false;
    this.currentIndex = 0;
    this.isLoading = false;
  }

  /**
   * 获取当前播放索引（只读）
   */
  public get currentIndexNum(): number {
    return this.currentIndex;
  }

  /**
   * 获取当前播放队列的条数（只读）
   */
  public get queueLength(): number {
    return this.playQueue.length;
  }

  /**
   * 获取当前句子
   */
  public getCurrent(): Sentence | null {
    if (this.currentIndex >= 0 && this.currentIndex < this.playQueue.length) {
      return this.playQueue[this.currentIndex];
    }
    return null;
  }

  /**
   * 播放下一句（附带自动预加载判定）
   */
  public next(): Sentence | null {
    if (this.currentIndex < this.playQueue.length - 1) {
      this.currentIndex++;

      // 自动预加载触发逻辑：检查剩余量是否达到阈值
      const remainCount = this.playQueue.length - 1 - this.currentIndex;
      if (remainCount <= this.PRELOAD_THRESHOLD && this.hasMore && !this.isLoading) {
        this.loadMore();
      }

      return this.getCurrent();
    }
    return null; // 队列播放结束
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
   * 偷看当前指针前后第 offset 个位置的句子，不移动 currentIndex
   * offset = -1 表示上一句，offset = 1 表示下一句
   */
  public peek(offset: number): Sentence | null {
    const idx = this.currentIndex + offset;
    if (idx >= 0 && idx < this.playQueue.length) {
      return this.playQueue[idx];
    }
    return null;
  }

  /**
   * 静默预加载更多句子追加到队列末尾
   */
  public async loadMore(targetCount = 20): Promise<boolean> {
    // 防重复请求锁与无更多数据拦截
    if (this.isLoading || !this.hasMore || !this.bookId) {
      return false;
    }

    this.isLoading = true;
    try {
      const res = await sentenceService.getPlayList(this.bookId, targetCount, this.nextCursor);
      
      if (res && res.list && res.list.length > 0) {
        // 追加新句子到数组末尾
        this.playQueue = [...this.playQueue, ...res.list];
        this.nextCursor = res.nextCursor;
        this.hasMore = res.hasMore;
        return true;
      } else {
        this.hasMore = false;
      }
    } catch (error) {
      console.error('[PlayListManager] 预加载句子失败:', error);
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
    this.bookId = '';
    this.nextCursor = null;
    this.hasMore = true;
    this.isLoading = false;
  }
}

export default new SentencePlayListManager();