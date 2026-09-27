import { cloudFunctionName } from "../enums/app-enums";
import { callCloudFunction } from "../utils/cloud-client";
import { LocalShardStore } from "../utils/local-store";
import sync from "../utils/sync"; // 统一使用 sync 内部的 store 单例
import appStore from "./app-store";
import sentencePlayList from "./sentence-play-list";

export class SentenceService {
  async getPlayList(bookId: string, targetCount = 20,cursor?:SentencePlayCursor): Promise<SentencePlaylistResult> {
    // if (sentenceStore.isCompleted(bookId)) {
    //   console.log('本地数据完整，走本地构建播放列表');
    //   return this.buildLocalPlayList(bookId, targetCount);
    // }
    // const list = await this.getInitSentencePlayList(bookId);

    // if (!sentenceStore.isCompleted(bookId)) {
    //   this.syncAll(bookId).catch(console.error);
    // }
    // return list;
    // const pl = await sentencePlayList.getPlayList(bookId)

    const res =  await sentencePlayList.getPlayList(bookId,targetCount,cursor)
    console.log(res)
    return res

  }

  async getFavoritePlayList(bookId: string, targetCount = 20,cursor?:number) {
    const res =  await sentencePlayList.getFavoritePlayList(bookId,targetCount,cursor)
    console.log(res)
    console.log('get favorite play list',res)
    return res
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
   * 按英文原文精确查重（忽略大小写）：命中返回已有句子，未命中返回 null
   */
  async findSentence(en: string): Promise<Sentence | null> {
    return callCloudFunction<Sentence | null>(cloudFunctionName.findSentence, { en: en.trim() });
  }

  /**
   * 获取引用书/收藏夹中的句子列表（支持跨实体书查找）
   */
  async getFavoriteSentences(refBookId: string): Promise<Sentence[]> {
    const pl = await sentencePlayList.getFavoritePlayList(refBookId)
    return pl.list as Sentence[]
  }
  /**
   * 更新标记
   */
  upsertMark(sentenceId: string, patch: Partial<SentenceMark> = {}, bookId: string) {
    // ✅ 使用 appStore.markStore.value，避免重新 new 导致实例错位
    this.upsert(appStore.markStore.value as LocalShardStore<SentenceMark>, sentenceId, bookId, patch);
  }

  /**
   * 切换收藏状态（一个句子可同时被多本引用书收藏）
   * @param targetFavoriteState true=收藏，false=取消收藏
   * @param refBookId 可选：目标引用书（长按选夹子场景传入），默认当前收藏夹
   */
  toggleFavorite(sentenceId: string, bookId: string, targetFavoriteState: boolean, refBookId?: string) {
    const favStore = appStore.favStore.value as LocalShardStore<SentenceFavorite>
    const ref = refBookId || appStore.currentFavoriteBook.value?._id as string
    if (!ref) {
      console.warn('[toggleFavorite] 没有可用的收藏夹，跳过')
      return
    }

    // 该句子当前所有收藏记录（跨夹子）
    const records = favStore.getAll().filter(x => x.sentenceId === sentenceId)

    if (!targetFavoriteState) {
      // 取消收藏：从所有引用书中移除
      for (const rec of records) {
        if (!rec.deleted) {
          this.upsert(favStore, sentenceId, rec.bookId, { deleted: true, refBookId: rec.refBookId }, rec._id)
        }
      }
      return
    }

    // 收藏：仅写入目标引用书，其他引用书的记录保持不变（支持多夹子共存）
    const target = records.find(x => x.refBookId === ref && !x.deleted)
    if (target) return // 已在该引用书中，无需重复写

    const recordId = `${appStore._openid.value}__${ref}__${sentenceId}`
    this.upsert(favStore, sentenceId, bookId, { deleted: false, refBookId: ref }, recordId)
  }

  /**
   * 从指定引用书移除收藏（列表滑动删除）：
   * 仅标记该书维度的记录 deleted=true 并推上云，句子本体与其他夹子的收藏不受影响
   */
  removeFavoriteFromBook(sentenceId: string, refBookId: string): void {
    const favStore = appStore.favStore.value as LocalShardStore<SentenceFavorite>
    const record = favStore.getAll().find(x => x.sentenceId === sentenceId && x.refBookId === refBookId)
    if (!record) return
    // 标记 deleted 并推上云（upsert 走 doc(_id).set 覆盖云端记录）
    this.upsert(favStore, sentenceId, record.bookId, { deleted: true, refBookId }, record._id)
  }

  /**
   * 删除用户句子（云端两阶段：confirm=false 仅统计收藏，confirm=true 执行删除）
   * 返回 { needConfirm, favoriteCount } 或 { deleted: true }
   */
  async deleteSentence(sentenceId: string, confirm = false): Promise<{ needConfirm?: boolean; favoriteCount?: number; deleted?: boolean } | null> {
    return callCloudFunction(cloudFunctionName.deleteSentence, { sentenceId, confirm })
  }

  private upsert(store: LocalShardStore<SentenceMark|SentenceFavorite>, sentenceId: string, bookId: string, data: any, recordId?: string) {
    const _openid = appStore._openid.value

    if (!_openid) {
      throw new Error('_openid 尚未获取，请确保已登录或完成获取');
    }

    const _id = recordId || `${_openid}__${sentenceId}`;
    const now = Date.now();

    const existing = store.find(_id);
    console.log('existing',existing)

    const merged = {
      ...(existing || {}),
      ...data,
      _id: existing?._id || _id,
      _openid: existing?._openid || _openid,
      sentenceId: sentenceId,
      bookId: bookId || existing?.bookId,
      updatedAt: now,
    };

    console.log('merged',merged)

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