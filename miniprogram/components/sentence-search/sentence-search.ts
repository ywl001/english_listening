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
    }
  },

  data: {
    animShow: false,   // 滑入/滑出动画开关
    rendering: false,  // 节点是否渲染（动画结束后移除）
    keyword: '',
    results: [] as SearchResult[],
    searching: false,
    searched: false,
    favoriteBookName: '收藏'
  },

  observers: {
    show(v: boolean) {
      if (v) {
        // 先渲染节点，下一帧再触发滑入动画
        this.setData({ rendering: true });
        setTimeout(() => this.setData({ animShow: true }), 30);
        this.setData({ favoriteBookName: appStore.currentFavoriteBook.value?.name || '收藏' });
      } else {
        // 先执行滑出动画，动画结束后移除节点
        this.setData({ animShow: false });
        this.clearHideTimer();
        (this as any).hideTimer = setTimeout(() => {
          this.setData({ rendering: false });
        }, ANIM_MS);
      }
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
        // 标记本地已收藏（含跨夹子）
        const favIds = new Set(
          (appStore.favStore.value?.getAll() || [])
            .filter((x: any) => !x.deleted)
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

    /* ---------------- 添加到收藏夹 ---------------- */

    onAdd(e: WechatMiniprogram.CustomEvent) {
      const sentence = e.currentTarget.dataset.sentence as SearchResult;
      if (!sentence || sentence.isFavorite) return;

      // 走统一的收藏事件：controller 负责写库 + 队列同步
      eventBus.emit(AppEvent.FAVORITE_SENTENCE, {
        sentenceId: sentence._id,
        isFavorite: true,
        bookId: sentence.bookId
      });

      const results = this.data.results.map(r =>
        r._id === sentence._id ? { ...r, isFavorite: true } : r
      );
      this.setData({ results });

      wx.showToast({
        title: `已收藏到 ${this.data.favoriteBookName}`,
        icon: 'none',
        duration: 1200
      });

      // 添加完成后自动收起（延迟一下让用户看到反馈）
      this.clearHideTimer();
      (this as any).hideTimer = setTimeout(() => {
        this.triggerEvent('close');
      }, 800);
    }
  }
});
