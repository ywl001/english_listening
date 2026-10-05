import appStore from "./app-store";
import bookService from "./book-service";
import { BookType, LocalStorageKey } from "../enums/app-enums";
import { AppEvent, AddSentenceToBookPayload, CreateBookPayload, CreateSentencePayload, DeleteBookPayload, DeleteSentencePayload, FavoritePayload, FindSentencePayload, MarkPayload, NeedMorePayload, RebuildPlaylistPayload, RemoveFavoritePayload } from "./event-type";
import eventBus from "./EventBus";
import sentencePlayList from "./sentence-play-list";
import sentencePlayManager from "./sentence-play-manager";
import sentenceService from "./sentence-service";
import { TtsService } from "./tts-service";
import sentenceFileStore from "../utils/sentence-file-store";

export class AppController {
  private cursor?: SentencePlayCursor;
  // 引用书（收藏夹）播放分页游标：bookId -> updatedAt 游标
  private favCursor = new Map<string, number | undefined>();

  init() {
    eventBus.on(AppEvent.GET_BOOKS, (e) => this.onGetBooks());
    eventBus.on(AppEvent.FAVORITE_SENTENCE, (e) => this.favoriteSentence(e));
    eventBus.on(AppEvent.MARK_SENTENCE, (e) => this.markSentence(e));
    eventBus.on(AppEvent.GET_PLAYLIST, (e) => this.onGetPlaylist(e));
    // 播放队列见底，Manager 发事件通知加载数据
    eventBus.on(AppEvent.NEED_MORE_SENTENCES, (e) => this.onNeedMore(e));

    // ---- 数据写操作：UI 发意图事件，这里统一处理 ----
    eventBus.on(AppEvent.CREATE_BOOK, (e) => this.onCreateBook(e));
    eventBus.on(AppEvent.DELETE_BOOK, (e) => this.onDeleteBook(e));
    eventBus.on(AppEvent.CREATE_SENTENCE, (e) => this.onCreateSentence(e));
    eventBus.on(AppEvent.DELETE_SENTENCE, (e) => this.onDeleteSentence(e));
    eventBus.on(AppEvent.ADD_SENTENCE_TO_BOOK, (e) => this.onAddSentenceToBook(e));
    eventBus.on(AppEvent.FIND_SENTENCE, (e) => this.onFindSentence(e));
    eventBus.on(AppEvent.REMOVE_FAVORITE, (e) => this.onRemoveFavorite(e));
    eventBus.on(AppEvent.REBUILD_PLAYLIST, (e) => this.onRebuildPlaylist(e));
  }

  async onGetBooks(): Promise<void> {
    try {
      const books = await bookService.getBooks();
      appStore.books.value = books;
      this.validateCurrentFavoriteBook(books);
    } catch (err) {
      // 真机网络抖动等场景：不打断流程，下次 onShow 触发时自动重试
      console.error('[AppController] 拉取书籍列表失败:', err);
    }
  }

  /**
   * 校验默认收藏夹是否仍存活（storage 恢复的引用可能已随书删除成为悬空引用）：
   * 失效时回退到默认"我的收藏"（fav_<openid>），再不行取用户第一本引用书。
   * currentFavoriteBook 尚未从 storage 恢复时跳过（冷启动竞态，避免覆盖用户偏好）。
   */
  private validateCurrentFavoriteBook(books: Book[]): void {
    const cur = appStore.currentFavoriteBook.value;
    if (!cur) return;
    if (books.some(b => b._id === cur._id)) return;

    const openid = appStore._openid.value;
    const fallback = books.find(b => b._id === `fav_${openid}`)
      || books.find(b => b.type === 'ref' && b._openid === openid);

    if (fallback) {
      console.warn('[AppController] 默认收藏夹已失效，回退到:', fallback.name);
      appStore.currentFavoriteBook.value = fallback;
      wx.setStorageSync(LocalStorageKey.CURRENT_FAVORITE_BOOK, fallback);
    } else {
      console.warn('[AppController] 默认收藏夹已失效且无可用回退，清空');
      appStore.currentFavoriteBook.value = undefined;
      wx.removeStorageSync(LocalStorageKey.CURRENT_FAVORITE_BOOK);
    }
  }

