import { Pages } from "../../enums/app-enums";
import { AppEvent } from "../../services/event-type";
import eventBus from "../../services/EventBus";
import sentencePlayManager from "../../services/sentence-play-manager";


const audioCtx = wx.createInnerAudioContext();

Page({
  data: {
    sentenceList: [] as Sentence[],
    displayList: [] as Sentence[],
    keyword: '',
    // page: 1,
    // pageSize: 20,
    // hasMore: true,
    // loading: false,
    bookId: '',
    bookName: '',

    // 全部播放控制状态
    isPlayingAll: false,
    currentIndex: -1,

    //拖动按钮的参数
    fabX: 20,
    fabY: 500,
  },

  onReady() {
    const windowInfo = (wx as any).getWindowInfo();
    this.setData({
      fabX: windowInfo.windowWidth - 70, // 默认靠右侧
      fabY: windowInfo.windowHeight - 180
    });
  },

  onLoad(options: { bookName: string, bookId: string }) {
    const bookId = options.bookId || '';
    const bookName = options.bookName || ''

    this.setData(
      {
        sentenceList: sentencePlayManager.sentenceList,
        bookId,
        bookName,
        displayList: this.filterList(sentencePlayManager.sentenceList, this.data.keyword),
      }
    );
    eventBus.on(AppEvent.REFRESH_SENTENCE_LIST, this.refreshData)
  },

  onUnload() {
    audioCtx.stop();
    eventBus.off(AppEvent.REFRESH_SENTENCE_LIST, this.refreshData)
  },

  refreshData() {
    this.setData({
      sentenceList: sentencePlayManager.sentenceList,
      displayList: this.filterList(sentencePlayManager.sentenceList, this.data.keyword),
    })
  },

  // 取消收藏：直接调用句子的 toggleFavorite 方法
  onDelete(e: WechatMiniprogram.CustomEvent) {
    const { id } = e.currentTarget.dataset;
    const sentenceId = id as string;
    const bookId = this.data.bookId;

    wx.showModal({
      title: '提示',
      content: '确定要取消收藏该句子吗？',
      confirmColor: '#ee0a24',
      success: async (res) => {
        if (res.confirm) {
          eventBus.emit(AppEvent.FAVORITE_SENTENCE, { sentenceId, bookId, isFavorite: false })
        }
      }
    });
  },

  // 本地搜索过滤
  onSearchInput(e: WechatMiniprogram.Input) {
    const keyword = e.detail.value;
    this.setData({
      keyword,
      displayList: this.filterList(this.data.sentenceList, keyword)
    });
  },

  filterList(list: Sentence[], kw: string) {
    if (!kw.trim()) return list;
    return list.filter(item =>
      (item.en && item.en.toLowerCase().includes(kw.toLowerCase())) ||
      (item.zh && item.zh.includes(kw))
    );
  },

  // 点击单句播放
  playSingleAudio(e: WechatMiniprogram.CustomEvent) {
    const index = e.currentTarget.dataset.index;
    this.setData({ isPlayingAll: false, currentIndex: index });
    this.playCurrentIndexAudio(index);
  },

  // 触发全部播放/暂停
  togglePlayAll() {
    wx.navigateTo({ url: Pages.sentencePlay })
  },

  // 播放指定索引位置的句子音频
  playCurrentIndexAudio(index: number) {
    const target = this.data.displayList[index];
    this.setData({ currentIndex: index });
    audioCtx.stop();
    audioCtx.src = target.audio;
    audioCtx.play();
  },

  // 真正的添加逻辑（从 touchend 调用）
  onAddSentence() {
    console.log('sentence list data:', this.data)
    const url = `${Pages.sentenceInput}?bookId=${this.data.bookId}&bookName=${this.data.bookName}`
    wx.navigateTo({ url })
  }
});