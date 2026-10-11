import { BookContent, Pages, LocalStorageKey } from '../../enums/app-enums';
import sentenceService from '../../services/sentence-service';
import articleService from '../../services/article-service';
import eventBus from '../../services/EventBus';
import { AppEvent } from '../../services/event-type';
import { initManagerAndNavigate } from '../../utils/util';
import { bindSignal } from '../../utils/signal-bind';
import appStore from '../../services/app-store';
import { computed } from '@preact/signals-core';
import bookService from '../../services/book-service';

Page({
  data: {
    // 一级切换：句子 / 文章（book.content 维度）
    activeContent: 'sentence' as 'sentence' | 'article',
    activeTab: 'system' as 'system' | 'user',
    systemBooks: [] as Book[],
    userBooks: [] as Book[],
    articleBooks: [] as Book[],
    showBookCreate: false,
    // 编辑模式：正在改名的书（null=新建模式）
    editingBook: null as Book | null
  },

  books:[] as Book[],
  disposeBooks:null as any,

  onLoad() {
    bindSignal(this, appStore.userBooks, 'userBooks')
    bindSignal(this, appStore.systemBooks, 'systemBooks')

    // 文章 tab 列表 = 虚拟收藏书（置顶）+ 系统文章书
    const articleList = computed<Book[]>(() => {
      const favBook: Book = {
        _id: 'virtual-fav-articles',
        name: '我收藏的文章',
        content: BookContent.article,
        isVirtualFav: true,
        count: appStore.articleFavoriteCount.value
      }
      return [favBook, ...appStore.articleBooks.value]
    })
    bindSignal(this, articleList, 'articleBooks')
  },

  onShow() {
    // 每次回到列表页都刷新书籍数据（含 count/learnedCount 统计）
    eventBus.emit(AppEvent.GET_BOOKS)
    // 刷新文章收藏数（虚拟书 count；从播放页取消/新增收藏返回后也会走这里）
    articleService.refreshFavoriteCount()
  },

  // 一级切换：句子 / 文章（book.content 维度），同步更新导航栏标题
  switchContent(e: any) {
    const content = e.currentTarget.dataset.content as 'sentence' | 'article';
    if (content === this.data.activeContent) return;
    this.setData({ activeContent: content });
    wx.setNavigationBarTitle({ title: content === 'article' ? '听文章' : '听句子' });
  },

  switchTab(e: any) {
    this.setData({ activeTab: e.currentTarget.dataset.tab });
  },

  openCreateBook() {
    this.setData({ showBookCreate: true, editingBook: null });
  },

  closeBookCreate() {
    this.setData({ showBookCreate: false, editingBook: null });
  },

  async onTapBook(e: any) {
    const book: Book = e.detail.book;
    console.log(book)

    // 虚拟收藏书：进入收藏文章列表（favorite 模式）
    if (book.isVirtualFav) {
      const url = `/pages/article-list/article-list?favorite=1&bookName=${encodeURIComponent(book.name)}`
      wx.navigateTo({ url })
      return
    }

    // 文章书：进入文章列表页
    if (book.content === BookContent.article) {
      const url = `/pages/article-list/article-list?bookId=${book._id}&bookName=${encodeURIComponent(book.name)}`
      wx.navigateTo({ url })
      return
    }

    let url: string
    // 用书自身的 type 数据判断（不再依赖 globalData.originBookId 的初始化时序，消除冷启动竞态）：
    // - type 'ref' = 引用书（我的收藏/自建收藏夹）→ 收藏列表
    // - 有 _openid 且非 ref = 我的录入（type 'origin'）→ 实体句子列表
    // - 无 _openid = 系统书 → 直接播放
    const bookName = encodeURIComponent(book.name)
    if (book._openid && book.type !== 'ref') {
      url = `${Pages.sentenceList}?bookId=${book._id}&bookName=${bookName}`
      initManagerAndNavigate(url, book, sentenceService.getPlayList)
    } else if (book.type === 'ref') {
      url = `${Pages.sentenceList}?bookId=${book._id}&bookName=${bookName}`
      console.log(book._id, book.name)
      initManagerAndNavigate(url, book, sentenceService.getFavoritePlayList)
    } else {
      url = `${Pages.sentencePlay}?bookId=${book._id}&bookName=${bookName}`
      initManagerAndNavigate(url, book, sentenceService.getPlayList)
    }
  },

  // 编辑（重命名）句子书：复用 book-create 弹窗，预填旧名
  onEditBook(e: any) {
    const { book } = e.detail;
    if (!book || !book._openid) return; // 系统书不可编辑
    this.setData({ showBookCreate: true, editingBook: book });
  },

  onDeleteBook(e: any) {
    const { book } = e.detail;
    // 两阶段删除：先查影响范围（controller 取数回传），弹窗确认后再发执行事件
    eventBus.emit(AppEvent.DELETE_BOOK, {
      bookId: book._id,
      confirm: false,
      callback: (check: any) => {
        let extra = ''
        if (check && check.needConfirm !== undefined) {
          const parts: string[] = [];
          if (check.sentenceCount > 0) parts.push(`${check.sentenceCount} 个句子`);
          if (check.favoriteCount > 0) parts.push(`${check.favoriteCount} 处收藏`);
          extra = parts.length ? `其中包含 ${parts.join('、')}，删除后将一并清除且无法恢复。` : ''
        }
        wx.showModal({
          title: '删除词书',
          content: `确定要删除《${book.name}》吗？${extra}`,
          confirmColor: '#ee0a24',
          success: (res) => {
            if (!res.confirm) return
            // 执行删除：controller 负责云端删除、本地缓存清理、列表刷新与提示
            eventBus.emit(AppEvent.DELETE_BOOK, { bookId: book._id, confirm: true })
          }
        })
      }
    })
  },

  // book-create 弹窗确认（新建 / 重命名共用入口）
  async onCreateBook(e: any) {
    const { name } = e.detail
    const editing = this.data.editingBook

    try {
      if (editing) {
        // 重命名：service 直调更新，成功后刷新书列表
        await bookService.renameBook(editing._id, name)
        // 改名的是默认收藏夹时同步 signal + storage，避免播放页/卡片显示旧名
        if (appStore.currentFavoriteBook.value?._id === editing._id) {
          const updated = { ...appStore.currentFavoriteBook.value, name: name.trim() }
          appStore.currentFavoriteBook.value = updated
          wx.setStorageSync(LocalStorageKey.CURRENT_FAVORITE_BOOK, updated)
        }
        eventBus.emit(AppEvent.GET_BOOKS)
        wx.showToast({ title: '修改成功', icon: 'success' })
      } else {
        // 新建句子书 = 引用书（ref）：service 直调创建，成功后刷新书列表（books 更新 -> computed 自动生效）
        await bookService.createBook(name)
        eventBus.emit(AppEvent.GET_BOOKS)
        wx.showToast({ title: '创建成功', icon: 'success' })
      }
    } catch (err) {
      console.error('[book-list] 保存词书失败:', err)
      wx.showToast({ title: err instanceof Error ? err.message : '操作失败', icon: 'none' })
    }
  }

});