  /**
   * 新建引用书（用于收藏句子），成功后刷新书列表
   */
  private async onCreateBook(payload: CreateBookPayload): Promise<void> {
    try {
      await bookService.createBook(payload.name, BookType.ref)
      // userBooks 由 bindSignal 绑定 computed，通过刷新 books 数据源更新
      eventBus.emit(AppEvent.GET_BOOKS)
      wx.showToast({ title: '创建成功', icon: 'success' })
      payload.callback?.(null)
    } catch (err) {
      console.error('[AppController] 创建词书失败:', err)
      payload.callback?.(null, err)
    }
  }

  /**
   * 删除词书（两阶段）：
   * confirm=false 只取统计（callback 回传给 UI 弹窗）；
   * confirm=true 执行删除后清理本地缓存并刷新书列表
   */
  private async onDeleteBook(payload: DeleteBookPayload): Promise<void> {
    try {
      const result = await bookService.deleteBook(payload.bookId, payload.confirm)

      if (payload.confirm && result?.deleted) {
        // 本地缓存清理：收藏/mark 分片 + 句子文件
        appStore.onBookDeleted(payload.bookId)
        sentenceFileStore.removeBook(payload.bookId)
        if (sentencePlayManager.bookId === payload.bookId) {
          sentencePlayManager.reset()
        }
        // 刷新书列表（books 更新 -> userBooks/systemBooks computed 自动生效）
        eventBus.emit(AppEvent.GET_BOOKS)
        wx.showToast({ title: '已删除', icon: 'success' })
      }
      payload.callback?.(result as any)
    } catch (err) {
      console.error('[AppController] 删除词书失败:', err)
      payload.callback?.(null as any, err)
    }
  }

  /**
   * 创建句子：临时音频搬运到永久目录 + 落库，成功后 callback 回传新句子
   */
  private async onCreateSentence(payload: CreateSentencePayload): Promise<void> {
    try {
      const timestamp = Date.now()
      const [audio, audio_zh] = await Promise.all([
        TtsService.moveToPermanent(payload.audioFileID, `english/en/${timestamp}.mp3`),
        TtsService.moveToPermanent(payload.audioZhFileID, `english/zh/${timestamp}.mp3`)
      ])

      const sentence = await sentenceService.createSentence({
        bookId: payload.bookId,
        zh: payload.zh,
        en: payload.en,
        audio,
        audio_zh
      })

      // 新句子写入本地文件缓存（sentence.bookId 为 origin 书）
      sentenceFileStore.upsertSentence(sentence)

      wx.showToast({ title: '保存成功', icon: 'success' })
      payload.callback?.(sentence)
    } catch (err) {
      console.error('[AppController] 保存句子失败:', err)
      payload.callback?.(null as any, err)
    }
  }

  /**
   * 删除句子（两阶段）：
   * confirm=false 只取收藏统计（callback 回传给 UI 弹窗）；
   * confirm=true 云端删除后同步移除播放队列中的句子并刷新列表
   */
  private async onDeleteSentence(payload: DeleteSentencePayload): Promise<void> {
    try {
      const result = await sentenceService.deleteSentence(payload.sentenceId, payload.confirm)

      if (payload.confirm && result?.deleted) {
        // 同步清理本地文件缓存
        sentenceFileStore.removeSentence(payload.bookId, payload.sentenceId)
        sentencePlayManager.removeSentence(payload.sentenceId)
        eventBus.emit(AppEvent.REFRESH_SENTENCE_LIST)
        wx.showToast({ title: '已删除', icon: 'success' })
      }
      payload.callback?.(result as any)
    } catch (err) {
      console.error('[AppController] 删除句子失败:', err)
      payload.callback?.(null as any, err)
    }
  }

  /**
   * 把已有句子加入引用书（写收藏记录）
   */
  private async onAddSentenceToBook(payload: AddSentenceToBookPayload): Promise<void> {
    try {
      await bookService.addSentenceToBook(payload.sentenceId, payload.bookId)
      wx.showToast({ title: '已添加到词书', icon: 'success' })
      payload.callback?.(null)
    } catch (err) {
      console.error('[AppController] 加入词书失败:', err)
      payload.callback?.(null, err)
    }
  }

