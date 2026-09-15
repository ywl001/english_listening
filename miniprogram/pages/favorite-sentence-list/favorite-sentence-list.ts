import sentenceService from "../../services/sentence-service";


const audioCtx = wx.createInnerAudioContext();

Page({
  data: {
    sentenceList: [] as Sentence[],
    displayList: [] as Sentence[],
    keyword: '',
    page: 1,
    pageSize: 20,
    hasMore: true,
    loading: false,
    bookId: '',
    
    // 全部播放控制状态
    isPlayingAll: false,
    currentIndex: -1
  },

  onLoad(options: { bookId?: string }) {
    const bookId = options.bookId || '';
    this.setData({ bookId }, () => {
      this.loadSentences(true);
    });

    // 监听音频自然播放结束，自动跳下一首
    audioCtx.onEnded(() => {
      if (this.data.isPlayingAll) {
        this.playNextSentence();
      }
    });
  },

  onUnload() {
    audioCtx.stop();
  },

  async loadSentences(isRefresh = false) {
    if (this.data.loading) return;
    this.setData({ loading: true });

    try {
      const res = await sentenceService.getFavoriteSentences(
        this.data.bookId,
        isRefresh ? 1 : this.data.page,
        this.data.pageSize
      );

      const list = isRefresh ? res.list : [...this.data.sentenceList, ...res.list];
      this.setData({
        sentenceList: list,
        displayList: this.filterList(list, this.data.keyword),
        page: (isRefresh ? 1 : this.data.page) + 1,
        hasMore: res.list.length === this.data.pageSize,
        loading: false
      });
      // wx.hideLoading();
    } catch (err) {
      this.setData({ loading: false });
      // wx.hideLoading();
    }
  },

  // 取消收藏：直接调用句子的 toggleFavorite 方法
  onDelete(e: WechatMiniprogram.CustomEvent) {
    const { id, index } = e.currentTarget.dataset;
    const sentenceId = id;
    const bookId = this.data.bookId;

    wx.showModal({
      title: '提示',
      content: '确定要取消收藏该句子吗？',
      confirmColor: '#ee0a24',
      success: async (res) => {
        if (res.confirm) {
          try {
            // 调用服务端/数据库解绑接口
            const result = await sentenceService.toggleFavorite(sentenceId, bookId);
            
            if (!result.isFavorite) {
              const newList = [...this.data.sentenceList];
              newList.splice(index, 1);
              
              this.setData({
                sentenceList: newList,
                displayList: this.filterList(newList, this.data.keyword)
              });
              
              wx.showToast({ title: '已取消收藏', icon: 'success' });
            }
          } catch (err) {
            console.error(err);
          }
        }
      }
    });
  },

  // 本地搜索过滤
  onSearchInput(e: WechatMiniprogram.Input) {
    const keyword = e.detail.value;
    this.setData({
      keyword,
      displayList: this.filterList(this.data.sentenceList, keyword)
    });
  },

  filterList(list: Sentence[], kw: string) {
    if (!kw.trim()) return list;
    return list.filter(item => 
      (item.en && item.en.toLowerCase().includes(kw.toLowerCase())) ||
      (item.zh && item.zh.includes(kw))
    );
  },

  // 点击单句播放
  playSingleAudio(e: WechatMiniprogram.CustomEvent) {
    const index = e.currentTarget.dataset.index;
    this.setData({ isPlayingAll: false, currentIndex: index });
    this.playCurrentIndexAudio(index);
  },

  // 触发全部播放/暂停
  togglePlayAll() {
    if (this.data.isPlayingAll) {
      audioCtx.pause();
      this.setData({ isPlayingAll: false });
    } else {
      this.setData({ isPlayingAll: true });
      const startIndex = this.data.currentIndex >= 0 ? this.data.currentIndex : 0;
      this.playCurrentIndexAudio(startIndex);
    }
  },

  // 播放指定索引位置的句子音频
  playCurrentIndexAudio(index: number) {
    const target = this.data.displayList[index];
    if (!target || !target.audio) {
      if (this.data.isPlayingAll) this.playNextSentence();
      return;
    }

    this.setData({ currentIndex: index });
    audioCtx.stop();
    audioCtx.src = target.audio;
    audioCtx.play();
  },

  // 顺序播放下一句
  playNextSentence() {
    const nextIndex = this.data.currentIndex + 1;
    if (nextIndex < this.data.displayList.length) {
      this.playCurrentIndexAudio(nextIndex);
    } else {
      // 循环播放结束
      this.setData({ isPlayingAll: false, currentIndex: -1 });
      wx.showToast({ title: '已播放完毕', icon: 'none' });
    }
  }
});