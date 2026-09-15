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
    stage: 0
  },

  playEngine: null as PlayEngine | null,
  currentSentence: null as Sentence | null,


  async onLoad(options: { bookId?: string; bookName?: string }) {
    const bookId = options.bookId || '';
    if (options.bookName) {
      this.setData({ bookTitle: options.bookName });
    }

    wx.showLoading({ title: '加载中...' });

    try {
      const res = await sentenceService.getPlayList(bookId, 20);
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
        repeatCount: 2,
        gapMs: 800,
        limitCount: 0
      },
      {
        onCurrentChange: (sentence, index) => {
          this.currentSentence = sentence;
          const stage = sentence.mark?.stage || 0
          console.log(sentencePlayManager.queueLength)
          this.setData({
            currentSentence: sentence,
            currentIndex: index,
            totalCount: sentencePlayManager.queueLength,
            // 切换句子时恢复或更新状态（可根据实际后端数据修改）
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
    this.playEngine?.destroy();
    this.playEngine = null;
    sentencePlayManager.reset();
  },

  /* 卡片发出的事件处理 */
  async onToggleFavorite(e: any) {
    const currentSentence = this.data.currentSentence;
    if (!currentSentence) return;

    const sentenceId = currentSentence._id;
    const bookId = currentSentence.bookId || this.data.bookTitle; // 根据你实际存储的 bookId 字段调整

    const prevState = this.data.isFavorite;
    const nextState = !prevState;

    // 1. 乐观更新：立马改变本地 UI 状态，提示用户
    this.setData({ isFavorite: nextState });
    if (currentSentence) {
      currentSentence.isFavorite = nextState; // 同步更新当前句子对象的属性
    }

    wx.showToast({
      title: nextState ? '已收藏' : '已取消收藏',
      icon: 'none',
      duration: 1500
    });

    try {
      // 2. 调用服务更新数据库
      const app = getApp<IAppOption>()
      const favoriteBookId = app.globalData.favoriteBookId as string;
      console.log(favoriteBookId)
      const res = await sentenceService.toggleFavorite(sentenceId,favoriteBookId);

      // 3. 服务端返回成功，矫正为服务器最终状态
      this.setData({ isFavorite: res.isFavorite });
      currentSentence.isFavorite = res.isFavorite;

      // 4. 重要：同步更新 sentencePlayManager / 播放队列中的数据
      // 保证翻到下一句再翻回来时，状态不会丢失
      if (sentencePlayManager.currentSentence) {
        sentencePlayManager.currentSentence.isFavorite = res.isFavorite;
      }
    } catch (err) {
      // 5. 失败回滚：复原 UI 和对象属性
      console.error('切换收藏失败，正在回滚:', err);
      this.setData({ isFavorite: prevState });
      currentSentence.isFavorite = prevState;
      if (sentencePlayManager.currentSentence) {
        sentencePlayManager.currentSentence.isFavorite = prevState;
      }

      wx.showToast({
        title: '操作失败，请重试',
        icon: 'none'
      });
    }
  },

  async onMarkLearned() {
    const currentSentence = sentencePlayManager.currentSentence;
    if (!currentSentence) return;

    const sentenceId = currentSentence._id;
    const bookId = currentSentence.bookId;

    // 1. 获取旧 mark 状态并计算新 stage 和下一次复习时间
    const oldMark = currentSentence.mark || { stage: 0, nextReviewAt: 0 };
    const newStage = (oldMark.stage || 0) + 1;
    const nextReviewAt = this.calculateNextReviewAt(oldMark.stage || 0);

    const updatedMark = {
      ...oldMark,
      stage: newStage,
      nextReviewAt: nextReviewAt,
      updatedAt: Date.now()
    };
    console.log(updatedMark)

    // 2. 乐观更新：先修改本地数据和 UI 提示
    sentencePlayManager.updateSentence(sentenceId, { mark: updatedMark as SentenceMark });

    // 更新页面当前渲染的 data
    this.setData({
      'currentSentence.mark': updatedMark,
      stage: newStage
    });

    wx.showToast({
      title: `掌握度 +1 (Level ${newStage})`,
      icon: 'none',
      duration: 1500
    });

    // 3. 异步提交到服务器
    try {
      await sentenceService.upsertMark(
        sentenceId,
        {
          stage: newStage,
          nextReviewAt: nextReviewAt
        },
        bookId
      );

      // 4. 操作成功后，通常自动切换到下一句（符合听力/背诵习惯）
      // this.onNextSentence();
    } catch (err) {
      console.error('更新句子标记失败，正在回滚:', err);

      // 5. 失败回滚
      sentencePlayManager.updateSentence(sentenceId, { mark: oldMark as SentenceMark });
      this.setData({
        'currentSentence.mark': oldMark
      });

      wx.showToast({
        title: '提交失败，请重试',
        icon: 'none'
      });
    }
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
  },

  // 艾宾浩斯复习间隔（单位：分钟或毫秒）
  // stage 1: 5分钟，stage 2: 30分钟，stage 3: 12小时，stage 4: 1天，stage 5: 2天，stage 6: 4天，stage 7: 7天，stage 8: 15天...
  calculateNextReviewAt(currentStage: number): number {
    const nextStage = currentStage + 1;
    const intervalsInMinutes: Record<number, number> = {
      1: 5,           // 5 分钟
      2: 30,          // 30 分钟
      3: 12 * 60,     // 12 小时
      4: 24 * 60,     // 1 天
      5: 2 * 24 * 60, // 2 天
      6: 4 * 24 * 60, // 4 天
      7: 7 * 24 * 60, // 7 天
      8: 15 * 24 * 60,// 15 天
    };

    // 如果 stage 超过预设最大值，按 30 天计算
    const minutes = intervalsInMinutes[nextStage] || 30 * 24 * 60;
    return Date.now() + minutes * 60 * 1000;
  }
});