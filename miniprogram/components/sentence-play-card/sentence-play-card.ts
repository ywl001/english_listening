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
    isMastered: {
      type: Boolean,
      value: false
    }
  },

  methods: {
    onTapFavorite() {
      this.triggerEvent('toggleFavorite', { sentence: this.properties.sentence });
    },
    onTapMastered() {
      this.triggerEvent('toggleMastered', { sentence: this.properties.sentence });
    }
  }
});