import sentencePlayManager from "../services/sentence-play-manager"

const STORAGE_PREFIX = 'cloud://cloud1-d0gyvvq93ab34b8b7.636c-cloud1-d0gyvvq93ab34b8b7-1333600691/'

export function toFullFileId(path: string = ''): string {
  if (!path) return ''
  if (path.startsWith('cloud://') || path.startsWith('http')) return path

  const cleanPath = path.startsWith('/') ? path.substring(1) : path
  return `${STORAGE_PREFIX}${cleanPath}`
}


export async function getAudioUrls<T extends { audio?: string; audio_zh?: string }>(
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
export async function initManagerAndNavigate(url: string, book: Book, getPlayList: Function) {
  console.log(book)
  const needInit = book._id !== sentencePlayManager.bookId || sentencePlayManager.sentenceList.length === 0
  if (needInit) {
    console.log('重新获取学习列表')
    wx.showLoading({ title: '获取学习列表。', mask: true })
    try {
      const pl = await getPlayList(book._id, 20)
      console.log(pl)
      sentencePlayManager.init(book, pl, (cursor, limit) => getPlayList(book._id, limit, cursor))
      console.log('manager:',sentencePlayManager)
    } finally {
      wx.hideLoading()
    }
  }

  wx.navigateTo({ url })
}