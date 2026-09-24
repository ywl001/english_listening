import appStore from "./app-store";
import bookService from "./book-service";
import { AppEvent, FavoritePayload, MarkPayload } from "./event-type";
import eventBus from "./EventBus";
import sentencePlayList from "./sentence-play-list";
import sentencePlayManager from "./sentence-play-manager";
import sentenceService from "./sentence-service";

export class AppController {

  private cursor?: SentencePlayCursor

  init() {
    eventBus.on(AppEvent.GET_BOOK, e => this.onGetBooks())
    eventBus.on(AppEvent.FAVORITE_SENTENCE, e => this.favoriteSentence(e))
    eventBus.on(AppEvent.MARK_SENTENCE, e => this.markSentence(e))
    eventBus.on(AppEvent.GET_PLAYLIST, e => this.onGetPlaylist(e))
    eventBus.on(AppEvent.SET_CURRENT_BOOK,e=>{
      appStore.currentBook = e
    })
  }

  async onGetBooks(): Promise<void> {
    bookService.getBooks()
  }

  private favoriteSentence(payload: FavoritePayload) {
    try {
      console.log('listener payload:', payload)
      const app = getApp<IAppOption>();
      const favoriteBookId = app?.globalData?.favoriteBookId as string;

      sentenceService.toggleFavorite(payload.sentenceId, favoriteBookId, payload.isFavorite);
      // 同步回管理器队列
      sentencePlayManager.updateSentence(payload.sentenceId, { isFavorite: payload.isFavorite });
      if (sentencePlayManager.bookId === favoriteBookId && payload.isFavorite === false) {
        console.log('收藏列表删除数据了')
        sentencePlayManager.removeSentence(payload.sentenceId)
        eventBus.emit(AppEvent.REFRESH_SENTENCE_LIST)
      }
    } catch (err) {
      console.error('[EventListener] 切换收藏失败，尝试回滚状态:', err);
      // 失败时回滚
      sentencePlayManager.updateSentence(payload.sentenceId, { isFavorite: !payload.isFavorite });
      wx.showToast({ title: '收藏同步失败', icon: 'none' });
    }
  }

  private async markSentence(payload: MarkPayload) {
    try {
      const nextStage = payload.currentStage < 8 ? payload.currentStage + 1 : 8;
      const nextReviewAt = this.calculateNextReviewAt(payload.currentStage);

      const updatedMark = {
        stage: nextStage,
        nextReviewAt: nextReviewAt,
        updatedAt: Date.now()
      };

      // 更新管理器队列中的 mark 对象
      sentencePlayManager.updateSentence(payload.sentenceId, { mark: updatedMark as any });

      // 发起后台 API 保存
      await sentenceService.upsertMark(
        payload.sentenceId,
        { stage: nextStage, nextReviewAt },
        sentencePlayManager.bookId
      );
    } catch (err) {
      console.error('[EventListener] 标记更新失败:', err);
      wx.showToast({ title: '掌握进度保存失败', icon: 'none' });
    }
  }

  private async onGetPlaylist(bookId:string) {
    console.log('发送了事件 get play list')
    const res = await sentencePlayList.getPlayList(bookId, 20, this.cursor)
    this.cursor = res.cursor
    console.log('appController res',res)
    eventBus.emit(AppEvent.GET_PLAYLIST_SUCCESS, res.list)
  }

  // 艾宾浩斯间隔算法
  private calculateNextReviewAt(currentStage: number): number {
    const nextStage = currentStage + 1;
    const intervalsInMinutes: Record<number, number> = {
      1: 5,           // 5 分钟
      2: 30,          // 30 分钟
      3: 12 * 60,     // 12 小时
      4: 24 * 60,     // 1 天
      5: 2 * 24 * 60, // 2 天
      6: 4 * 24 * 60, // 4 天
      7: 7 * 24 * 60, // 7 天
      8: 15 * 24 * 60,// 15 天
    };

    const minutes = intervalsInMinutes[nextStage] || 30 * 24 * 60;
    return Date.now() + minutes * 60 * 1000;
  }

}

const appController = new AppController()
export default appController