import appStore from "./app-store"
import sentenceFileStore from "../utils/sentence-file-store"

/**
 * 播放列表构建（本地计算，不再查云端）：
 * - 句子数据来自 SentenceFileStore（文件系统），mark/favorite 来自本地分片存储
 * - 实体书列表 = 复习到期的句子（nextReviewAt <= now，按到期时间升序）在前 + 无 mark 的新句子在后
 * - 会话内分页用"已服务名单"去重：点过已会的句子自然离开池子，没点的跨会话自动回捞
 * - 引用书列表 = favStore 的收藏记录顺序，句子本体从各书本地缓存反查，缺的按 _id 拉一次并回写缓存
 */
export class SentencePlayList {

  // 会话内已服务的句子（分页去重），startNewSession 清空
  private served = new Map<string, Set<string>>()

  /**
   * 开始新的学习会话（重新初始化播放队列时调用）：
   * 清空已服务名单，下次 getPlayList 从头构建
   */
  public startNewSession(bookId: string): void {
    this.served.delete(bookId)
  }

  async getPlayList(bookId: string, limit = 20, cursor?: SentencePlayCursor): Promise<SentencePlaylistResult> {
    const sentences = sentenceFileStore.getSentences(bookId)
    const marks = appStore.markStore.value?.get(bookId) || []
    const markMap = new Map(marks.map(x => [x.sentenceId, x]))
    const favoriteSet = this.getGlobalFavoriteSet()
    const favBookMap = this.getGlobalFavoriteBookMap()
    const now = Date.now()

    // 复习队列：到期 mark 按到期时间升序（句子可能已被删，过滤掉）
    const sentenceMap = new Map(sentences.map(s => [s._id, s]))
    const due = marks
      .filter(x => x.nextReviewAt && x.nextReviewAt <= now)
      .sort((a, b) => (a.nextReviewAt || 0) - (b.nextReviewAt || 0))
      .map(x => sentenceMap.get(x.sentenceId))
      .filter((x): x is Sentence => !!x)

    // 新句子：无 mark（含多端同步来的 mark）
    const fresh = sentences.filter(s => !markMap.has(s._id))

    // 会话内分页：跳过本会话已服务的（cursor 参数仅为兼容旧签名，内部不使用）
    const servedSet = this.served.get(bookId) || new Set<string>()
    const dueAvail = due.filter(s => !servedSet.has(s._id))
    const freshAvail = fresh.filter(s => !servedSet.has(s._id))

    // 复习优先填满，不足的用新句子补齐：复习 3 条 + 新 17 条；复习 ≥ limit 则全复习
    const picked = [
      ...dueAvail.slice(0, limit),
      ...freshAvail.slice(0, Math.max(0, limit - Math.min(dueAvail.length, limit)))
    ]
    picked.forEach(s => servedSet.add(s._id))
    this.served.set(bookId, servedSet)

    const remaining = (dueAvail.length + freshAvail.length) - picked.length

    let list = await this.prepareSentences(picked)
    list = list.map(sentence => ({
      ...sentence,
      isFavorite: favoriteSet.has(sentence._id),
      favorites: favBookMap.get(sentence._id) || [],
      mark: markMap.get(sentence._id) || null
    }))

    const hasMore = remaining > 0
    return {
      list,
      cursor: hasMore ? { reviewIndex: 0, createdAt: 0 } : undefined,
      hasMore
    }
  }