  /**
   * 按英文原文查重（忽略大小写），命中回传已有句子，未命中回传 null
   */
  private async onFindSentence(payload: FindSentencePayload): Promise<void> {
    try {
      const sentence = await sentenceService.findSentence(payload.en)
      payload.callback?.(sentence)
    } catch (err) {
      console.error('[AppController] 查重失败:', err)
      payload.callback?.(null, err)
    }
  }

  /**
   * 从指定引用书移除收藏（列表滑动删除）：本地标记 + 推上云 + 队列移除 + 列表刷新
   */
  private onRemoveFavorite(payload: RemoveFavoritePayload): void {
    try {
      sentenceService.removeFavoriteFromBook(payload.sentenceId, payload.refBookId)
      sentencePlayManager.removeSentence(payload.sentenceId)
      eventBus.emit(AppEvent.REFRESH_SENTENCE_LIST)
      wx.showToast({ title: '已取消收藏', icon: 'none' })
    } catch (err) {
      console.error('[AppController] 取消收藏失败:', err)
      wx.showToast({ title: '取消收藏失败', icon: 'none' })
    }
  }

  /**
   * 重建播放队列（从播放页返回列表页时触发）：
   * 新会话 → 重新拉取第一页 → 重置 Manager → 通知各页面刷新。
   * 点过"已会"的句子已进复习队列（到期才会出现），不会出现在新列表里。
   */
  private async onRebuildPlaylist(payload: RebuildPlaylistPayload): Promise<void> {
    const { bookId } = payload
    const book = appStore.books.value.find(b => b._id === bookId)
    if (!book) {
      payload.callback?.(null, new Error('词书不存在'))
      return
    }

    try {
      wx.showLoading({ title: '刷新列表...', mask: true })

      // 新会话：清已服务名单 + 收藏夹分页游标
      sentencePlayList.startNewSession(bookId)
      this.favCursor.delete(bookId)

      // 实体书：增量对账（一次轻量查询，追上云端新增/删除的句子）
      if (book.type !== 'ref') {
        await sentenceFileStore.ensureReady(bookId)
      }

      const result = book.type === 'ref'
        ? await sentencePlayList.getFavoritePlayList(bookId, 20)
        : await sentencePlayList.getPlayList(bookId, 20)

      sentencePlayManager.init(book, result as any)

      eventBus.emit(AppEvent.REFRESH_SENTENCE_LIST)
      payload.callback?.(result)
    } catch (err) {
      console.error('[AppController] 重建播放队列失败:', err)
      payload.callback?.(null, err)
    } finally {
      wx.hideLoading()
    }
  }

  private favoriteSentence(payload: FavoritePayload) {
    try {
      // 夹子维度的切换：返回操作后该句子仍被收藏的夹子列表（多夹子共存）
      const remainingRefs = sentenceService.toggleFavorite(
        payload.sentenceId,
        payload.bookId,
        payload.isFavorite,
        payload.refBookId
      );
      // 同步回管理器队列：星标 = 是否仍被任一夹子收藏
      sentencePlayManager.updateSentence(payload.sentenceId, {
        isFavorite: remainingRefs.length > 0,
        favorites: remainingRefs,
      });
      // 正在播放的收藏夹中移除了该句子 -> 从队列移除并刷新列表（其他夹子的收藏不受影响）
      if (
        payload.refBookId &&
        sentencePlayManager.bookId === payload.refBookId &&
        !remainingRefs.includes(payload.refBookId)
      ) {
        console.log("收藏列表移除该句子");
        sentencePlayManager.removeSentence(payload.sentenceId);
        eventBus.emit(AppEvent.REFRESH_SENTENCE_LIST);
      }
    } catch (err) {
      console.error("[EventListener] 切换收藏失败，尝试回滚状态:", err);
      // 失败时回滚：以本地存储实际状态为准（favorites 一并还原，避免 UI 残留半套状态）
      const remainingRefs = (appStore.favStore.value?.getAll() || [])
        .filter((x: SentenceFavorite) => x.sentenceId === payload.sentenceId && !x.deleted && x.refBookId)
        .map((x: SentenceFavorite) => x.refBookId);
      sentencePlayManager.updateSentence(payload.sentenceId, {
        isFavorite: remainingRefs.length > 0,
        favorites: remainingRefs,
      });
      wx.showToast({ title: "收藏同步失败", icon: "none" });
    }
  }

