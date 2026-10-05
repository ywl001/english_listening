
Component({
  properties: {
    sentence: {
      type: Object,
      value: {},
    },
    favoriteBookName: {
      type: String,
      value: "收藏",
    },
    bookNames: {
      type: Object,
      value: {},
    },
    // 显示/隐藏状态由页面统一管理（切句后保持），卡片只负责触发事件
    showEnglish: {
      type: Boolean,
      value: true,
    },
    showChinese: {
      type: Boolean,
      value: true,
    },
  },

  data: {
    favLabel: "收藏",
  },

  observers: {
    "sentence, favoriteBookName, bookNames": function (
      sentence: Sentence,
      favoriteBookName: string,
      bookNames: Record<string, string>
    ) {
      // 已收藏：显示句子实际所在的夹子名；未收藏：显示默认收藏夹名（收藏将进入该夹子）
      const favIds = sentence?.favorites || [];
      let label = favoriteBookName;
      if (favIds.length) {
        const names = favIds.map((id) => bookNames[id]).filter(Boolean);
        if (names.length) label = names.join("、");
      }
      if (label !== this.data.favLabel) {
        this.setData({ favLabel: label });
      }
    },
  },

  methods: {
    onTapFavorite() {
      this.triggerEvent("toggleFavorite", {
        sentence: this.properties.sentence,
      });
    },

    onLongtapFavorite() {
      this.triggerEvent("longtapFavorite", {
        sentence: this.properties.sentence,
      });
    },

    // 统一标记入口：已会=stage+1 / 忘记=0 / 熟悉=8（wxml 通过 data-stage 传入）
    onActionTap(e: WechatMiniprogram.TouchEvent) {
      const stage = e.currentTarget.dataset.stage as number;
      this.triggerEvent("setStage", {
        sentence: this.properties.sentence,
        stage,
      });
    },
    toggleEnglish() {
      this.triggerEvent("toggleEnglish");
    },

    toggleChinese() {
      this.triggerEvent("toggleChinese");
    },
  },
});
