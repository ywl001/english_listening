import { AppEvent } from "../../services/event-type";
import eventBus from "../../services/EventBus";
import { PlayEngine } from "../../services/sentence-play-engine";
import sentencePlayManager from "../../services/sentence-play-manager";

Page({
  data: {
    bookTitle: '',
    currentIndex: 0,
    totalCount: 0,
    sentenceList: [] as Sentence[], // 保存全量队列用于 Swiper 渲染
    currentSentence: null as Sentence | null,
    isPlaying: false,
    hideZh: false,
    isLooping: false,
    playbackRate: 1.0,
    // isFavorite: false,
    // stage: 0
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
            sentenceList: sentencePlayManager.sentenceList, // 动态同步队列列表（包含 loadMore 进来的新数据）
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

  /* ---------------- 滑动事件处理 ---------------- */

  // Swiper 手势滑动触发事件
  onSwiperChange(e: WechatMiniprogram.TouchEvent) {
    // 仅响应由用户手指拖动导致的动画结束 (source === 'touch')
    if (e.detail.source === 'touch') {
      const targetIndex = e.detail.current;
      const currentIndex = this.data.currentIndex;

      if (targetIndex > currentIndex) {
        // 向左滑动 -> 切换到下一句
        this.playEngine?.next(false);
      } else if (targetIndex < currentIndex) {
        // 向右滑动 -> 切换到上一句
        this.playEngine?.prev();
      }
    }
  },

  onUnload() {
    this.playEngine?.destroy();
    this.playEngine = null;
  },

  /* ---------------- 纯 UI 事件：触发 EventBus ---------------- */

  onToggleFavorite(e: WechatMiniprogram.CustomEvent) {
    const sentence = e.target.dataset.data;
    if (!sentence) return;

    const nextState = !sentence.isFavorite;
    sentencePlayManager.updateSentence(sentence._id, { isFavorite: nextState });

    this.setData({
      sentenceList: [...sentencePlayManager.sentenceList]
    });

    wx.showToast({
      title: nextState ? '已收藏' : '已取消收藏',
      icon: 'none',
      duration: 1500
    });

    eventBus.emit(AppEvent.FAVORITE_SENTENCE, {
      sentenceId: sentence._id,
      isFavorite: nextState,
      bookId: sentence.bookId
    });
  },

  onMarkLearned(e: WechatMiniprogram.CustomEvent) {
    const sentence = e.target.dataset.data;
    if (!sentence) return;

    console.log(sentence)

    const currentStage = sentence.mark?.stage || 0;
    const nextStage = currentStage + 1;
    const newMark = {...sentence.mark,stage:nextStage}
    console.log(nextStage)

    sentencePlayManager.updateSentence(sentence._id, { mark: newMark });
    this.setData({
      sentenceList: [...sentencePlayManager.sentenceList]
    });
 
    wx.showToast({
      title: `掌握度 +1 (Level ${nextStage})`,
      icon: 'none',
      duration: 1500
    });

    eventBus.emit(AppEvent.MARK_SENTENCE, {
      sentenceId: sentence._id,
      currentStage: currentStage,
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