import { cloudFunctionName, CollectionName } from "../enums/app-enums";
import sentenceStore from "../utils/sentenceStore";
import sync from "../utils/sync"; // 统一使用 sync 内部的 store 单例
import { callCloudFunction } from "./cloud-client";
import cloudService from "./cloud-service";
import { AppEvent } from "./event-type";
import eventBus from "./EventBus";
import sentencePlayManager from "./sentence-play-manager";

export class SentenceService {
  async getPlayList(bookId: string, targetCount = 50): Promise<Sentence[]> {
    if (sentenceStore.isCompleted(bookId)) {
      console.log('本地数据完整，走本地构建播放列表');
      return this.buildLocalPlayList(bookId, targetCount);
    }
    const list = await this.getInitSentencePlayList(bookId);

    if (!sentenceStore.isCompleted(bookId)) {
      this.syncAll(bookId).catch(console.error);
    }
    return list;
  }

  private async getInitSentencePlayList(bookId: string): Promise<Sentence[]> {
    // ✅ 统一从 sync 获取存储实例
    const marks = sync.markStore.get(bookId);

    const { includeIds, excludeIds } = this.getReviewIds(marks);
    const res = await cloudService.getSentencesByIds(CollectionName.sentence, bookId, includeIds, excludeIds);
    const favorites = sync.favStore.get(bookId);

    const markMap = new Map(marks.map(x => [x.sentenceId, x]));
    // ✅ 过滤掉已经标记为 deleted: true 的记录
    const favoriteSet = new Set(favorites.filter(x => !x.deleted).map(x => x.sentenceId));

    const list = res.map(sentence => ({
      ...sentence,
      isFavorite: favoriteSet.has(sentence._id),
      mark: markMap.get(sentence._id)
    }));

    return list;
  }

  private getReviewIds(marks: SentenceMark[]) {
    const now = Date.now();
    const include = marks
      .filter(x => x.nextReviewAt && x.nextReviewAt <= now)
      .sort((a, b) => (a.nextReviewAt || 0) - (b.nextReviewAt || 0) || a._id.localeCompare(b._id));

    // ✅ 改为统一使用 sentenceId 匹配，避免 _id 拼写格式干扰
    const includeSentenceIds = new Set(include.map(x => x.sentenceId));

    return {
      includeIds: include.map(x => x.sentenceId),
      excludeIds: marks.filter(x => !includeSentenceIds.has(x.sentenceId)).map(x => x.sentenceId)
    };
  }

  // 1. 增加一个获取全局收藏集合的方法
  private getGlobalFavoriteSet(): Set<string> {
    // getAll() 会拉取所有分片里的收藏数据
    const allFavorites = sync.favStore.getAll();

    // 过滤掉已删除的，只留下有效的 sentenceId
    const validFavoriteIds = allFavorites
      .filter(x => !x.deleted)
      .map(x => x.sentenceId);

    return new Set(validFavoriteIds);
  }

  // 2. 在 buildLocalPlayList 中使用全局收藏 Set
  private buildLocalPlayList(bookId: string, targetCount: number): Sentence[] {
    const sentences = sentenceStore.get(bookId); // 实体书里的句子
    const marks = sync.markStore.get(bookId);     // 该实体书下的标注

    // 🛡️ 核心改变：拿全局有效的收藏集合，而不是针对某个 bookId 去拿
    const favoriteSet = this.getGlobalFavoriteSet();
    const markMap = new Map(marks.map(x => [x.sentenceId, x]));
    const now = Date.now();

    const review = marks
      .filter(x => x.nextReviewAt && x.nextReviewAt <= now)
      .sort((a, b) => (a.nextReviewAt || 0) - (b.nextReviewAt || 0) || a._id.localeCompare(b._id))
      .map(x => sentences.find(s => s._id === x.sentenceId))
      .filter((x): x is Sentence => !!x);

    const reviewIds = new Set(review.map(x => x._id));

    const fresh = sentences
      .filter(x => !markMap.has(x._id) && !reviewIds.has(x._id))
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || a._id.localeCompare(b._id));

    const list = [...review, ...fresh]
      .slice(0, targetCount)
      .map(sentence => ({
        ...sentence,
        isFavorite: favoriteSet.has(sentence._id), // ✅ 无论在哪个收藏夹，只要收藏了就是 true
        mark: markMap.get(sentence._id)
      }));

