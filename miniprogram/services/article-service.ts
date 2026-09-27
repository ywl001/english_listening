import appStore from "./app-store";
import { cloudFunctionName } from "../enums/app-enums";
import { callCloudFunction } from "../utils/cloud-client";

// 本地文件缓存：article / articleSentence 内容不可变（仅导入数据时变化）
// 结构变更（如 storyId -> articleId 重命名）时递增此版本强制失效旧缓存
const CACHE_VERSION = 1;
const CACHE_DIR = `${wx.env.USER_DATA_PATH}/article-cache`;

/**
 * 文章服务：文章/句子拉取 + 音频临时 URL + 收藏状态
 * 页面只做 UI 编排，网络请求统一收口在这里
 */
export class ArticleService {

  /* ---------------- 本地文件缓存 ---------------- */

  private cachePath(key: string): string {
    return `${CACHE_DIR}/${key}.json`;
  }

  private readCache<T>(key: string): T | null {
    try {
      const raw = wx.getFileSystemManager().readFileSync(this.cachePath(key), 'utf8') as string;
      const data = JSON.parse(raw);
      if (data && data.v === CACHE_VERSION) return data.payload as T;
      return null;
    } catch (e) {
      return null; // 文件不存在或损坏都按未命中处理
    }
  }

  private writeCache(key: string, payload: any): void {
    try {
      const fs = wx.getFileSystemManager();
      try { fs.mkdirSync(CACHE_DIR, true); } catch (e) { /* 已存在 */ }
      fs.writeFileSync(this.cachePath(key), JSON.stringify({ v: CACHE_VERSION, payload }), 'utf8');
    } catch (e) {
      console.warn('[ArticleService] 写缓存失败:', e);
    }
  }

  /**
   * 拉取单篇文章（含音频播放地址），走 syncArticle 云函数一次往返。
   * 文档本体走本地缓存（cache-first + 后台刷新）；
   * 缓存命中时直接用 cloud:// fileID（InnerAudioContext 原生支持，免换 URL）。
   */
  async getArticle(articleId: string): Promise<{ article: Article; audioSrc: string }> {
    const cacheKey = `art-${articleId}`;
    const cached = this.readCache<Article>(cacheKey);

    // 云端拉取（后台刷新缓存 / 首次冷加载共用）
    const fetchCloud = async (): Promise<{ article: Article; audioSrc: string }> => {
      const { article, audioSrc } = await callCloudFunction<{ article: Article; audioSrc: string }>(
        cloudFunctionName.syncArticle,
        { articleId }
      );
      this.writeCache(cacheKey, article);
      return { article, audioSrc };
    };

    if (cached) {
      // 命中缓存：fileID 直接给播放器；静默刷新云端数据写回缓存
      fetchCloud().catch(() => { /* 静默失败，缓存仍可用 */ });
      return { article: cached, audioSrc: cached.audioUrl || '' };
    }
    return fetchCloud();
  }

  /**
   * 拉取整本书的文章列表（走 getArticles 云函数全量拉取，跳过音频 URL 换取），
   * 相比客户端 20 条/页串行分页快很多
   */
  async getArticles(bookId: string): Promise<Article[]> {
    const list = await callCloudFunction<Article[]>(
      cloudFunctionName.getArticles,
      { bookId, withUrl: false }
    );
    const sorted = list.slice();
    sorted.sort((a, b) => (a.order || 0) - (b.order || 0));
    return sorted;
  }

  /**
   * 拉取整篇文章的句子（云函数全量分批，客户端不受 20 条限制）
   * cache-first + 后台刷新：命中缓存秒回，云端最新数据写回缓存供下次使用
   */
  async getArticleSentences(articleId: string): Promise<ArticleSentence[]> {
    const cacheKey = `sent-${articleId}`;
    const cached = this.readCache<ArticleSentence[]>(cacheKey);

    const fetchCloud = async (): Promise<ArticleSentence[]> => {
      const list = await callCloudFunction<ArticleSentence[]>(
        cloudFunctionName.getArticleSentences,
        { articleId }
      );
      const sorted = list.slice();
      sorted.sort((a, b) => (a.order || 0) - (b.order || 0));
      this.writeCache(cacheKey, sorted);
      return sorted;
    };

    if (cached) {
      fetchCloud().catch(() => { /* 静默失败 */ });
      return cached;
    }
    return fetchCloud();
  }

