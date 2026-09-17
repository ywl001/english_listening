import bookService from '../../services/book-service';
import { BookType, Pages } from '../../enums/app-enums';
import sentenceService from '../../services/sentence-service';
import { initManagerAndNavigate } from '../../utils/sentenceUtils';

Page({
  data: {
    activeTab: 'system' as 'system' | 'user',
    systemBooks: [] as Book[],
    userBooks: [] as Book[],
    showSettingsModal: false,
    showBookCreate: false,
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
      const url = `${Pages.sentenceList}?bookId=${book._id}&bookName=${book.name}`
      initManagerAndNavigate(url, book._id, sentenceService.getFavoriteSentences)
    } else {
      const url = `${Pages.sentencePlay}?bookId=${book._id}&bookName=${book.name}`
      initManagerAndNavigate(url, book._id, sentenceService.getPlayList)
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

  openCreateBook() {
    console.log('create book')
    this.setData({ showBookCreate: true })
  },
  
  async onCreateBook(e:any) {
    const { name } = e.detail
    const book = await bookService.createBook(name, BookType.sentence)
    this.setData({
      userBooks:this.data.userBooks.concat(book)
    })
  }

});