import { CollectionName } from "../enums/app-enums";

export class LocalShardStore<T extends SentenceMark | SentenceFavorite> {

  private metaKey: string;
  constructor(private collection: CollectionName) {
    this.metaKey = collection + '_meta';
  }

  getCollection() {
    return this.collection;
  }

  // ---------- meta ----------
  getMeta(): SyncMeta<T> {
    return (
      wx.getStorageSync<SyncMeta<T>>(this.metaKey) || {
        cursor: 0,
        pendingQueue: [],
      }
    );
  }

  saveMeta(meta: SyncMeta<T>): void {
    wx.setStorageSync(this.metaKey, meta);
  }

  // ---------- 索引 & 分片 ----------
  private indexKey(): string {
    return `${this.collection}_index`;
  }

  private getIndex(): string[] {
    return wx.getStorageSync<string[]>(this.indexKey()) || [];
  }

  get(bookId: string): T[] {
    return wx.getStorageSync<T[]>(`${this.collection}_${bookId}`) || [];
  }

  private save(bookId: string, list: T[]): void {
    wx.setStorageSync(`${this.collection}_${bookId}`, list);
    const idx = this.getIndex();
    if (!idx.includes(bookId)) {
      idx.push(bookId);
      wx.setStorageSync(this.indexKey(), idx);
    }
  }

  getAll(): T[] {
    return this.getIndex().flatMap((id) => this.get(id));
  }

  removeBook(bookId: string): void {
    wx.removeStorageSync(`${this.collection}_${bookId}`);
    wx.setStorageSync(
      this.indexKey(),
      this.getIndex().filter((id) => id !== bookId)
    );
  }

  // ---------- 合并（同步拉取 + 乐观更新共用） ----------
  merge(items: T[]): number {
    if (!Array.isArray(items) || items.length === 0) return 0;

    const groups = new Map<string, T[]>();
    for (const it of items) {
      // 容错处理：确保 bookId 存在，若无则归类到 'default'
      const b = it.bookId || 'default';
      if (!groups.has(b)) groups.set(b, []);
      groups.get(b)!.push(it);
    }

    let changed = 0;
    for (const [bookId, batch] of groups) {
      const local = this.get(bookId);
      let dirty = false;

      for (const it of batch) {
        const k = it._id;
        // 核心修复 1：使用 x._id === k 比较本地项与当前项
        const i = local.findIndex((x) => x._id === k);

        if (i >= 0) {
          // 核心修复 2：统一转换为时间戳进行可靠比较
          const cloudTime = new Date(it.updatedAt || 0).getTime();
          const localTime = new Date(local[i].updatedAt || 0).getTime();

          if (cloudTime > localTime) {
            local[i] = it;
            changed++;
            dirty = true;
          }
        } else {
          local.push(it);
          changed++;
          dirty = true;
        }
      }

      if (dirty) this.save(bookId, local);
    }
    return changed;
  }

  upsert(item: T): void {
    this.merge([item]);
  }

  find(key: string): T | null {
    for (const x of this.getAll()) {
      if (x._id === key) return x;
    }
    return null;
  }
}