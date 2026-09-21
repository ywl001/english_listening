
import sentenceService from "./sentence-service";
import sentencePlayManager from "./sentence-play-manager";
import { AppEvent, FavoritePayload, MarkPayload } from "./event-type";
import eventBus from "./EventBus";

// 艾宾浩斯间隔算法
function calculateNextReviewAt(currentStage: number): number {
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

export function initSentenceEventListeners() {
  // 1. 监听收藏事件
  eventBus.on(AppEvent.FAVORITE_SENTENCE, async (payload: FavoritePayload) => {
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
  });

  // 2. 监听掌握/标记事件
  eventBus.on(AppEvent.MARK_SENTENCE, async (payload: MarkPayload) => {
    try {
      const nextStage = payload.currentStage < 8 ? payload.currentStage + 1 : 8;
      const nextReviewAt = calculateNextReviewAt(payload.currentStage);

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
  });
}