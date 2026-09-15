import { PlayEngine } from "../../services/sentence-play-engine";
import sentencePlayManager from "../../services/sentence-play-manager";
import sentenceService from "../../services/sentence-service";

Page({
  data: {
    bookTitle: '',
    currentIndex: 0,
    totalCount: 0,
    currentSentence: null as Sentence | null,
    isPlaying: false,
    hideZh: false,
    isLooping: false,
    playbackRate: 1.0,
    isFavorite: false, // 收藏状态
    isMastered: false  // 已会状态
  },

  playEngine: null as PlayEngine | null,
  currentSentence: null as Sentence | null,


  async onLoad(options: { bookId?: string; title?: string }) {
    const bookId = options.bookId || '';
    if (options.title) {
      this.setData({ bookTitle: options.title });
    }

    wx.showLoading({ title: '加载中...' });

    try {
      const res = await sentenceService.getPlayList(bookId, 120);
      console.log(res)
      sentencePlayManager.init(bookId, res);
      this.initEngine();
      this.playEngine?.start();
    } catch (err) {
      console.error('初始化失败', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  initEngine() {
    const audioCtx = wx.createInnerAudioContext();

    this.playEngine = new PlayEngine(
      audioCtx,
      sentencePlayManager,
      {
        playMode: 'sequence',
        playOrder: 'zh_first',
        repeatCount: 1,
        gapMs: 800,
        limitCount: 0
      },
      {
        onCurrentChange: (sentence, index) => {
          this.currentSentence = sentence;
          const isLearned = (sentence.mark?.stage && sentence.mark.stage > 0) as boolean
          this.setData({
            currentSentence: sentence,
            currentIndex: index,
            totalCount: sentencePlayManager.queueLength,
            // 切换句子时恢复或更新状态（可根据实际后端数据修改）
            isFavorite: !!sentence?.isFavorite,
            isMastered: isLearned
          });
        },
        onStatusChange: () => { },
        onPlayingChange: (isPlaying) => this.setData({ isPlaying }),
        onFinished: (msg) => wx.showToast({ title: msg, icon: 'none' }),
        onNotice: (msg) => wx.showToast({ title: msg, icon: 'none' })
      }
    );
  },

  onUnload() {
    this.playEngine?.destroy();
    this.playEngine = null;
    sentencePlayManager.reset();
  },

  /* 卡片发出的事件处理 */
  onToggleFavorite(e: any) {
    const nextState = !this.data.isFavorite;
    this.setData({ isFavorite: nextState });
    wx.showToast({
      title: nextState ? '已收藏' : '已取消收藏',
      icon: 'none'
    });
  },

  onToggleMastered(e: any) {
    const nextState = !this.currentSentence?.mark?.stage;
    console.log(nextState)
    this.setData({ isMastered: nextState });
    wx.showToast({
      title: nextState ? '已标记为掌握' : '已取消标记',
      icon: 'none'
    });
  },

  /* UI 事件绑定 */
  onTogglePlay() {
    this.playEngine?.pauseToggle();
  },

  onNext() {
    this.playEngine?.next(false);
  },

  onPrev() {
    this.playEngine?.prev();
  },

  onFirst() {
    if (sentencePlayManager.queueLength > 0) {
      while (sentencePlayManager.currentIndexNum > 0) {
        sentencePlayManager.prev();
      }
      this.playEngine?.replay();
    }
  },

  onReplay() {
    this.playEngine?.replay();
  },

  onToggleZh() {
    this.setData({ hideZh: !this.data.hideZh });
  },

  onToggleLoop() {
    const nextState = !this.data.isLooping;
    this.setData({ isLooping: nextState });

    this.playEngine?.updateConfig({
      repeatCount: nextState ? 999 : 1
    });
  },

  onChangeSpeed() {
    const speeds = [1.0, 1.25, 0.8];
    const nextIdx = (speeds.indexOf(this.data.playbackRate) + 1) % speeds.length;
    const rate = speeds[nextIdx];

    this.setData({ playbackRate: rate });
    if (this.playEngine) {
      // @ts-ignore
      this.playEngine['audioCtx'].playbackRate = rate;
    }
  },

  onBack() {
    wx.navigateBack();
  }
});