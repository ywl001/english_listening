// player-controls.ts
const PLAY_ORDERS = [
  { key: "zh_en", label: "中 → 英" },
  { key: "en_zh", label: "英 → 中" },
  { key: "en_only", label: "仅英文" },
];

const REPEAT_COUNTS = [
  { key: 1, label: "1次" },
  { key: 2, label: "2次" },
  { key: 3, label: "3次" },
  { key: 0, label: "∞ 无限" },
];

const LIMIT_COUNTS = [
  { key: 10, label: "10条" },
  { key: 20, label: "20条" },
  { key: 50, label: "50条" },
  { key: 0, label: "不限" },
];

Component({
  properties: {
    // 仅作为初始值传入，后续内部自己维护
    initialOrder: {
      type: String,
      value: "zh_en",
    },
    initialRepeat: {
      type: Number,
      value: 1,
    },
    // 播放条数上限（0 = 不限）
    initialLimit: {
      type: Number,
      value: 0,
    },
    // 播放状态
    isPlaying: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    orderIndex: 0,
    repeatIndex: 0,
    limitIndex: 3,
    orderText: "中 → 英",
    repeatText: "1次",
    limitText: "不限",
    isPlaying: false,
  },

  lifetimes: {
    attached() {
      // 组件加载时，根据初始值匹配索引
      const orderIdx = PLAY_ORDERS.findIndex(
        (item) => item.key === this.data.initialOrder
      );
      const repeatIdx = REPEAT_COUNTS.findIndex(
        (item) => item.key === this.data.initialRepeat
      );
      const limitIdx = LIMIT_COUNTS.findIndex(
        (item) => item.key === this.data.initialLimit
      );

      const validOrderIdx = orderIdx !== -1 ? orderIdx : 0;
      const validRepeatIdx = repeatIdx !== -1 ? repeatIdx : 0;
      const validLimitIdx = limitIdx !== -1 ? limitIdx : 3;

      this.setData({
        orderIndex: validOrderIdx,
        repeatIndex: validRepeatIdx,
        limitIndex: validLimitIdx,
        orderText: PLAY_ORDERS[validOrderIdx].label,
        repeatText: REPEAT_COUNTS[validRepeatIdx].label,
        limitText: LIMIT_COUNTS[validLimitIdx].label,
      });
    },
  },

  methods: {
    // 点击切换顺序：子组件自己直接 setData，立刻变文字
    onToggleOrder() {
      const nextIndex = (this.data.orderIndex + 1) % PLAY_ORDERS.length;
      const nextItem = PLAY_ORDERS[nextIndex];

      // 1. 立即更新子组件视图
      this.setData({
        orderIndex: nextIndex,
        orderText: nextItem.label,
      });

      // 2. 通知父页面最新的 key 值，供音频播放逻辑使用
      this.triggerEvent("orderChange", { order: nextItem.key });
    },

    // 点击切换次数：子组件自己直接 setData，立刻变文字
    onToggleRepeat() {
      const nextIndex = (this.data.repeatIndex + 1) % REPEAT_COUNTS.length;
      const nextItem = REPEAT_COUNTS[nextIndex];

      // 1. 立即更新子组件视图
      this.setData({
        repeatIndex: nextIndex,
        repeatText: nextItem.label,
      });

      // 2. 通知父页面最新的 key 值
      this.triggerEvent("repeatChange", { repeat: nextItem.key });
    },

    // 点击切换播放条数上限
    onToggleLimit() {
      const nextIndex = (this.data.limitIndex + 1) % LIMIT_COUNTS.length;
      const nextItem = LIMIT_COUNTS[nextIndex];

      this.setData({
        limitIndex: nextIndex,
        limitText: nextItem.label,
      });

      this.triggerEvent("limitChange", { limit: nextItem.key });
    },

    // 播放/暂停
    onTogglePlay() {
      this.triggerEvent("togglePlay", { isPlaying: !this.data.isPlaying });
    },

    // 上一句
    onPrev() {
      this.triggerEvent("prev");
    },

    // 下一句
    onNext() {
      this.triggerEvent("next");
    },
  },
});
