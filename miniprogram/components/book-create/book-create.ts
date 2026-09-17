Component({
  properties:{
    visible:{
      type:Boolean,
      value:false
    },
    name:{
      type:String,
      value:''
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