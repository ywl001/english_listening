import { cloudFunctionName, CollectionName } from "../enums/app-enums";
import { callCloudFunction } from "./cloud-client";

export class SentenceService {

  async getPlayList(bookId: string, targetCount = 20, cursor: PlayListCursor | null = null): Promise<PlayListResult> {
    const data = { bookId, targetCount, cursor }
    return callCloudFunction(cloudFunctionName.getSentencePlayList, data)
  }

  /**
   * 录入一条新句子。
   * - 不管传入的 bookId 是哪本词书，句子物理内容都会被存进用户的默认库"用户句子"；
   * - 如果 bookId 不是默认库本身，云函数会在同一个事务里顺手建一条引用，
   *   让句子"看起来"出现在你选的那本词书里；
   * - 两步在同一个事务里，不会出现存了内容但引用没建上的半吊子状态。
   */
  static async createSentence(data: Sentence): Promise<string> {
    const res = await callCloudFunction<{ sentenceId: string }>(
      cloudFunctionName.createSentence,
      data
    )
    return res.sentenceId
  }

  /**
   * 跨词书搜索句子（中文或英文，模糊匹配）
   */
  static async searchSentences(keyword: string): Promise<Sentence[]> {
    return callCloudFunction(cloudFunctionName.searchSentences, { keyword })
  }

  /**
   * 获取指定词书/收藏夹中的句子列表
   * @param bookId 词书ID（可以是系统收藏夹 fav_${_openid}，也可以是自建词书ID）
   * @param page 页码（可选，用于分页）
   * @param pageSize 每页条数（可选，默认 20）
   */
  async getFavoriteSentences(bookId: string, page = 1, pageSize = 20): Promise<FavoriteSentenceResult> {
    return callCloudFunction<FavoriteSentenceResult>(
      cloudFunctionName.getFavoriteSentences, // 确保你的 enum 中定义了对应的云函数名
      { bookId, page, pageSize }
    );
  }

  /**
   * @param sentenceId 句子ID
   * @param patch 待更新的字段
   * @param bookId 词书ID（选填）
   */
  async upsertMark(
    sentenceId: string,
    patch: Partial<SentenceMark> = {},
    bookId: string = ''
  ) {
    if (!sentenceId) {
      throw new Error('sentenceId 不能为空');
    }

    const db = wx.cloud.database();
    const collection = db.collection('sentenceMark');

    // 小程序端使用 set 时，云数据库安全性机制会自动在写入时绑定当前用户的 _openid
    // 但 ID 规则仍与云函数保持一致：${_openid}__${sentenceId}
    // 注：在前端 SDK 中，可通过 wx.cloud.database() 提供的全局机制或通过本地存储获取 _openid，
    // 如果没有全局 _openid，可以直接使用 docId 格式，或查询已有记录。

    const now = Date.now();

    try {
      // 1. 先尝试 update（最轻量，只更新传入的 patch 字段和 updatedAt）
      // 注意：在前端 SDK 中，如果记录不存在，update 会抛出 404 异常
      // 我们可以用 collection.where({ sentenceId }).get() 或直接 update 捕获

      // 简练高效的做法：先查一次旧记录，保证 `id` 格式或保持字段默认值
      // 如果你的 sentenceMark 在前端可以根据 _id 直接定位：
      // 因为 _id 依赖 OPENID，前端没有 OPENID 时，推荐按 (sentenceId + bookId) 查询或使用 doc 规则

      const queryRes = await collection.where({ sentenceId }).get();

      if (queryRes.data && queryRes.data.length > 0) {
        // 记录已存在 -> 执行更新
        const docId = queryRes.data[0]._id as string;
        await collection.doc(docId).update({
          data: {
            ...patch,
            updatedAt: now
          }
        });

        return { success: true, id: docId, action: 'update' };
      } else {
        // 记录不存在 -> 执行创建
        // 不传 _id 时云数据库会自动生成，也可以指定自定义 _id
        const newDoc = {
          sentenceId,
          bookId,
          favorite: false,
          stage: 0,
          nextReviewAt: 0,
          createdAt: now,
          updatedAt: now,
          ...patch
        };

        const addRes = await collection.add({
          data: newDoc
        });

        return { success: true, id: addRes._id, action: 'create' };
      }
    } catch (err: any) {
      console.error('[upsertMark Error]:', err);
      throw err;
    }
  }

  /**
   * 切换收藏状态
   */
  async toggleFavorite(
    sentenceId: string,
    bookId: string
  ): Promise<ToggleFavoriteResult> {
    const db = wx.cloud.database();
    const collection = db.collection(CollectionName.sentenceFavorite);

    // 拼装防重主键 ID: ${bookId}__${sentenceId}
    const docId = `${bookId}__${sentenceId}`;
    const docRef = collection.doc(docId);

    try {
      // 1. 查询该记录是否存在
      const res = await docRef.get().catch(() => null);

      if (res && res.data) {
        // 2. 存在 -> 删掉 (取消收藏)
        await docRef.remove();
        return {
          isFavorite: false,
          sentenceId,
          bookId
        };
      } else {
        // 3. 不存在 -> 插入 (添加收藏)
        // 在前端直接写入时，云数据库会自动把当前用户的 _openid 加到 doc 属性中
        await collection.add({
          data: {
            _id: docId,
            bookId,
            sentenceId,
            createdAt: Date.now()
          }
        });

        return {
          isFavorite: true,
          sentenceId,
          bookId
        };
      }
    } catch (err: any) {
      console.error('[toggleFavorite Error]:', err);
      wx.showToast({
        title: '操作收藏失败',
        icon: 'none'
      });
      throw err;
    }
  }
}
const sentenceService = new SentenceService()
export default sentenceService