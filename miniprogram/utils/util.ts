import sentencePlayManager from "../services/sentence-play-manager"

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