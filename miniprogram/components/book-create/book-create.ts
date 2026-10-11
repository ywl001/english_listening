Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    },
    // 弹窗标题：新建句子书 / 重命名句子书
    title: {
      type: String,
      value: '新建句子书'
    },
    // 编辑模式预填的旧书名（新建模式传空）
    initialName: {
      type: String,
      value: ''
    }
  },

  data: {
    name: ''
  },

  observers: {
    // 弹窗每次打开时预填书名（新建=空，编辑=旧名）
    visible(v: boolean) {
      if (v) {
        this.setData({ name: this.data.initialName || '' })
      }
    }
  },

  methods: {
    onNameChange(e: WechatMiniprogram.CustomEvent) {
      this.setData({ name: e.detail })
    },

    onClose() {
      this.setData({ visible: false })
      this.triggerEvent('close')
    },

    onConfirm() {
      const name = this.data.name.trim()

      if (!name) {
        wx.showToast({ title: '请输入书名', icon: 'none' })
        return
      }

      this.triggerEvent('confirm', { name })
      this.setData({ visible: false, name: '' })
    }
  }
})
