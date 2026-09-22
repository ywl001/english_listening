import bookService from '../../services/book-service';
import { BookType as BookContent, Pages } from '../../enums/app-enums';
import sentenceService from '../../services/sentence-service';
import sentencePlayManager from '../../services/sentence-play-manager';

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

  async onLoad() {
    const cachedSettings = wx.getStorageSync('playback_settings');
    if (cachedSettings) {
      this.setData({ settings: cachedSettings });
    }

    this.loadData();
  },

  async loadData() {
    console.log('book list load book')
    const allSentenceBooks = await bookService.getSentenceBooks();
    const userBooks = await bookService.getUserBooks();
    const userSentenceBooks = userBooks.filter(b => b.content === BookContent.sentence);
    await getApp().openidReady;
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
    const book: Book = e.detail.book;
    console.log(book)
    wx.showLoading({ title: '获取学习列表。', mask: true })
    let url, list
    const userSentenceBookId = (getApp() as IAppOption).globalData.originBookId
    if (book._id === userSentenceBookId) {
      url = `${Pages.sentenceList}?bookId=${book._id}&bookName=${book.name}`
      list = await sentenceService.getPlayList(book._id)
    } else if (book._openid) {
      url = `${Pages.sentenceList}?bookId=${book._id}&bookName=${book.name}`
      console.log(book._id, book.name)
      list = await sentenceService.getFavoriteSentences(book._id)
    }
    else {
      url = `${Pages.sentencePlay}?bookId=${book._id}&bookName=${book.name}`
      list = await sentenceService.getPlayList(book._id)
    }
    sentencePlayManager.init(book, list)
    wx.navigateTo({ url })
    wx.hideLoading()
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

  async onCreateBook(e: any) {
    const { name } = e.detail
    const book = await bookService.createBook(name, BookContent.sentence)
    this.setData({
      userBooks: this.data.userBooks.concat(book)
    })
  }

});