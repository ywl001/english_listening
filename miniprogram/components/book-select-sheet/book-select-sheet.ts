export interface BookItem {
  id: string | number;
  name: string;
  cover?: string;
  isSelected?: boolean;
}

Component({
  properties: {
    // 控制弹窗显示隐藏
    show: {
      type: Boolean,
      value: false,
    },
    // 书籍/句集列表
    bookList: {
      type: Array,
      value: [],
    },
    // 是否默认勾选“自动收藏至上次”
    autoSave: {
      type: Boolean,
      value: false,
    }
  },

  methods: {
    // 关闭弹窗
    onClose() {
      this.triggerEvent('close');
    },

    // 点击选择/取消选择某本书籍
    onSelectBook(event: WechatMiniprogram.CustomEvent) {
      const { id } = event.currentTarget.dataset;
      this.triggerEvent('select', { bookId: id });
    },

    // 点击新建句集
    onCreateNewBook() {
      this.triggerEvent('create');
    },

    // 切换自动收藏勾选框
    onAutoSaveChange(event: WechatMiniprogram.CustomEvent) {
      this.triggerEvent('autoSaveChange', { value: event.detail });
    },

    // 点击底部文案也可切换勾选
    toggleAutoSave() {
      this.triggerEvent('autoSaveChange', { value: !this.data.autoSave });
    }
  }
});