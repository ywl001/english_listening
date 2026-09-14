Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    },
    settings: {
      type: Object,
      value: { order: 'EN_ZH', count: 10, repeatCount: 2, interval: 2 }
    }
  },

  methods: {
    onClose() {
      this.triggerEvent('close');
    },

    onSelect(e: WechatMiniprogram.TouchEvent) {
      const { key, value } = e.currentTarget.dataset;
      this.setData({
        [`settings.${key}`]: value
      });
    },

    onSave() {
      this.triggerEvent('save', this.data.settings);
    }
  }
});