  private async markSentence(payload: MarkPayload) {
    try {
      // 目标阶段：忘记=0、熟悉=8 直接设置；普通"已会"按当前 stage 递增
      const nextStage = payload.targetStage !== undefined
        ? payload.targetStage
        : (payload.currentStage < 8 ? payload.currentStage + 1 : 8);
      const nextReviewAt = this.calculateNextReviewAt(nextStage);

      const updatedMark = {
        stage: nextStage,
        nextReviewAt: nextReviewAt,
        updatedAt: Date.now(),
      };

      // 更新管理器队列中的 mark 对象
      sentencePlayManager.updateSentence(payload.sentenceId, {
        mark: updatedMark as any,
      });

      sentenceService.upsertMark(
        payload.sentenceId,
        { stage: nextStage, nextReviewAt },
        payload.bookId
      );
    } catch (err) {
      console.error("[EventListener] 标记更新失败:", err);
      wx.showToast({ title: "掌握进度保存失败", icon: "none" });
    }
  }

  private async onGetPlaylist(bookId: string) {
    console.log("发送了事件 get play list");
    const res = await sentencePlayList.getPlayList(bookId, 20, this.cursor);
    this.cursor = res.cursor;
    console.log("appController res", res);
    eventBus.emit(AppEvent.GET_PLAYLIST_SUCCESS, res.list);
  }

  /**
   * 播放队列见底：分页加载更多句子追加进队列
   * 实体书走 getPlayList（复习优先 + 水位线），引用书（收藏夹）走 getFavoritePlayList
   */
  private async onNeedMore(payload: NeedMorePayload): Promise<void> {
    const { bookId } = payload;
    // 只处理当前正在播放的书
    if (sentencePlayManager.bookId !== bookId) return;

    try {
      const book = appStore.books.value.find(b => b._id === bookId);
      let list: Sentence[] = [];
      let hasMore = false;

      if (book?.type === 'ref') {
        // 引用书：按收藏记录的 updatedAt 游标分页
        const favRes = await sentencePlayList.getFavoritePlayList(bookId, 20, this.favCursor.get(bookId));
        this.favCursor.set(bookId, favRes.cursor ?? undefined);
        list = favRes.list;
        hasMore = false; // getFavoritePlayList 不返回 hasMore，以 cursor 是否为 null 判断
      } else {
        // 实体书：会话游标由 SentencePlayList 内部维护，直接续页
        const res = await sentencePlayList.getPlayList(bookId, 20);
        list = res.list;
        hasMore = !!res.hasMore;
      }

      if (list && list.length > 0) {
        sentencePlayManager.append(list, hasMore);
        eventBus.emit(AppEvent.REFRESH_SENTENCE_LIST);
      } else {
        sentencePlayManager.setNoMore();
      }
    } catch (err) {
      console.error('[AppController] 加载更多句子失败:', err);
      // 失败时重置等待标志（追加空列表），下次 next() 会重新触发事件，实现自动重试
      sentencePlayManager.append([]);
    }
  }

  // 艾宾浩斯间隔算法：按目标 stage 取复习间隔
  // stage 0（忘记）= 立即到期，马上重新进入复习队列
  private calculateNextReviewAt(stage: number): number {
    if (stage <= 0) return Date.now();
    const intervalsInMinutes: Record<number, number> = {
      1: 5, // 5 分钟
      2: 30, // 30 分钟
      3: 12 * 60, // 12 小时
      4: 24 * 60, // 1 天
      5: 2 * 24 * 60, // 2 天
      6: 4 * 24 * 60, // 4 天
      7: 7 * 24 * 60, // 7 天
      8: 15 * 24 * 60, // 15 天
    };

    const minutes = intervalsInMinutes[stage] || 30 * 24 * 60;
    return Date.now() + minutes * 60 * 1000;
  }
}

const appController = new AppController();
export default appController;
