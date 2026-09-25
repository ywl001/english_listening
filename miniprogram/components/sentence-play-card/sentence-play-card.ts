import appStore from "../../services/app-store";
import { bindSignal } from "../../utils/signal-bind";

Component({
  properties: {
    sentence: {
      type: Object,
      value: {}
    },
    hideZh: {
      type: Boolean,
      value: false
    },
    isFavorite: {
      type: Boolean,
      value: false
    },
    isLearned: {
      type: Boolean,
      value: false
    },
    stage: {
      type: Number,
      value: 0
    },

  },


  data: {
    enShow: false,
    currentFavoriteBook: null,
    _disposeCurrentBook: null as any

  },

  lifetimes: {
    attached() {
      this.data._disposeCurrentBook = bindSignal(this, appStore.currentFavoriteBook,
        'currentFavoriteBook')
    },

    detached() {
      this.data._disposeCurrentBook?.()
    }
  },

  methods: {
    onTapFavorite() {
      this.triggerEvent('toggleFavorite', { sentence: this.properties.sentence });
    },
    onTapMastered() {
      this.triggerEvent('toggleMastered', { sentence: this.properties.sentence });
    },

    onTapEn() {
      this.setData({ enShow: !this.data.enShow })
    }
  }
});