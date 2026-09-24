import bookService from '../../services/book-service';
import { BookType as BookContent, BookType, Pages } from '../../enums/app-enums';
import sentenceService from '../../services/sentence-service';
import sentencePlayManager from '../../services/sentence-play-manager';
import eventBus from '../../services/EventBus';
import { AppEvent } from '../../services/event-type';
import { initManagerAndNavigate } from '../../utils/util';
import sentencePlayList from '../../services/sentence-play-list';

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

    eventBus.on(AppEvent.GET_BOOK_SUCCESS, e => this.onGetBookSuccess(e))
    eventBus.emit(AppEvent.GET_BOOK)
  },

  async onGetBookSuccess(books: Book[]) {
    await getApp().openidReady;
    const _openid = getApp().globalData._openid
    const userBooks = books.filter(item => item._openid === _openid && item.content === BookContent.sentence);
    const systemBooks = books.filter(item => item.content === BookType.sentence && !item._openid);
    this.setData({ userBooks, systemBooks })
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
    eventBus.emit(AppEvent.SET_CURRENT_BOOK,book)
    console.log(book)
    let url: string, res
    const userSentenceBookId = (getApp() as IAppOption).globalData.originBookId
    if (book._id === userSentenceBookId) {
      url = `${Pages.sentenceList}?bookId=${book._id}&bookName=${book.name}`
      initManagerAndNavigate(url,book,sentenceService.getPlayList)
    } else if (book._openid) {
      url = `${Pages.sentenceList}?bookId=${book._id}&bookName=${book.name}`
      console.log(book._id, book.name)
      initManagerAndNavigate(url,book,sentenceService.getFavoritePlayList)
    }
    else {
      url = `${Pages.sentencePlay}?bookId=${book._id}&bookName=${book.name}`
      initManagerAndNavigate(url,book,sentenceService.getPlayList)
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

  async onCreateBook(e: any) {
    const { name } = e.detail
    const book = await bookService.createBook(name, BookContent.sentence)
    this.setData({
      userBooks: this.data.userBooks.concat(book)
    })
  }

});