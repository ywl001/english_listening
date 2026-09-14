import bookService from '../../services/book-service';
import { BookType } from '../../enums/app-enums';

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
    const openid = getApp().globalData.openid;

    this.setData({
      systemBooks: allSentenceBooks.filter(b => b.openid !== openid),
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
  }
});