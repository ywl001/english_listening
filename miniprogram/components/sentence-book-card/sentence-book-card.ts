Component({
  properties: {
    book: {
      type: Object,
      value: {}
    },
    index: {
      type: Number,
      value: 0
    },
    isUserBook: {
      type: Boolean,
      value: false
    }
  },

  data: {
    progressPercent: 0,
    coverTheme: 'blue'
  },

  observers: {
    'book, index': function (book, index) {
      if (!book) return;
      
      // 1. 计算进度百分比
      const learned = book.learnedCount || 0;
      const total = book.count || 1; // 防止除以 0
      const percent = Math.min(Math.round((learned / total) * 100), 100);

      // 2. 根据 index 循环分配颜色主题
      const themes = ['blue', 'green', 'orange'];
      const theme = themes[index % themes.length];

      this.setData({
        progressPercent: percent,
        coverTheme: theme
      });
    }
  },

  methods: {
    onTap() {
      this.triggerEvent('tapcard', { book: this.data.book });
    },

    onEdit() {
      this.triggerEvent('edit', { book: this.data.book });
    },

    onDelete() {
      this.triggerEvent('delete', { book: this.data.book });
    }
  }
});