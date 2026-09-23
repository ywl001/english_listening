import sync from "../utils/sync"

interface SentencePlayCursor {
  reviewIndex: number
  createdAt: number
}

interface SentencePlayResult {
  list: Sentence[]
  cursor?: SentencePlayCursor
  hasMore: boolean
}

export class SentencePlayList {

  async getPlayList(bookId: string, limit = 20, cursor?: SentencePlayCursor): Promise<SentencePlayResult> {
    const marks = sync.markStore.get(bookId)
    const { includeIds, excludeIds } = this.getReviewIds(marks)
    const review = await this.getReviewList(bookId, includeIds, limit, cursor?.reviewIndex ?? 0)
    const remain = limit - review.list.length

    if (remain <= 0) {
      return {
        list: await this.prepareSentences(review.list),
        cursor: review.hasMore ? { reviewIndex: review.nextIndex, createdAt: cursor?.createdAt ?? -1 } : undefined,
        hasMore: review.hasMore
      }
    }

    const normal = await this.getNewSentenceList(bookId, excludeIds, remain, cursor?.createdAt ?? -1)
    const markMap = new Map(marks.map(x => [x.sentenceId, x]))
    const favoriteSet = this.getGlobalFavoriteSet();
    console.log("favorites:", favoriteSet)

    let list = await this.prepareSentences([...review.list, ...normal.list])
    list = list.map(sentence => ({
      ...sentence,
      isFavorite: favoriteSet.has(sentence._id),
      mark: markMap.get(sentence._id)
    }))
    const hasMore = review.hasMore || normal.hasMore

    return {
      list,
      cursor: hasMore ? { reviewIndex: review.nextIndex, createdAt: normal.nextCreatedAt } : undefined,
      hasMore
    }
  }

  async getFavoritePlayList(bookId: string, limit = 20, cursor?: number) {
    const favorites = sync.favStore.get(bookId).filter(x => !x.deleted)
    const sentenceIds = favorites.filter(x => !cursor || x.updatedAt < cursor).slice(0, limit)

    const marks = sync.markStore.get(bookId)
    const markMap = new Map(marks.map(x => [x.sentenceId, x]))
    const db = wx.cloud.database()
    const _ = db.command
    if (!sentenceIds.length) {
      return { list: [], cursor: null }
    }

    const res = await db.collection('sentence').where({
      _id: db.command.in(sentenceIds.map(x => x.sentenceId))
    }).get()


    let list = res.data as Sentence[]
    list = await this.prepareSentences(list)
    list = list.map(sentence => ({
      ...sentence,
      isFavorite: true,
      mark: markMap.get(sentence._id)
    }))

    return {
      list,
      cursor:  sentenceIds.length === limit ? sentenceIds[sentenceIds.length - 1].updatedAt : null
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
    console.log('validFavoriteIds', validFavoriteIds)

    return new Set(validFavoriteIds);
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

  private async getReviewList(bookId: string, reviewIds: string[], limit: number, startIndex: number) {
    const ids = reviewIds.slice(startIndex, startIndex + limit)
    if (!ids.length) return { list: [], nextIndex: startIndex, hasMore: false }

    const db = wx.cloud.database()
    const _ = db.command
    const data = (await db.collection('sentence').where({ _id: _.in(ids), bookId }).get()).data as Sentence[]
    const map = new Map(data.map(x => [x._id, x]))
    const list = ids.map(id => map.get(id)).filter((x): x is Sentence => !!x)
    const nextIndex = startIndex + ids.length

    return { list, nextIndex, hasMore: nextIndex < reviewIds.length }
  }

  private async getNewSentenceList(bookId: string, excludeIds: string[], limit: number, createdAt: number) {
    const db = wx.cloud.database()
    const _ = db.command
    const data = (await db.collection('sentence').where({ bookId, createdAt: _.gt(createdAt), _id: _.nin(excludeIds) }).orderBy('createdAt', 'asc').limit(limit + 1).get()).data as Sentence[]
    const hasMore = data.length > limit
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