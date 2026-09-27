// 文章列表页：展示某本文章书（book.content === 'article'）下的所有文章，或我的收藏文章
import articleService from "../../services/article-service";
import appStore from "../../services/app-store";

Page({
  data: {
    bookId: '',
    bookName: '',
    favorite: false, // 收藏模式：拉取 articleFavorite 关联的文章
    articles: [] as Article[],
    loading: true
  },

  onLoad(options: { bookId?: string; bookName?: string; favorite?: string }) {
    const bookId = options.bookId || ''
    const bookName = options.bookName ? decodeURIComponent(options.bookName) : ''
    const favorite = options.favorite === '1'
    this.setData({ bookId, bookName, favorite })
    if (bookId || favorite) {
      wx.setNavigationBarTitle({ title: bookName || (favorite ? '我收藏的文章' : '文章列表') })
      this.load()
    }
  },

  /** 统一入口：普通模式按书拉取，收藏模式拉收藏关联 */
  load(): Promise<void> {
    return this.data.favorite
      ? this.loadFavoriteArticles()
      : this.loadArticles(this.data.bookId)
  },

  // 收藏模式下从播放页返回（onShow）时重新拉取：可能在播放中收藏/取消收藏了
  firstShow: true,
  onShow() {
    if (this.firstShow) {
      this.firstShow = false // 首次由 onLoad 触发加载，跳过
      return
    }
    if (this.data.favorite) {
      this.load()
    }
  },

  /**
   * 拉取整本书的文章：走 getArticles 云函数（服务端全量 + 内网查询），
   * 网络细节收口在 articleService
   */
  async loadArticles(bookId: string): Promise<void> {
    try {
      const list = await articleService.getArticles(bookId);
      this.setData({ articles: list });
    } catch (err) {
      console.error('[article-list] 拉取文章失败:', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  /** 收藏模式：网络与排序细节收口在 articleService */
  async loadFavoriteArticles(): Promise<void> {
    try {
      const articles = await articleService.getFavoriteArticles()
      this.setData({ articles })
    } catch (err) {
      console.error('[article-list] 拉取收藏文章失败:', err)
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  onTapArticle(e: WechatMiniprogram.TouchEvent) {
    const index = e.currentTarget.dataset.index as number
    const article = this.data.articles[index]
    if (!article) return
    wx.navigateTo({
      url: `/pages/article-play/article-play?articleId=${article._id}&title=${encodeURIComponent(article.title || '')}`,
      fail: () => wx.showToast({ title: '打开失败', icon: 'none' })
    })
  },

  /** 收藏模式：滑动删除 = 取消该文章的收藏（本地移除 + 云端 upsert + 计数同步） */
  async onRemoveFavorite(e: WechatMiniprogram.TouchEvent) {
    const index = e.currentTarget.dataset.index as number
    const article = this.data.articles[index]
    if (!article) return

    // 乐观移除列表项 + 同步收藏计数
    const original = this.data.articles
    const articles = original.filter(a => a._id !== article._id)
    this.setData({ articles })
    appStore.articleFavoriteCount.value = Math.max(0, appStore.articleFavoriteCount.value - 1)

    try {
      await articleService.toggleFavorite(article._id, article.bookId || '', false)
      wx.showToast({ title: '已取消收藏', icon: 'none' })
    } catch (err) {
      console.error('[article-list] 取消收藏失败:', err)
      // 失败回滚：恢复列表项和计数
      this.setData({ articles: original })
      appStore.articleFavoriteCount.value += 1
      wx.showToast({ title: '取消收藏失败', icon: 'none' })
    }
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh())
  }
})

