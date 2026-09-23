import sync from "../utils/sync"

export class SentencePlayList {

  async getPlayList(bookId: string, limit = 20, cursor?: SentencePlayCursor): Promise<SentencePlaylistResult> {
    const marks = sync.markStore.get(bookId) || []
    const { includeIds, excludeIds } = this.getReviewIds(marks)

    const review = await this.getReviewList(bookId, includeIds, limit, cursor?.reviewIndex ?? 0)

    const remain = limit - review.list.length
    const markMap = new Map(marks.map(x => [x.sentenceId, x]))
    const favoriteSet = this.getGlobalFavoriteSet()

    // 如果复习句子已经填满了 limit
    if (remain <= 0) {
      let list = await this.prepareSentences(review.list)
      // ✅ 修复 Bug 2：补全 isFavorite 和 mark 状态
      list = list.map(sentence => ({
        ...sentence,
        isFavorite: favoriteSet.has(sentence._id),
        mark: markMap.get(sentence._id)
      }))

      return {
        list,
        cursor: review.hasMore ?
          {
            reviewIndex: review.nextIndex,
            createdAt: cursor?.createdAt ?? -1
          }
          : undefined,
        hasMore: review.hasMore
      }
    }

    // 补充查新句子
    const normal = await this.getNewSentenceList(bookId, excludeIds, remain, cursor?.createdAt ?? -1)

    let list = await this.prepareSentences([...review.list, ...normal.list])
    list = list.map(sentence => ({
      ...sentence,
      isFavorite: favoriteSet.has(sentence._id),
      mark: markMap.get(sentence._id)
    }))

    const hasMore = review.hasMore || normal.hasMore

    return {
      list,
      cursor: hasMore ? {
        reviewIndex: review.nextIndex,
        createdAt: normal.nextCreatedAt
      }
        : undefined,
      hasMore
    }
  }

  async getFavoritePlayList(bookId: string, limit = 20, cursor?: number) {
    // 1. 获取收藏列表，过滤掉已删除的，并按 updatedAt 降序排列（最新的排在最前面）
    const favorites = (sync.favStore.get(bookId) || [])
      .filter(x => !x.deleted)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  
    // 2. 根据游标 (cursor 时间戳) 进行精确分页过滤
    const filteredFavorites = favorites.filter(x => !cursor || x.updatedAt < cursor)
    
    // 3. 截取当前页需要的条目
    const sentenceIds = filteredFavorites.slice(0, limit)
  
    if (!sentenceIds.length) {
      return { list: [], cursor: null }
    }
  
    const marks = sync.markStore.get(bookId) || []
    const markMap = new Map(marks.map(x => [x.sentenceId, x]))
    const db = wx.cloud.database()
    const _ = db.command
  
    // 4. 从数据库查询对应的句子详情
    const ids = sentenceIds.map(x => x.sentenceId)
    const res = await db.collection('sentence').where({
      _id: _.in(ids)
    }).get()
  
    const rawList = res.data as Sentence[]
  
    // ✅ 修复 Bug 2：按 sentenceIds 原本的顺序重新排列数据库查出来的句子（解决 in 查询乱序问题）
    const sentenceMap = new Map(rawList.map(item => [item._id, item]))
    const sortedList = ids
      .map(id => sentenceMap.get(id))
      .filter((x): x is Sentence => !!x)
  
    // 5. 补充音频 CDN/临时链接
    let list = await this.prepareSentences(sortedList)
  
    // 6. 附加 isFavorite 和 mark 状态
    list = list.map(sentence => ({
      ...sentence,
      isFavorite: true,
      mark: markMap.get(sentence._id)
    }))
  
    // ✅ 修复 Bug 1 & 3：计算下一次加载的游标
    // 只有当经过游标过滤后的剩余数量超过了 limit 时，才说明后面还有更多数据
    const hasMore = filteredFavorites.length > limit
    const nextCursor = hasMore ? sentenceIds[sentenceIds.length - 1].updatedAt : null
  
    return {
      list,
      cursor: nextCursor
    }
  }

  // 1. 增加一个获取全局收藏集合的方法
  private getGlobalFavoriteSet(): Set<string> {
    // getAll() 会拉取所有分片里的收藏数据
    const allFavorites = sync.favStore.getAll();

    // 过滤掉已删除的，只留下有效的 sentenceId
    const validFavoriteIds = allFavorites
      .filter(x => !x.deleted)
      .map(x => x.sentenceId);
    // console.log('validFavoriteIds', validFavoriteIds)

    return new Set(validFavoriteIds);
  }

  private getReviewIds(marks: SentenceMark[]) {
    const now = Date.now();
    const include = marks
      .filter(x => x.nextReviewAt && x.nextReviewAt <= now)
      .sort((a, b) => (a.nextReviewAt || 0) - (b.nextReviewAt || 0) || a._id.localeCompare(b._id));

    // ✅ 改为统一使用 sentenceId 匹配，避免 _id 拼写格式干扰
    // const includeSentenceIds = new Set(include.map(x => x.sentenceId));

    return {
      includeIds: include.map(x => x.sentenceId),
      excludeIds: marks.map(x => x.sentenceId)
    };
  }

  private async getReviewList(bookId: string, reviewIds: string[], limit: number, startIndex: number) {
    const fetchLimit = Math.min(limit, 20)
    const ids = reviewIds.slice(startIndex, startIndex + fetchLimit)
    console.log('startIndex')
    if (!ids.length) return { list: [], nextIndex: startIndex, hasMore: false }

    const db = wx.cloud.database()
    const _ = db.command
    const data = (await db.collection('sentence').where({ _id: _.in(ids), bookId }).get()).data as Sentence[]
    const map = new Map(data.map(x => [x._id, x]))
    const list = ids.map(id => map.get(id)).filter((x): x is Sentence => !!x)
    const nextIndex = startIndex + ids.length
    console.log('nextIndex', nextIndex)

    return { list, nextIndex, hasMore: nextIndex < reviewIds.length }
  }

  private async getNewSentenceList(bookId: string, excludeIds: string[], limit: number, createdAt: number) {
    const db = wx.cloud.database()
    const _ = db.command
    const data = (await db.collection('sentence').where({ bookId, createdAt: _.gt(createdAt), _id: _.nin(excludeIds) }).orderBy('createdAt', 'asc').limit(limit).get()).data as Sentence[]
    const hasMore = data.length === limit
    const list = data.slice(0, limit)
    const nextCreatedAt = list.length ? list[list.length - 1].createdAt : createdAt

    return { list, nextCreatedAt, hasMore }
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