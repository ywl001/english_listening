export class SentencePlayList {
  async getSentencesByIds(collection: string, bookId: string, includeIds: string[], excludeIds: string[] = [], limit = 20): Promise<Sentence[]> {

    const db = wx.cloud.database()
    const _ = db.command

    console.log('query:', { bookId, includeIds })

    let list;

    const first = (await db.collection(collection).where({
      _id: _.in(includeIds),
      bookId
    }).limit(limit).get()).data

    if (first.length >= limit) {
      list = first
    } else if (!includeIds.length) {
      list = (await db.collection(collection).where({
        _id: _.nin(excludeIds),
        bookId
      }).limit(limit).get()).data as Sentence[]
    } else {
      const exclude = [...new Set([...excludeIds, ...first.map(x => x._id)])]

      const rest = (await db.collection(collection).where({
        _id: _.nin(exclude),
        bookId
      }).limit(limit - first.length).get()).data

      list = [...first, ...rest]
    }

    list = list.map(item => ({
      ...item,
      audio: this.toFullFileId(item.audio),
      audio_zh: this.toFullFileId(item.audio_zh)
    }))
    list = await this.getAudioUrls(list as Sentence[])
    return list as Sentence[]
  }

  toFullFileId(path: string = ''): string {
    const STORAGE_PREFIX = 'cloud://cloud1-d0gyvvq93ab34b8b7.636c-cloud1-d0gyvvq93ab34b8b7-1333600691/'
    if (!path) return ''
    if (path.startsWith('cloud://') || path.startsWith('http')) return path

    const cleanPath = path.startsWith('/') ? path.substring(1) : path
    return `${STORAGE_PREFIX}${cleanPath}`
  }


  async getAudioUrls<T extends { audio?: string; audio_zh?: string }>(
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
const cloudService = new SentencePlayList()
export default cloudService