  async getFavoritePlayList(bookId: string, limit = 20, cursor?: number) {
    // 1. 收藏记录：过滤已删除，按 updatedAt 降序
    const favorites = (appStore.favStore.value?.get(bookId) || [])
      .filter(x => !x.deleted)
      .sort((a, b) => b.updatedAt - a.updatedAt)

    // 2. 游标分页
    const filteredFavorites = favorites.filter(x => !cursor || x.updatedAt < cursor)
    const page = filteredFavorites.slice(0, limit)

    if (!page.length) {
      return { list: [], cursor: null }
    }

    // 3. 句子解析：优先本地文件缓存（句子所在实体书），缺的按 _id 拉云端并回写缓存
    const sentenceMap = new Map<string, Sentence>()
    const missing = []
    for (const rec of page) {
      const s = rec.bookId
        ? sentenceFileStore.getSentences(rec.bookId).find(x => x._id === rec.sentenceId)
        : undefined
      if (s) sentenceMap.set(rec.sentenceId, s)
      else missing.push(rec)
    }
    if (missing.length) {
      const db = wx.cloud.database()
      const _ = db.command
      // 小程序端单次 get 上限 20 条，批大小必须 ≤ 20
      for (let i = 0; i < missing.length; i += 20) {
        const ids = missing.slice(i, i + 20).map(x => x.sentenceId)
        const res = await db.collection('sentence').where({ _id: _.in(ids) }).limit(20).get()
        for (const s of res.data as Sentence[]) {
          sentenceMap.set(s._id, s)
          // 回写来源书的本地缓存（未打开过的书），后续免查
          sentenceFileStore.upsertSentence(s)
        }
      }
    }

    // 4. 保持收藏记录的顺序（in 查询乱序问题已不存在，这里按记录顺序取）
    const sortedList = page
      .map(rec => sentenceMap.get(rec.sentenceId))
      .filter((x): x is Sentence => !!x)

    // 5. 全局 mark 与多夹子信息
    const marks = appStore.markStore.value?.getAll() || []
    const markMap = new Map(marks.map(x => [x.sentenceId, x]))
    const favBookMap = this.getGlobalFavoriteBookMap()

    let list = await this.prepareSentences(sortedList)
    list = list.map(sentence => ({
      ...sentence,
      isFavorite: true,
      favorites: favBookMap.get(sentence._id) || [bookId],
      mark: markMap.get(sentence._id) || null
    }))

    const hasMore = filteredFavorites.length > limit
    const nextCursor = hasMore ? page[page.length - 1].updatedAt : null

    return { list, cursor: nextCursor }
  }

  // 每个句子当前被收藏在哪些夹子里：sentenceId -> refBookId[]
  private getGlobalFavoriteBookMap(): Map<string, string[]> {
    const map = new Map<string, string[]>()
    for (const fav of appStore.favStore.value?.getAll() || []) {
      if (fav.deleted) continue
      const arr = map.get(fav.sentenceId)
      if (arr) {
        if (!arr.includes(fav.refBookId)) arr.push(fav.refBookId)
      } else {
        map.set(fav.sentenceId, [fav.refBookId])
      }
    }
    return map
  }

  private getGlobalFavoriteSet(): Set<string> {
    const validFavoriteIds = (appStore.favStore.value?.getAll() || [])
      .filter(x => !x.deleted)
      .map(x => x.sentenceId)
    return new Set(validFavoriteIds)
  }

  private async prepareSentences(list: Sentence[]) {
    const fullList = list.map(item => ({ ...item, audio: this.toFullFileId(item.audio), audio_zh: this.toFullFileId(item.audio_zh) }))
    return this.getAudioUrls(fullList)
  }

  private toFullFileId(path: string = ''): string {
    const STORAGE_PREFIX = 'cloud://cloud1-d0gyvvq93ab34b8b7.636c-cloud1-d0gyvvq93ab34b8b7-1333600691/'
    if (!path) return ''
    if (path.startsWith('cloud://') || path.startsWith('http')) return path

    const cleanPath = path.startsWith('/') ? path.substring(1) : path
    return `${STORAGE_PREFIX}${cleanPath}`
  }

  // 音频临时链接：cloud:// 转 temp URL（约 2 小时有效期，播放前批量转换）
  private async getAudioUrls<T extends { audio?: string; audio_zh?: string }>(
    list: T[]
  ): Promise<T[]> {

    const ids = [...new Set(
      list.flatMap(item => [
        item.audio,
        item.audio_zh
      ]).filter((x): x is string => !!x?.startsWith('cloud://'))
    )]

    if (!ids.length) return list
    const map = new Map<string, string>()
    for (let i = 0; i < ids.length; i += 50) {
      const res = await wx.cloud.getTempFileURL({
        fileList: ids.slice(i, i + 50)
      })

      res.fileList.forEach(item => {
        if (item.status === 0) {
          map.set(item.fileID, item.tempFileURL)
        }
      })
    }

    return list.map(item => ({
      ...item,
      audio: map.get(item.audio || '') || item.audio,
      audio_zh: map.get(item.audio_zh || '') || item.audio_zh
    }))
  }
}

const sentencePlayList = new SentencePlayList()
export default sentencePlayList
