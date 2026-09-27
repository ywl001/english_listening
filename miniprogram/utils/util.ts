import sentencePlayManager from "../services/sentence-play-manager"
import sentencePlayList from "../services/sentence-play-list"
import sentenceFileStore from "../utils/sentence-file-store"

export async function initManagerAndNavigate(url: string, book: Book, getPlayList: Function) {
  console.log(book)
  wx.showLoading({ title: '获取学习列表', mask: true })
  try {
    // 每次点书都重新组织播放列表（本地计算，毫秒级）：
    // 学过的句子进复习队列、未学的自动回捞，不复用旧队列
    sentencePlayList.startNewSession(book._id)
    // 实体书：确保本地句子数据可用（首次全量同步，之后增量对账）；引用书无句子文件，跳过
    if (book.type !== 'ref') {
      await sentenceFileStore.ensureReady(book._id)
    }
    const pl = await getPlayList(book._id, 20)
    console.log('[initManagerAndNavigate] 播放列表:', book.name, book._id, '条数:', pl?.list?.length)
    sentencePlayManager.init(book, pl)
    if (!pl?.list?.length) {
      wx.showToast({ title: '本书暂无可播放的句子', icon: 'none' })
    }
  } finally {
    wx.hideLoading()
  }

  wx.navigateTo({ url })
}