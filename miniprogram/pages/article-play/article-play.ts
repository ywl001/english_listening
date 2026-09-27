import articleService from "../../services/article-service";
import appStore from "../../services/app-store";

// 语速档位循环
const RATES = [0.5, 0.75, 1, 1.25, 1.5];

function fmtSec(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' + s : s}`;
}

function mod3(n: number): number {
  return ((n % 3) + 3) % 3;
}

Page({
  data: {
    loading: true,
    sentences: [] as ArticleSentence[],
    displayList: [null, null, null] as (ArticleSentence | null)[], // 虚拟 3 卡片
    realIndex: 0,     // 真实数据索引
    swiperCurrent: 0, // Swiper 视图索引 (0, 1, 2)
    currentIndex: 0,
    totalCount: 0,
    isPlaying: false,
    currentTimeText: '0:00',
    durationText: '0:00',
    sliderValue: 0,
    sliderMax: 0,
    isFavorite: false,
    rate: 1,
    rateLabel: '1x',
    audioLoading: true,
    showEnglish: true, // 页面级显示状态：切句后保持，直到用户再点击
    showChinese: true
  },

  audio: null as WechatMiniprogram.InnerAudioContext | null,
  articleId: '',
  bookId: '',
  // startTime 原始值数组（与 sentences 同下标），单位判定后归一化为秒
  startTimes: [] as number[],
  timeUnitChecked: false,
  lastUiTick: -1,
  favPending: false,
  // 音频可播前 seek 无效，缓存到 canplay 后再执行
  audioReady: false,
  pendingSeek: null as number | null,

  onLoad(options: { articleId?: string; title?: string }) {
    this.articleId = options.articleId || '';
    if (options.title) {
      wx.setNavigationBarTitle({ title: decodeURIComponent(options.title) });
    }
    if (this.articleId) {
      this.loadContent(this.articleId);
      this.loadFavoriteState();
    } else {
      this.setData({ loading: false });
      wx.showToast({ title: '参数错误', icon: 'none' });
    }
  },

  /** 数据加载：文章本体 + 全部句子，网络细节收口在 articleService */
  async loadContent(articleId: string) {
    try {
      const [{ article, audioSrc }, sentences] = await Promise.all([
        articleService.getArticle(articleId),
        articleService.getArticleSentences(articleId)
      ]);
      this.bookId = article.bookId || '';
      this.startTimes = sentences.map(s => Number(s.startTime) || 0);
      this.timeUnitChecked = false;

      this.setData({
        sentences,
        totalCount: sentences.length,
        loading: false
      });
      this.updateDisplayList(0);

      if (!audioSrc) {
        wx.showToast({ title: '音频不可用', icon: 'none' });
        return;
      }
      this.initAudio(audioSrc);
    } catch (err) {
      console.error('[article-play] 加载失败:', err);
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  initAudio(src: string) {
    const audio = wx.createInnerAudioContext();
    audio.src = src;
    audio.obeyMuteSwitch = false;

    audio.onCanplay(() => {
      // 首次缓冲完成：去掉 loading，并补执行缓冲期间积压的 seek
      this.audioReady = true;
      this.setData({ audioLoading: false });
      if (this.pendingSeek !== null) {
        const sec = this.pendingSeek;
        this.pendingSeek = null;
        audio.seek(sec);
      }
    });
    // 播放中缓冲（大 mp3 播放到未下载部分）：显示 loading，恢复后去掉
    audio.onWaiting(() => this.setData({ audioLoading: true }));
    audio.onPlay(() => this.setData({ isPlaying: true, audioLoading: false }));
    audio.onPause(() => this.setData({ isPlaying: false }));
    audio.onEnded(() => {
      this.setData({ isPlaying: false });
      // 播放完毕：游标回到第一个句子（暂停状态，不自动重播）
      if (this.data.realIndex !== 0 && this.data.sentences.length) {
        this.setData({ realIndex: 0, currentIndex: 0, swiperCurrent: 0 });
        this.updateDisplayList(0);
      }
      this.seekTo(0);
      // audio.play() 自动重新播放
    });
    audio.onError((err) => {
      console.error('[article-play] 音频错误:', err);
      this.setData({ isPlaying: false, audioLoading: false });
      wx.showToast({ title: '播放失败', icon: 'none' });
    });
    audio.onTimeUpdate(() => this.onTimeUpdate(audio));

    this.audio = audio;
    audio.play();
  },

  /* ---------------- 时间 -> 句子定位 ---------------- */

  /**
   * startTime 单位自适应：库中可能是毫秒。
   * 拿到总时长后判断：最大起始值明显超过总时长（>2 倍）则按毫秒除以 1000。
   */
  checkTimeUnit(duration: number) {
    if (this.timeUnitChecked || !this.startTimes.length) return;
    if (duration <= 0) return;
    const maxRaw = Math.max(...this.startTimes);
    if (maxRaw > duration * 2) {
      this.startTimes = this.startTimes.map(v => v / 1000);
    }
    this.timeUnitChecked = true;
  },

  /** 当前播放时间对应的句子下标（-1 表示还在第一句之前） */
  findIndex(t: number): number {
    const st = this.startTimes;
    if (!st.length || t < st[0]) return -1;
    let idx = this.data.realIndex;
    if (idx < 0) idx = 0;
    while (idx + 1 < st.length && st[idx + 1] <= t) idx++;
    while (idx > 0 && st[idx] > t) idx--;
    return idx;
  },

  onTimeUpdate(audio: WechatMiniprogram.InnerAudioContext) {
    const t = audio.currentTime || 0;
    const duration = audio.duration || 0;
    this.checkTimeUnit(duration);

    const patch: Record<string, any> = {};
    const idx = this.findIndex(t);

    // 播放时间推进到新句子：同步真实索引 + swiper 视图 + 3 卡片数据
    if (idx >= 0 && idx !== this.data.realIndex) {
      const diff = mod3(idx - this.data.realIndex);
      patch.realIndex = idx;
      patch.currentIndex = idx;
      patch.swiperCurrent = mod3(this.data.swiperCurrent + diff);
    }

    // 进度 UI 节流：每 0.5s 刷一次
    const tick = Math.floor(t * 2);
    if (tick !== this.lastUiTick) {
      this.lastUiTick = tick;
      patch.sliderValue = t;
      patch.sliderMax = duration;
      patch.currentTimeText = fmtSec(t);
      patch.durationText = fmtSec(duration);
    }
    if (Object.keys(patch).length) this.setData(patch);
    if (patch.realIndex !== undefined) {
      this.updateDisplayList(patch.realIndex);
    }
  },

  /* ---------------- 滑动切换（参考 sentence-play） ---------------- */

  // 更新 3 张卡片的显示数据
  updateDisplayList(realIndex: number) {
    const list = this.data.sentences;
    const total = list.length;
    if (total === 0) return;

    // 计算上一个和下一个在真实数组中的下标（考虑边界）
    const prevReal = (realIndex - 1 + total) % total;
    const nextReal = (realIndex + 1) % total;

    const swiperCurrent = this.data.swiperCurrent;
    const prevSwiper = mod3(swiperCurrent - 1);
    const nextSwiper = mod3(swiperCurrent + 1);

    const displayList = [...this.data.displayList];
    displayList[swiperCurrent] = list[realIndex] ? { ...list[realIndex] } : null;
    displayList[prevSwiper] = list[prevReal] ? { ...list[prevReal] } : null;
    displayList[nextSwiper] = list[nextReal] ? { ...list[nextReal] } : null;

    this.setData({ displayList });
  },

  // Swiper 手势滑动事件
  onSwiperChange(e: any) {
    const newSwiperCurrent = e.detail.current;
    const oldSwiperCurrent = this.data.swiperCurrent;
    if (newSwiperCurrent === oldSwiperCurrent) return;

    // 计算滑动方向：往前划 (+1) 还是往后划 (-1)
    let diff = newSwiperCurrent - oldSwiperCurrent;
    if (diff === -2) diff = 1;  // 从 2 划到 0，相当于向后 1 页
    if (diff === 2) diff = -1;  // 从 0 划到 2，相当于向前 1 页

    const total = this.data.sentences.length;
    if (total === 0) return;

    const newRealIndex = (this.data.realIndex + diff + total) % total;

    this.setData({
      swiperCurrent: newSwiperCurrent,
      realIndex: newRealIndex,
      currentIndex: newRealIndex
    });
    this.updateDisplayList(newRealIndex);

    // 用户手势切句：跳到该句起始时间（播放中继续播，暂停中只挪进度）
    if (e.detail.source === 'touch') {
      this.seekTo(this.startTimes[newRealIndex] || 0);
    }
  },

  /** 点击英文区域：切换显示/隐藏（页面级状态，切句后保持） */
  onToggleEnglish() {
    this.setData({ showEnglish: !this.data.showEnglish });
  },

  /** 点击中文区域：切换显示/隐藏（页面级状态，切句后保持） */
  onToggleChinese() {
    this.setData({ showChinese: !this.data.showChinese });
  },

  /* ---------------- 播放控制 ---------------- */

  onTogglePlay() {
    const audio = this.audio;
    if (!audio || this.data.audioLoading) return; // 缓冲中禁止操作
    if (this.data.isPlaying) {
      audio.pause();
    } else {
      audio.play();
    }
  },

  /** 拖动进度条 */
  onSeek(e: WechatMiniprogram.CustomEvent) {
    this.seekTo(Number(e.detail.value) || 0);
  },

  seekTo(sec: number) {
    const audio = this.audio;
    if (!audio) return;
    // 首帧还没缓冲好时 seek 无效：缓存到 onCanplay 后再执行
    if (!this.audioReady) {
      this.pendingSeek = sec;
      this.lastUiTick = -1;
      this.setData({
        sliderValue: sec,
        currentTimeText: fmtSec(sec)
      });
      return;
    }
    audio.seek(sec);
    // 暂停中拖动：只更新进度显示
    if (!this.data.isPlaying) {
      this.lastUiTick = -1;
      this.setData({
        sliderValue: sec,
        currentTimeText: fmtSec(sec)
      });
    }
  },

  /** 语速循环切换 */
  onCycleRate() {
    const cur = RATES.indexOf(this.data.rate);
    const rate = RATES[(cur + 1) % RATES.length];
    if (this.audio) this.audio.playbackRate = rate;
    this.setData({ rate, rateLabel: `${rate}x` });
  },

  /* ---------------- 收藏 ---------------- */

  async loadFavoriteState() {
    const isFavorite = await articleService.getFavorite(this.articleId);
    this.setData({ isFavorite });
  },

  async onToggleFavorite() {
    if (!this.articleId || this.favPending) return;
    const next = !this.data.isFavorite;
    this.setData({ isFavorite: next }); // 乐观更新
    // 同步虚拟书"我收藏的文章"的计数（失败会回滚）
    appStore.articleFavoriteCount.value = Math.max(0, appStore.articleFavoriteCount.value + (next ? 1 : -1));
    this.favPending = true;
    try {
      await articleService.toggleFavorite(this.articleId, this.bookId, next);
      wx.showToast({ title: next ? '已收藏' : '已取消收藏', icon: 'none' });
    } catch (err) {
      console.error('[article-play] 收藏同步失败:', err);
      this.setData({ isFavorite: !next });
      appStore.articleFavoriteCount.value = Math.max(0, appStore.articleFavoriteCount.value + (next ? -1 : 1));
      wx.showToast({ title: '收藏同步失败', icon: 'none' });
    } finally {
      this.favPending = false;
    }
  },

  onUnload() {
    this.audio?.destroy();
    this.audio = null;
  }
});
