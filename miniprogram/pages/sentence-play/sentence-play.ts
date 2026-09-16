import { AppEvent } from "../../services/event-type";
import eventBus from "../../services/EventBus";
import { PlayEngine } from "../../services/sentence-play-engine";
import sentencePlayManager from "../../services/sentence-play-manager";


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
    isFavorite: false,
    stage: 0
  },

  playEngine: null as PlayEngine | null,

  onLoad(options: { title?: string }) {
    if (options.title) {
      this.setData({ bookTitle: decodeURIComponent(options.title) });
    }

    // 1. 初始化播放引擎
    this.initEngine();
    // 2. 自动开启播放
    this.playEngine?.start();
  },

  initEngine() {
    const audioCtx = wx.createInnerAudioContext();

    this.playEngine = new PlayEngine(
      audioCtx,
      sentencePlayManager,
      {
        playMode: 'sequence',
        playOrder: 'zh_first',
        repeatCount: 2,
        gapMs: 800,
        limitCount: 0
      },
      {
        onCurrentChange: (sentence, index) => {
          const stage = sentence?.mark?.stage || 0;
          this.setData({
            currentSentence: sentence,
            currentIndex: index,
            totalCount: sentencePlayManager.queueLength,
            isFavorite: !!sentence?.isFavorite,
            stage: stage
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
    // 页面销毁时清空引擎与队列，防内存泄漏
    this.playEngine?.destroy();
    this.playEngine = null;
    sentencePlayManager.reset();
  },

  /* ---------------- 纯 UI 事件：触发 EventBus ---------------- */

  // 1. 点击收藏/取消收藏
  onToggleFavorite() {
    const sentence = this.data.currentSentence;
    if (!sentence) return;

    const nextState = !this.data.isFavorite;

    // 乐观更新：响应 UI
    this.setData({ isFavorite: nextState });
    sentencePlayManager.updateSentence(sentence._id, { isFavorite: nextState });

    wx.showToast({
      title: nextState ? '已收藏' : '已取消收藏',
      icon: 'none',
      duration: 1500
    });

    // 发送消息，交由全局监听者去异步请求接口
    eventBus.emit(AppEvent.FAVORITE_SENTENCE, {
      sentenceId: sentence._id,
      isFavorite: nextState,
      bookId: sentence.bookId
    });
  },

  // 2. 点击标记掌握/复习
  onMarkLearned() {
    const sentence = this.data.currentSentence;
    if (!sentence) return;

    const currentStage = this.data.stage;
    const nextStage = currentStage + 1;

    // 乐观更新 UI
    this.setData({ stage: nextStage });
    wx.showToast({
      title: `掌握度 +1 (Level ${nextStage})`,
      icon: 'none',
      duration: 1500
    });

    // 发送消息，交由全局监听者计算艾宾浩斯时间并请求接口
    eventBus.emit(AppEvent.MARK_SENTENCE, {
      sentenceId: sentence._id,
      currentStage: currentStage,
      bookId: sentence.bookId
    });
  },

  /* ---------------- 播放控制 ---------------- */

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