  /** 查询收藏状态（未收藏/未登录返回 false） */
  async getFavorite(articleId: string): Promise<boolean> {
    // 冷启动 openid 可能未就绪，先等一下再查
    try {
      await (getApp() as IAppOption).openidReady;
    } catch (e) { /* openid 失败则跳过 */ }
    if (!appStore._openid.value) return false;
    try {
      const data = await callCloudFunction<{ isFavorite: boolean }>(
        cloudFunctionName.toggleArticleFavorite,
        { action: 'get', articleId }
      );
      return !!data?.isFavorite;
    } catch (err) {
      console.error('[ArticleService] 收藏状态获取失败:', err);
      return false;
    }
  }

  /** 切换收藏（云端 upsert，失败抛错由调用方回滚 UI） */
  async toggleFavorite(articleId: string, bookId: string, isFavorite: boolean): Promise<void> {
    await callCloudFunction(
      cloudFunctionName.toggleArticleFavorite,
      { articleId, bookId, isFavorite }
    );
  }

  /**
   * 刷新文章收藏总数到 appStore.articleFavoriteCount（虚拟书 count 数据源）。
   * 冷启动 openid 未就绪时先等待。
   */
  async refreshFavoriteCount(): Promise<number> {
    try {
      await (getApp() as IAppOption).openidReady;
    } catch (e) { /* openid 失败按 0 处理 */ }
    const openid = appStore._openid.value;
    if (!openid) {
      appStore.articleFavoriteCount.value = 0;
      return 0;
    }
    try {
      const db = wx.cloud.database();
      const res = await db.collection('articleFavorite')
        .where({ _openid: openid, deleted: false })
        .count();
      appStore.articleFavoriteCount.value = res.total || 0;
      return res.total || 0;
    } catch (err) {
      console.error('[ArticleService] 收藏数获取失败:', err);
      return appStore.articleFavoriteCount.value;
    }
  }

  /**
   * 拉取收藏的文章列表（按收藏时间倒序）：
   * 先分页查 articleFavorite，再按 id 分批（20 条/批）关联出 article 文档
   */
  async getFavoriteArticles(): Promise<Article[]> {
    try {
      await (getApp() as IAppOption).openidReady;
    } catch (e) { return []; }
    const openid = appStore._openid.value;
    if (!openid) return [];

    const db = wx.cloud.database();
    const PAGE = 20
    const favIds: string[] = []
    let skip = 0

    // 1. 分页拉取有效收藏记录（按收藏更新时间倒序）
    while (true) {
      const res = await db.collection('articleFavorite')
        .where({ _openid: openid, deleted: false })
        .orderBy('updatedAt', 'desc')
        .skip(skip)
        .limit(PAGE)
        .get()
      const page = (res.data as { articleId: string }[]).map(f => f.articleId)
      favIds.push(...page)
      if (page.length < PAGE) break
      skip += PAGE
    }
    if (!favIds.length) return []

    // 2. 分批关联 article 文档（客户端单次 get 上限 20 条）
    const articles: Article[] = []
    for (let i = 0; i < favIds.length; i += PAGE) {
      const chunk = favIds.slice(i, i + PAGE)
      const res = await db.collection('article')
        .where({ _id: db.command.in(chunk) })
        .get()
      articles.push(...(res.data as Article[]))
    }

    // 3. 保持收藏时间倒序（db.in 返回顺序不保证）
    const orderMap = new Map(favIds.map((id, i) => [id, i]))
    articles.sort((a, b) => (orderMap.get(a._id) || 0) - (orderMap.get(b._id) || 0))
    return articles
  }
}

const articleService = new ArticleService();
export default articleService;