    return list;
  }

  async syncAll(bookId: string): Promise<number> {
    let cursor = sentenceStore.getCursor(bookId);
    let total = 0;

    while (true) {
      const res = await callCloudFunction<{ list: Sentence[]; nextCursor: number; hasMore: boolean }>(
        cloudFunctionName.syncSentence,
        { bookId, cursor, limit: 100 }
      );

      sentenceStore.saveBatch(bookId, res.list, res.nextCursor, res.hasMore);
      total += res.list.length;
      cursor = res.nextCursor;

      if (!res.hasMore) break;
    }

    const playList = this.buildLocalPlayList(bookId, 50);
    sentencePlayManager.replace(playList);
    console.log('播放队列长度：', sentencePlayManager.queueLength);
    eventBus.emit(AppEvent.REFRESH_SENTENCE_LIST);
    return total;
  }

  async createSentence( data: Partial<Sentence>): Promise<Sentence> {
    const res = await callCloudFunction(
      cloudFunctionName.createSentence,
      data
    );
    return res as Sentence;
  }

  async searchSentences(keyword: string): Promise<Sentence[]> {
    return callCloudFunction(cloudFunctionName.searchSentences, { keyword });
  }

  /**
   * 获取引用书/收藏夹中的句子列表（支持跨实体书查找）
   */
  async getFavoriteSentences(refBookId: string): Promise<Sentence[]> {
    // 1. 拿到引用书分片下的所有收藏记录
    const favorites = sync.favStore.get(refBookId);
    const activeFavorites = favorites.filter(x => !x.deleted);

    if (activeFavorites.length === 0) return [];

    // 2. 收集需要查找的 sentenceId
    const targetIds = activeFavorites.map(f => f.sentenceId);

    // 3. 利用批量查找接口直接一次性查出所有句子对象
    const sentenceMap = sentenceStore.findMany(targetIds);
    const favoriteSet = this.getGlobalFavoriteSet();

    const list = activeFavorites
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(fav => {
        const sentence = sentenceMap.get(fav.sentenceId);
        if (!sentence) return null;

        // 获取句子所属实体书的标注
        const marks = sync.markStore.get(sentence.bookId);
        const markMap = new Map(marks.map(x => [x.sentenceId, x]));

        return {
          ...sentence,
          mark: markMap.get(sentence._id) || null,
          isFavorite: favoriteSet.has(sentence._id),
          favCreatedAt: fav.updatedAt
        };
      })

    return list as Sentence[];
  }
  /**
   * 更新标记
   */
  upsertMark(sentenceId: string, patch: Partial<SentenceMark> = {}, bookId: string) {
    // ✅ 使用 sync.markStore，避免重新 new 导致实例错位
    this.upsert(sync.markStore, sentenceId, bookId, patch);
  }

  /**
   * 切换收藏状态
   * @param targetFavoriteState 目标状态：true 为要收藏，false 为要取消收藏
   */
  toggleFavorite(sentenceId: string, bookId: string, targetFavoriteState: boolean) {
    // ✅ 使用 sync.favStore，且 deleted = !targetFavoriteState
    console.log('fav写入时的 bookId:', bookId);
    this.upsert(sync.favStore, sentenceId, bookId, { deleted: !targetFavoriteState });
  }

  private upsert(store: any, sentenceId: string, bookId: string, data: any) {
    const _openid = (getApp() as IAppOption).globalData._openid;
    if (!_openid) {
      throw new Error('_openid 尚未获取，请确保已登录或完成获取');
    }

    const _id = `${_openid}__${sentenceId}`;
    const now = Date.now();

    const existing = store.find(_id);

    const merged = {
      ...(existing || {}),
      ...data,
      _id: existing?._id || _id,
      _openid: existing?._openid || _openid,
      sentenceId: sentenceId,
      bookId: bookId || existing?.bookId,
      updatedAt: now,
    };

    if (!merged.bookId) {
      console.warn('[upsert] 缺少 bookId，跳过本地缓存', _id);
    } else {
      store.upsert(merged);
    }

    const meta = store.getMeta();
    meta.pendingQueue.push({
      op: 'upsert',
      data: merged,
      retry: 0,
      ts: now,
    });
    store.saveMeta(meta);

    sync.flushQueue(store).catch((err) =>
      console.error('[sync] flushPendingQueue 异常', err)
    );
  }
}

const sentenceService = new SentenceService();
export default sentenceService;