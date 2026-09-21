export interface SentenceCache {
  list: Sentence[];
  cursor: number;
  completed: boolean;
  updatedAt: number;
}

export class SentenceStore {
  // 统一的 Key 前缀，建议使用确切的分隔字符
  private readonly PREFIX = 'sentence_entity_';

  private key(bookId: string) {
    return `${this.PREFIX}${bookId}`;
  }

  getCache(bookId: string): SentenceCache {
    return wx.getStorageSync<SentenceCache>(this.key(bookId)) || {
      list: [],
      cursor: 0,
      completed: false,
      updatedAt: 0
    };
  }

  get(bookId: string): Sentence[] {
    return this.getCache(bookId).list;
  }

  getCursor(bookId: string): number {
    return this.getCache(bookId).cursor;
  }

  isCompleted(bookId: string): boolean {
    return this.getCache(bookId).completed;
  }

  has(bookId: string): boolean {
    return this.get(bookId).length > 0;
  }

  /**
   * 补全：查找单条句子
   * @param sentenceId 句子ID
   * @param bookId 可选：句子的实体书ID。如果传了则快速精准查找；不传则全局遍历本地所有实体书查找
   */
  find(sentenceId: string, bookId?: string): Sentence | null {
    // 1. 如果传了 bookId，直接取该书分片查找（O(N) 在单个分片内，速度极快）
    if (bookId) {
      const list = this.get(bookId);
      return list.find(s => s._id === sentenceId) || null;
    }

    // 2. 如果没传 bookId，获取本地所有存储的实体书分片 Key，逐个分片匹配
    const allKeys = wx.getStorageInfoSync().keys.filter(k => k.startsWith(this.PREFIX));

    for (const key of allKeys) {
      const cache = wx.getStorageSync<SentenceCache>(key);
      if (cache && Array.isArray(cache.list)) {
        const found = cache.list.find(s => s._id === sentenceId);
        if (found) return found; // 找到即返回
      }
    }

    return null;
  }

  /**
   * 批量查询句子（辅助引用书逻辑）
   * @param sentenceIds 句子ID数组
   */
  findMany(sentenceIds: string[]): Map<string, Sentence> {
    const idSet = new Set(sentenceIds);
    const result = new Map<string, Sentence>();
    if (idSet.size === 0) return result;

    const allKeys = wx.getStorageInfoSync().keys.filter(k => k.startsWith(this.PREFIX));

    for (const key of allKeys) {
      if (result.size === idSet.size) break; // 全部找到，提前终止循环

      const cache = wx.getStorageSync<SentenceCache>(key);
      if (cache && Array.isArray(cache.list)) {
        for (const item of cache.list) {
          if (idSet.has(item._id) && !result.has(item._id)) {
            result.set(item._id, item);
          }
        }
      }
    }

    return result;
  }

  saveBatch(bookId: string, list: Sentence[], cursor: number, hasMore: boolean): void {
    const cache = this.getCache(bookId);
    const map = new Map(cache.list.map(x => [x._id, x]));

    for (const sentence of list) {
      map.set(sentence._id, sentence);
    }

    cache.list = [...map.values()];
    cache.cursor = cursor;
    cache.completed = !hasMore;
    cache.updatedAt = Date.now();

    wx.setStorageSync(this.key(bookId), cache);
  }

  remove(bookId: string): void {
    wx.removeStorageSync(this.key(bookId));
  }

 /**
   * 前置新增/更新句子（精简版）
   */
 prependOrUpdate(bookId: string, sentences: Sentence | Sentence[]): void {
  const items = Array.isArray(sentences) ? sentences : [sentences];
  if (!items.length) return;

  const cache = this.getCache(bookId);
  
  // 1. 用 Map 存入新句子
  const map = new Map<string, Sentence>();
  items.forEach(item => map.set(item._id, item));

  // 2. 将本地原有的句子追加到 Map 中（如果 ID 冲突，Map 会保留上面的新数据，不被旧数据覆盖）
  cache.list.forEach(item => {
    if (!map.has(item._id)) {
      map.set(item._id, item);
    }
  });

  // 3. 更新缓存列表与时间戳
  cache.list = Array.from(map.values());
  cache.updatedAt = Date.now();

  wx.setStorageSync(this.key(bookId), cache);
}


/**
 * 修复：严谨匹配实体句子的 Key 前缀，防止误删 sentenceMark_ 和 sentenceFavorite_
 */
clear(): void {
  wx.getStorageInfoSync().keys
    .filter(key => key.startsWith(this.PREFIX))
    .forEach(key => wx.removeStorageSync(key));
}
}

export default new SentenceStore();