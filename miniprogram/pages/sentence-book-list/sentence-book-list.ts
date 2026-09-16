import bookService from '../../services/book-service';
import { BookType, Pages } from '../../enums/app-enums';
import sentencePlayManager from '../../services/sentence-play-manager';
import sentenceService from '../../services/sentence-service';

Page({
  data: {
    activeTab: 'system' as 'system' | 'user',
    systemBooks: [] as Book[],
    userBooks: [] as Book[],
    showSettingsModal: false,
    settings: {
      order: 'EN_ZH',
      count: 10,
      repeatCount: 2,
      interval: 2
    }
  },

  onLoad() {
    const cachedSettings = wx.getStorageSync('playback_settings');
    if (cachedSettings) {
      this.setData({ settings: cachedSettings });
    }
    this.loadData();
  },

  async loadData() {
    const allSentenceBooks = await bookService.getSentenceBooks();
    const userBooks = await bookService.getUserBooks();
    const userSentenceBooks = userBooks.filter(b => b.type === BookType.sentence);
    const _openid = getApp().globalData._openid;

    this.setData({
      systemBooks: allSentenceBooks.filter(b => b._openid !== _openid),
      userBooks: userSentenceBooks
    });
  },

  switchTab(e: any) {
    this.setData({ activeTab: e.currentTarget.dataset.tab });
  },

  openSettings() {
    this.setData({ showSettingsModal: true });
  },

  closeSettings() {
    this.setData({ showSettingsModal: false });
  },

  handleSaveSettings(e: any) {
    const newSettings = e.detail;
    this.setData({
      settings: newSettings,
      showSettingsModal: false
    });
    wx.setStorageSync('playback_settings', newSettings);
    wx.showToast({ title: '保存成功', icon: 'success' });
  },

  async onTapBook(e: any) {
    const { book } = e.detail;
    console.log(book)
    if (book._openid) {
      const url = Pages.favoriteSentenceList + '?bookId=' + book._id
      this.openSentencePlay(url,book,sentenceService.getFavoriteSentences)
    } else {
      const url = `${Pages.sentencePlay}?bookId=${book._id}&bookName=${book.name}`
      this.openSentencePlay(url, book, sentenceService.getPlayList)
    }
  },

  onEditBook(e: any) {
    const { book } = e.detail;
    console.log('编辑句子书:', book);
  },

  onDeleteBook(e: any) {
    const { book } = e.detail;
    wx.showModal({
      title: '提示',
      content: `确定要删除《${book.name}》吗？`,
      success: (res) => {
        if (res.confirm) {
          console.log('执行删除:', book._id);
        }
      }
    });
  },

  async openSentencePlay(url:string,book: Book, getPlayList: Function) {
    wx.showLoading({ title: '获取学习列表。', mask: true })
    try {
      const pl = await getPlayList(book._id, 20)
      sentencePlayManager.init(pl, (cursor, limit) => getPlayList(book._id, limit, cursor))
      wx.navigateTo({ url })
    } finally {
      wx.hideLoading()
    }
  }
});