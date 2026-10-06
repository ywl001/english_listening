import appStore from "../../services/app-store";
import sentenceService from "../../services/sentence-service";
import { AppEvent } from "../../services/event-type";
import eventBus from "../../services/EventBus";

type SearchResult = Sentence & { bookName?: string };

const DEBOUNCE_MS = 400;
const ANIM_MS = 300;

Component({
  properties: {
    show: {
      type: Boolean,
      value: false
    },
    // 目标句集（引用书）：搜索结果将加入这本书；不传则默认当前收藏夹
    bookId: {
      type: String,
      value: ''
    },
    // 目标句集名称（用于提示文案），不传则取当前收藏夹名
    bookName: {
      type: String,
      value: ''
    },
    // 内联模式：嵌入页面列表区渲染结果（无遮罩/面板/动画/自身输入框），keyword 由外部传入
    inline: {
      type: Boolean,
      value: false
    },
    // 搜索关键词（内联模式下由页面传入，变化时自动防抖搜索）
    keyword: {
      type: String,
      value: ''
    }
  },

  data: {
    animShow: false,   // 滑入/滑出动画开关
    rendering: false,  // 节点是否渲染（动画结束后移除）
    results: [] as SearchResult[],
    searching: false,
    searched: false,
    targetBookName: '收藏'
  },

  observers: {
    show(v: boolean) {
      if (this.properties.inline) return;
      if (v) {
        // 先渲染节点，下一帧再触发滑入动画
        this.setData({ rendering: true });
        setTimeout(() => this.setData({ animShow: true }), 30);
      } else {
        // 先执行滑出动画，动画结束后移除节点
        this.setData({ animShow: false });
        this.clearHideTimer();
        (this as any).hideTimer = setTimeout(() => {
          this.setData({ rendering: false });
        }, ANIM_MS);
      }
    },

    // 目标书名：面板/内联两种模式统一在此计算
    'bookName'() {
      this.setData({
        targetBookName: this.properties.bookName
          || appStore.currentFavoriteBook.value?.name
          || '收藏'
      });
    },

    // 内联模式：keyword 由页面传入，变化时防抖搜索（与面板模式 onInput 行为一致）
    keyword(v: string) {
      if (!this.properties.inline) return;
      this.clearSearchTimer();
      const kw = (v || '').trim();
      if (!kw) {
        this.setData({ results: [], searched: false, searching: false });
        return;
      }
      this.setData({ searching: true });
      (this as any).searchTimer = setTimeout(() => this.doSearch(), DEBOUNCE_MS);
    }
  },

  lifetimes: {
    detached() {
      this.clearHideTimer();
      this.clearSearchTimer();
    }
  },

  methods: {
    clearHideTimer() {
      if ((this as any).hideTimer) {
        clearTimeout((this as any).hideTimer);
        (this as any).hideTimer = null;
      }
    },

    clearSearchTimer() {
      if ((this as any).searchTimer) {
        clearTimeout((this as any).searchTimer);
        (this as any).searchTimer = null;
      }
    },

    noop() { },

    /* ---------------- 关闭 ---------------- */

    onClose() {
      this.triggerEvent('close');
    },

    onMaskTap() {
      this.triggerEvent('close');
    },

    /* ---------------- 搜索 ---------------- */

    onInput(e: WechatMiniprogram.CustomEvent) {
      const keyword = e.detail.value || '';
      this.setData({ keyword });
      this.clearSearchTimer();
      const kw = keyword.trim();
      if (!kw) {
        this.setData({ results: [], searched: false, searching: false });
        return;
      }
      this.setData({ searching: true });
      (this as any).searchTimer = setTimeout(() => this.doSearch(), DEBOUNCE_MS);
    },

    // 键盘"搜索"键：跳过防抖立即查询
    onConfirmSearch() {
      this.clearSearchTimer();
      this.doSearch();
    },

    onClear() {
      this.clearSearchTimer();
      this.setData({ keyword: '', results: [], searched: false, searching: false });
    },

    async doSearch() {
      const keyword = this.data.keyword.trim();
      if (!keyword) {
        this.setData({ results: [], searched: false, searching: false });
        return;
      }
      this.setData({ searching: true });
      try {
        const res = await sentenceService.searchSentences(keyword);
        // 标记是否已在目标句集（按 refBookId 精确匹配，而非全局收藏过——句子可能收藏在其他夹子）
        const targetBookId = this.properties.bookId;
        const favIds = new Set(
          (appStore.favStore.value?.getAll() || [])
            .filter((x: any) => !x.deleted && (!targetBookId || x.refBookId === targetBookId))
            .map((x: any) => x.sentenceId)
        );
        const results = ((res || []) as SearchResult[]).map(s => ({
          ...s,
          isFavorite: favIds.has(s._id)
        }));
        // 防抖期间关键词已变：丢弃过期结果
        if (keyword !== this.data.keyword.trim()) return;
        this.setData({ results, searched: true, searching: false });
      } catch (err) {
        console.error('[sentence-search] 搜索失败:', err);
        if (keyword !== this.data.keyword.trim()) return;
        this.setData({ searching: false, searched: true, results: [] });
      }
    },

    /* ---------------- 加入目标句集 ---------------- */

    onAdd(e: WechatMiniprogram.CustomEvent) {
      const sentence = e.currentTarget.dataset.sentence as SearchResult;
      // isFavorite = 已在目标句集中（多夹子收藏不影响），重复点击无效
      if (!sentence || sentence.isFavorite) return;

      // 走统一的收藏事件：controller 负责写库 + 队列同步
      // refBookId = 目标句集（未传时 controller 默认当前收藏夹）
      eventBus.emit(AppEvent.FAVORITE_SENTENCE, {
        sentenceId: sentence._id,
        isFavorite: true,
        bookId: sentence.bookId,
        refBookId: this.properties.bookId || undefined
      });

      const results = this.data.results.map(r =>
        r._id === sentence._id ? { ...r, isFavorite: true } : r
      );
      this.setData({ results });

      wx.showToast({
        title: `已加入 ${this.data.targetBookName}`,
        icon: 'none',
        duration: 1200
      });

      // 保持结果列表展开（方案 A）：加入不触发关闭，用户通过 ✕清空 / 图标切回过滤 主动收起，
      // 可连续加入多条；结果保留在组件内，重展开时关键词未变则不重新搜索
    }
  }
});
