import { computed } from "@preact/signals-core";
import { AppEvent } from "../../services/event-type";
import eventBus from "../../services/EventBus";
import { PlayEngine } from "../../services/sentence-play-engine";
import { SegmentAudioPlayer } from "../../services/segment-audio-player";
import sentencePlayManager from "../../services/sentence-play-manager";
import appStore from "../../services/app-store";
import { bindSignal } from "../../utils/signal-bind";
import { LocalStorageKey } from "../../enums/app-enums";

// swiper 3 视图索引取模（支持负数）
function mod3(n: number): number {
  return ((n % 3) + 3) % 3;
}

// 胶囊 key（zh_en/en_zh/en_only）-> 引擎 playOrder 映射
// 页面 data.playOrder 统一存胶囊 key（与 storage、play-bar 属性同一语义），
// 映射只在传给引擎时发生
const ENGINE_ORDER_MAP: Record<string, string> = {
  zh_en: 'zh_first',
  en_zh: 'en_first',
  en_only: 'en_only'
};

Page({
  data: {
    showBookSelectSheet: false,
    autoSavePreference: false,
    bookTitle: '',
    currentIndex: 0,
    totalCount: 0,
    sentenceList: [] as Sentence[],
    displayList: [null, null, null] as (Sentence | null)[], // 虚拟3卡片
    realIndex: 0,     // 真实数据索引 (0 ~ N)
    swiperCurrent: 0, // Swiper 视图索引 (0, 1, 2)
    currentSentence: null as Sentence | null,
    isPlaying: false,
    hideZh: false,
    showEnglish: true, // 页面级显示状态：切句后保持，直到用户再点击
    showChinese: true,
    isLooping: false,
    playbackRate: 1.0,
    playOrder: 'zh_en',
    repeatCount: 1,
    limitCount: 0,
    favoriteBookName: '收藏',
    myBooks: [] as { id: string; name: string; cover?: string; isSelected?: boolean }[],
    bookNames: {} as Record<string, string>
  },

  playEngine: null as PlayEngine | null,

  onLoad(options: { bookName?: string }) {
    // URL 参数名为 bookName
    const name = options.bookName;
    if (name) {
      this.setData({ bookTitle: decodeURIComponent(name) });
    }

    // 收藏本名称：跟随 appStore.currentFavoriteBook
    const favoriteBookName = computed(
      () => appStore.currentFavoriteBook.value?.name || '收藏'
    );
    bindSignal(this, favoriteBookName, 'favoriteBookName');

    // 长按收藏弹窗的书籍列表：在 onLongTapFavorite 时按句子实际收藏状态构建（勾选 = 已收藏的句集）

    // 夹子 id -> 名称 映射（含当前默认收藏夹），供卡片显示句子所在夹子名
    const bookNames = computed(() => {
      const map: Record<string, string> = {};
      appStore.refBooks.value.forEach((b) => { map[b._id] = b.name; });
      const cur = appStore.currentFavoriteBook.value;
      if (cur) map[cur._id] = cur.name;
      return map;
    });
    bindSignal(this, bookNames, 'bookNames');

    // strict 模式下方法引用脱离实例调用 this 为 undefined，必须用箭头函数包装
    (this as any).listRefreshHandler = () => this.onSentenceListRefresh();
    eventBus.on(AppEvent.REFRESH_SENTENCE_LIST, (this as any).listRefreshHandler);

    // 1. 初始化播放引擎
    this.initEngine();
    // 2. 自动开启播放
    this.playEngine?.start();
  },

  onSentenceListRefresh() {
    console.log('play refresh');
    const list = sentencePlayManager.sentenceList;
    this.setData({ sentenceList: [...list] });
    // 刷新列表时同步刷新当前卡片
    this.updateDisplayList(this.data.realIndex);
  },

  initEngine() {
    const player = new SegmentAudioPlayer();

    // 读取保存的播放设置，与底部胶囊按钮保持同一数据源，避免"显示1次实际播2次"
    // playOrder 存胶囊的 key（大写 ZH_EN/EN_ZH/EN_ONLY），恢复时统一转小写校验
    // 间隔固定 1 秒（原设置弹窗已移除）
    const saved = wx.getStorageSync('playback_settings') as any;
    const rawOrder = typeof saved?.order === 'string' ? saved.order.toLowerCase() : '';
    const playOrder = ['zh_en', 'en_zh', 'en_only'].includes(rawOrder) ? rawOrder : 'zh_en';
    const repeatCount = typeof saved?.repeatCount === 'number' ? saved.repeatCount : 1;
    const limitCount = typeof saved?.limitCount === 'number' ? saved.limitCount : 0;
    const gapMs = (typeof saved?.interval === 'number' ? saved.interval : 1) * 1000;
    this.setData({ playOrder, repeatCount, limitCount });

    this.playEngine = new PlayEngine(
      player,
      sentencePlayManager,
      {
        playMode: 'sequence',
        playOrder: ENGINE_ORDER_MAP[playOrder] as PlayOrder,
        repeatCount,
        gapMs,
        limitCount
      },
      {
        onCurrentChange: (sentence, index) => {
          const list = sentencePlayManager.sentenceList;
          const stage = sentence?.mark?.stage || 0;

          // 自动切句时的滑动方向：前进 +1 / 后退 -1（首次回调 index 不变则不动画）
          const oldReal = this.data.realIndex;
          let swiperCurrent = this.data.swiperCurrent;
          if (index !== oldReal) {
            swiperCurrent = mod3(swiperCurrent + (index > oldReal ? 1 : -1));
          }

          this.setData({
            currentSentence: sentence,
            currentIndex: index,      // 驱动进度条与 Header (1/20)
            realIndex: index,         // 同步真实索引
            swiperCurrent,            // 驱动 swiper 滑动动画
            sentenceList: list,
            totalCount: sentencePlayManager.queueLength,
            isFavorite: !!sentence?.isFavorite,
            stage: stage
          });

          // 【关键修复 1】：音频自动播放切换下一句时，立即刷新 3 卡片渲染数据
          this.updateDisplayList(index);
        },
        onStatusChange: () => { },
        onPlayingChange: (isPlaying) => this.setData({ isPlaying }),
        onFinished: (msg) => wx.showToast({ title: msg, icon: 'none' }),
        onNotice: (msg) => wx.showToast({ title: msg, icon: 'none' })
      }
    );
  },

  /* ---------------- 滑动事件处理 ---------------- */

  // 更新 3 张卡片的显示数据
  updateDisplayList(realIndex: number) {
    const list = this.data.sentenceList;
    const total = list.length;
    if (total === 0) return;

    // 计算上一个和下一个在真实数组中的下标（考虑边界）
    const prevReal = (realIndex - 1 + total) % total;
    const nextReal = (realIndex + 1) % total;

    // 当前 swiperCurrent 对应 realIndex
    const swiperCurrent = this.data.swiperCurrent;
    const prevSwiper = (swiperCurrent - 1 + 3) % 3;
    const nextSwiper = (swiperCurrent + 1) % 3;

    const displayList = [...this.data.displayList];
    // 浅拷贝句子对象，保证卡片 observers 能感知属性变化（isFavorite/favorites 等）
    displayList[swiperCurrent] = list[realIndex] ? { ...list[realIndex] } : null;
    displayList[prevSwiper] = list[prevReal] ? { ...list[prevReal] } : null;
    displayList[nextSwiper] = list[nextReal] ? { ...list[nextReal] } : null;

    // console.log('displayList',displayList)

    this.setData({ displayList });
  },

  // Swiper 手势滑动事件
  onSwiperChange(e: any) {
    // 只有用户主动手势触发才计算逻辑
    const newSwiperCurrent = e.detail.current;
    const oldSwiperCurrent = this.data.swiperCurrent;

    if (newSwiperCurrent === oldSwiperCurrent) return;

    // 计算滑动方向：往前划 (+1) 还是往后划 (-1)
    let diff = newSwiperCurrent - oldSwiperCurrent;
    if (diff === -2) diff = 1;  // 从 2 划到 0，相当于向后 1 页
    if (diff === 2) diff = -1;  // 从 0 划到 2，相当于向前 1 页

    const total = this.data.sentenceList.length;
    if (total === 0) return;

    let newRealIndex = (this.data.realIndex + diff + total) % total;

    // 【关键修复 2】：同步更新 realIndex 和 currentIndex，驱动进度条
    this.setData({
      swiperCurrent: newSwiperCurrent,
      realIndex: newRealIndex,
      currentIndex: newRealIndex
    });

    // 动态刷新 3 张卡片的内容
    this.updateDisplayList(newRealIndex);

    // 切句时同步通知音频引擎切歌（如果是手动滑动的）
    if (e.detail.source === 'touch') {
      if (diff > 0) {
        this.playEngine?.next(false);
      } else {
        this.playEngine?.prev();
      }
    }
  },

  /* ---------------- 纯 UI 事件：触发 EventBus ---------------- */

  onToggleFavorite(e: WechatMiniprogram.CustomEvent) {
    const sentence = e.detail.sentence || e.target.dataset.data;
    if (!sentence) return;

    // 目标夹子：正在播放收藏夹（引用书）时作用于该夹子，否则作用于默认收藏夹
    const playingBook = appStore.books.value.find((b) => b._id === sentencePlayManager.bookId) as Book;
    const fallback = appStore.currentFavoriteBook.value as Book;
    const targetRef = playingBook?.type === 'ref' ? sentencePlayManager.bookId : fallback?._id;
    if (!targetRef) return;

    this.applyFavoriteToggle(sentence, targetRef, playingBook?.type === 'ref' ? playingBook.name : fallback?.name);
  },

  onLongTapFavorite(e: WechatMiniprogram.CustomEvent) {
    console.log('onLongTapFavorite', e);
    const sentence = e.detail.sentence || e.target.dataset.data;
    if (!sentence) return;
    // 记录长按时所在的句子，供选择收藏本后使用
    (this as any).pendingFavoriteSentence = sentence;
    // 弹窗会话内的收藏快照：取消收藏可能把句子移出播放队列，
    // 之后队列数据不可靠，以这份快照作为弹窗内连续勾选/取消的基准
    (this as any).pendingFavs = [...(sentence.favorites || [])];

    // 弹窗勾选状态 = 该句子已收藏在哪些句集（而非默认收藏夹）
    const favs = new Set((this as any).pendingFavs);
    this.setData({
      myBooks: appStore.refBooks.value.map((b) => ({
        id: b._id,
        name: b.name,
        cover: (b as any).cover,
        isSelected: favs.has(b._id)
      })),
      showBookSelectSheet: true
    });
  },

  /* ---------------- 收藏本选择弹窗 ---------------- */

  /**
   * 句集维度收藏切换的公共流程（短按星标 / 长按弹窗选书共用）：
   * 增删目标句集 → 同步队列 favorites/isFavorite → 刷新卡片 → toast → 发 FAVORITE_SENTENCE。
   * 其他句集的收藏一律不动（多夹子共存）。
   * @returns 操作后的 favorites 列表
   */
  applyFavoriteToggle(sentence: Sentence, refBookId: string, bookName: string): string[] {
    const favs: string[] = sentence.favorites || [];
    const inTarget = favs.includes(refBookId);
    const nextFavs = inTarget ? favs.filter((id) => id !== refBookId) : [...favs, refBookId];

    sentencePlayManager.updateSentence(sentence._id, {
      isFavorite: nextFavs.length > 0,
      favorites: nextFavs
    });

    this.setData({ sentenceList: [...sentencePlayManager.sentenceList] });
    this.updateDisplayList(this.data.realIndex); // 刷新卡片 UI

    wx.showToast({
      title: inTarget
        ? (nextFavs.length ? `已从 ${bookName} 移除（其他句集保留）` : `已从 ${bookName} 取消收藏`)
        : `已收藏到 ${bookName}`,
      icon: 'none',
      duration: 1200
    });

    eventBus.emit(AppEvent.FAVORITE_SENTENCE, {
      sentenceId: sentence._id,
      isFavorite: !inTarget, // 句集维度的目标状态：只作用于 refBookId 这一个句集
      bookId: sentence.bookId,
      refBookId
    });

    return nextFavs;
  },

  handleCloseModal() {
    (this as any).pendingFavoriteSentence = null;
    (this as any).pendingFavs = null;
    this.setData({ showBookSelectSheet: false });
  },

  handleSelectBook(e: WechatMiniprogram.CustomEvent) {
    const { bookId } = e.detail;
    const book = appStore.refBooks.value.find((b) => b._id === bookId);
    const pending = (this as any).pendingFavoriteSentence as Sentence | null;
    if (!book || !pending) return;

    // 以弹窗会话内的快照为准（取消收藏可能已把句子移出播放队列，队列数据不可靠）
    const favs: string[] = (this as any).pendingFavs || pending.favorites || [];
    const wasIn = favs.includes(bookId);
    const snapshot: Sentence = { ...pending, favorites: favs };

    // toggle 语义：已勾选 = 从该句集移除，未勾选 = 收藏进该句集（其他句集不受影响）
    const nextFavs = this.applyFavoriteToggle(snapshot, bookId, book.name);
    (this as any).pendingFavs = nextFavs;

    // 新增收藏时切换默认收藏夹 = "上次添加句子的句集"（短按收藏将进入该夹子）
    if (!wasIn) {
      appStore.currentFavoriteBook.value = book;
      wx.setStorageSync(LocalStorageKey.CURRENT_FAVORITE_BOOK, book);
    }

    // 同步弹窗勾选状态：不关闭弹窗，可连续勾选/取消多个句集
    this.setData({
      myBooks: this.data.myBooks.map((b) => ({
        ...b,
        isSelected: b.id === bookId ? !wasIn : b.isSelected
      }))
    });
  },

  handleCreateBook() {
    // TODO: 新建句集
    wx.showToast({ title: '新建句集（待实现）', icon: 'none' });
  },

  handleAutoSaveChange(e: WechatMiniprogram.CustomEvent) {
    this.setData({ autoSavePreference: e.detail.value });
  },

  /**
   * 统一的掌握度标记入口（卡片三个按钮都走 setStage）：
   * 忘记=0（留在当前句重听）、熟悉=8（长期不再复习）、已会=当前 stage+1（封顶 8）
   */
  onSetStage(e: WechatMiniprogram.CustomEvent) {
    const sentence = e.detail.sentence || e.target.dataset.data;
    if (!sentence) return;

    const currentStage = sentence.mark?.stage || 0;
    // 卡片传来的 stage：0 / 8 / stage+1；mark 为空时兜底按 +1 处理，统一封顶 8
    let stage = Number(e.detail.stage);
    if (!Number.isFinite(stage)) stage = currentStage + 1;
    stage = Math.max(0, Math.min(stage, 8));
    if (stage === currentStage && stage !== 0) return; // 已在目标档位，幂等跳过

    const newMark = { ...(sentence.mark || {}), stage };
    sentencePlayManager.updateSentence(sentence._id, { mark: newMark });
    const updatedList = [...sentencePlayManager.sentenceList];
    this.setData({ sentenceList: updatedList });
    this.updateDisplayList(this.data.realIndex); // 刷新卡片 UI

    wx.showToast({
      title: stage === 0 ? '已标记：忘记'
        : stage === 8 ? '已标记：熟悉'
          : `掌握度 +1 (Level ${stage})`,
      icon: 'none',
      duration: 1200
    });

    eventBus.emit(AppEvent.MARK_SENTENCE, {
      sentenceId: sentence._id,
      currentStage,
      targetStage: stage,
      bookId: sentence.bookId
    });

    // 已会 / 熟悉：停留 500ms 让用户看清卡片反馈，再切下一句（忘记留在当前句重听）
    if (stage > 0) {
      this.advanceAfterMark();
    }
  },

  /**
   * 标记后延时切下一句：
   * 标记期间先暂停音频（stop 会触发 token 失效，旧的自动切句流程不会串台），
   * 500ms 后再 next，用户能看到"已会 +N"的数字变化。
   */
  advanceAfterMark() {
    if ((this as any).advanceTimer) {
      clearTimeout((this as any).advanceTimer);
    }
    this.playEngine?.stop();
    (this as any).advanceTimer = setTimeout(() => {
      (this as any).advanceTimer = null;
      this.playEngine?.next(false);
    }, 500);
  },

  /* ---------------- 播放控制 ---------------- */

  /** 卡片点击文字：切换英文显示（页面级状态，切句后保持） */
  onToggleEnglish() {
    this.setData({ showEnglish: !this.data.showEnglish });
  },

  /** 卡片点击文字：切换中文显示（页面级状态，切句后保持） */
  onToggleChinese() {
    this.setData({ showChinese: !this.data.showChinese });
  },

  onTogglePlay() {
    this.playEngine?.pauseToggle();
  },

  onNextSentence() {
    this.playEngine?.next(false);
  },

  onPrevSentence() {
    this.playEngine?.prev();
  },

  onOrderChange(e: any) {
    const { order } = e.detail;
    // data.playOrder 存胶囊 key（与 storage / play-bar 属性同语义），引擎值只在传引擎时映射
    this.setData({ playOrder: order });
    this.playEngine?.updateConfig({ playOrder: ENGINE_ORDER_MAP[order] || order });
    this.savePlaybackSettings({ order: order.toUpperCase() });
  },

  onRepeatChange(e: any) {
    const { repeat } = e.detail;
    this.setData({ repeatCount: repeat });
    this.playEngine?.updateConfig({ repeatCount: repeat });
    this.savePlaybackSettings({ repeatCount: repeat });
  },

  /** 播放条数上限切换：同步引擎并持久化（下次进页保持） */
  onLimitChange(e: any) {
    const { limit } = e.detail;
    this.setData({ limitCount: limit });
    this.playEngine?.updateConfig({ limitCount: limit });
    this.savePlaybackSettings({ limitCount: limit });
  },

  /** 播放设置持久化：顺序 / 次数 / 条数统一写 storage，下次进页恢复 */
  savePlaybackSettings(patch: Record<string, any>) {
    try {
      const saved = (wx.getStorageSync('playback_settings') as any) || {};
      wx.setStorageSync('playback_settings', { ...saved, ...patch });
    } catch (err) {
      console.warn('[sentence-play] 播放设置持久化失败:', err);
    }
  },

  onUnload() {
    eventBus.off(AppEvent.REFRESH_SENTENCE_LIST, (this as any).listRefreshHandler);
    if ((this as any).advanceTimer) {
      clearTimeout((this as any).advanceTimer);
      (this as any).advanceTimer = null;
    }
    this.playEngine?.destroy();
    this.playEngine = null;
  }
});