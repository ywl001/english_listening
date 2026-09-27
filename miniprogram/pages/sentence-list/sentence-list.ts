import { Pages } from "../../enums/app-enums";
import appStore from "../../services/app-store";
import { AppEvent } from "../../services/event-type";
import eventBus from "../../services/EventBus";
import sentencePlayManager from "../../services/sentence-play-manager";


const audioCtx = wx.createInnerAudioContext();

Page({
  data: {
    sentenceList: [] as Sentence[],
    displayList: [] as Sentence[],
    keyword: '',
    showDeleteDialog: false,
    deleteSentence: null as Sentence | null,
    deleteDialogText: '',
    // 书类型：ref=引用书（删除=移除收藏）、user=用户实体书（删除=删句子+引用）、system=系统书（不可删）
    bookKind: '' as 'ref' | 'user' | 'system',
    canDelete: false,
    bookId: '',
    bookName: '',
    showGenerator: false,

    // 全部播放控制状态
    isPlayingAll: false,
    currentIndex: -1,
    // 首次 onShow（onLoad 之后）不重建，列表由 initManagerAndNavigate 初始化
    firstShow: true,

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

    // 判断书类型，决定删除行为（系统书理论上进不了此页，做兜底保护）
    const book = appStore.books.value.find(b => b._id === bookId);
    let bookKind: 'ref' | 'user' | 'system' = 'system';
    if (book) {
      bookKind = book.type === 'ref' ? 'ref' : (book._openid ? 'user' : 'system');
    } else if (bookId.startsWith('origin_')) {
      bookKind = 'user'; // 我的句子（默认实体书）
    }

    this.setData(
      {
        sentenceList: sentencePlayManager.sentenceList,
        bookId,
        bookName,
        bookKind,
        canDelete: bookKind !== 'system',
        displayList: this.filterList(sentencePlayManager.sentenceList, this.data.keyword),
      }
    );
    // strict 模式下方法引用脱离实例调用 this 为 undefined，必须用箭头函数包装
    (this as any).refreshDataHandler = () => this.refreshData();
    eventBus.on(AppEvent.REFRESH_SENTENCE_LIST, (this as any).refreshDataHandler)
  },

  onShow() {
    // 从播放页返回：重新拉取播放队列（学过的句子进复习队列，不再出现在列表里）
    if (this.data.firstShow) {
      this.setData({ firstShow: false })
      return
    }
    if (!this.data.bookId) return
    eventBus.emit(AppEvent.REBUILD_PLAYLIST, { bookId: this.data.bookId })
  },

  onUnload() {
    audioCtx.stop();
    eventBus.off(AppEvent.REFRESH_SENTENCE_LIST, (this as any).refreshDataHandler)
  },

  refreshData() {
    this.setData({
      sentenceList: sentencePlayManager.sentenceList,
      displayList: this.filterList(sentencePlayManager.sentenceList, this.data.keyword),
    })
  },

  // 删除入口：按书类型弹不同文案的确认框（统计数据由 controller 回传）
  onDelete(e: WechatMiniprogram.CustomEvent) {
    if (!this.data.canDelete) return
    const sentence = e.currentTarget.dataset.data as Sentence
    if (!sentence) return

    if (this.data.bookKind === 'ref') {
      // 引用书：取消该句子在本书的收藏
      this.setData({
        deleteSentence: sentence,
        deleteDialogText: '确定要取消收藏该句子吗？',
        showDeleteDialog: true
      })
    } else {
      // 用户实体书：先查收藏情况（controller 回传），弹窗文案带提示
      eventBus.emit(AppEvent.DELETE_SENTENCE, {
        sentenceId: sentence._id,
        bookId: sentence.bookId,
        confirm: false,
        callback: (check: any) => {
          const extra = check?.needConfirm
            ? `该句子被收藏 ${check.favoriteCount} 处，删除后相关收藏将一并移除。`
            : ''
          this.setData({
            deleteSentence: sentence,
            deleteDialogText: `确定要删除该句子吗？${extra}`,
            showDeleteDialog: true
          })
        }
      })
    }
  },

  confirmDelete() {
    const sentence = this.data.deleteSentence
    if (!sentence) return

    this.setData({ showDeleteDialog: false, deleteSentence: null })

    if (this.data.bookKind === 'ref') {
      // 引用书：仅标记本书维度的收藏记录 deleted（controller 处理并刷新列表）
      eventBus.emit(AppEvent.REMOVE_FAVORITE, {
        sentenceId: sentence._id,
        refBookId: this.data.bookId
      })
    } else if (this.data.bookKind === 'user') {
      // 用户实体书：controller 负责云端删除、本地缓存清理、队列移除、列表刷新与提示
      eventBus.emit(AppEvent.DELETE_SENTENCE, { sentenceId: sentence._id, bookId: sentence.bookId, confirm: true })
    }
  },

  cancelDelete() {
    this.setData({
      showDeleteDialog: false,
      deleteSentence: null
    })
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
    console.log('add sentence')
    this.setData({ showGenerator: true })
  },

  closeGenerator() {
    this.setData({ showGenerator: false })
  },

  onSentenceSaved(e: WechatMiniprogram.CustomEvent) {
    console.log('list e', e)
    const s = e.detail.sentence
    sentencePlayManager.sentenceList.push(s)
    this.refreshData()
    this.closeGenerator()
  }
});