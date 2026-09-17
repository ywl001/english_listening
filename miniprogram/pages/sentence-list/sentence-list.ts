import { Pages } from "../../enums/app-enums";
import { AppEvent } from "../../services/event-type";
import eventBus from "../../services/EventBus";
import sentencePlayManager from "../../services/sentence-play-manager";
import sentenceService from "../../services/sentence-service";
import { initManagerAndNavigate } from "../../utils/sentenceUtils";


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
    console.log(sentencePlayManager.sentenceList)
    
    this.setData(
      {
        sentenceList: sentencePlayManager.sentenceList,
        bookId,
        displayList: this.filterList(sentencePlayManager.sentenceList, this.data.keyword),
      }
    );
    eventBus.on(AppEvent.REFRESH_SENTENCE_LIST,this.refreshData)
  },

  onUnload() {
    audioCtx.stop();
    eventBus.off(AppEvent.REFRESH_SENTENCE_LIST,this.refreshData)
  },

  refreshData(){
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
    wx.navigateTo({url:Pages.sentencePlay})
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
    wx.showModal({
      title: '添加新句子',
      editable: true,
      placeholderText: '请输入英文句子',
      success: (res) => {
        if (res.confirm && res.content) {
          console.log('用户输入：', res.content);
          // TODO: 调用添加接口
        }
      }
    });
  },
});