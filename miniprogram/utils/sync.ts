import { cloudFunctionName, CollectionName } from '../enums/app-enums';
import appStore from '../services/app-store';
import { LocalShardStore } from './local-store';

export class Sync {
  // markStore = new LocalShardStore<SentenceMark>(CollectionName.sentenceMark);
  // favStore = new LocalShardStore<SentenceFavorite>(CollectionName.sentenceFavorite);

  constructor(){
    appStore.markStore.value = new LocalShardStore<SentenceMark>(CollectionName.sentenceMark);
    appStore.favStore.value = new LocalShardStore<SentenceFavorite>(CollectionName.sentenceFavorite);
  }
  async syncFromCloud(store: LocalShardStore<SentenceMark | SentenceFavorite>): Promise<number> {
    const meta = store.getMeta();
    // 游标回退 10 分钟做重叠窗口：容忍多端设备时钟偏差导致的漏拉
    // （merge 按 _id + updatedAt 去重，重复拉取无副作用）
    let cursor = Math.max(0, meta.cursor - 10 * 60 * 1000);
    let fetched = 0;
    let hasMore = true;

    while (hasMore) {
      const res = await wx.cloud.callFunction({
        name: cloudFunctionName.syncUserData,
        data: { cursor, collection: store.getCollection() },
      });

      const result = (res.result as { list: any[]; cursor: number; hasMore: boolean }) || { list: [], cursor, hasMore: false };

      console.log('云端数据：', result);

      if (result.list && result.list.length > 0) {
        fetched += store.merge(result.list);
      }

      cursor = typeof result.cursor === 'number' ? result.cursor : cursor;
      hasMore = !!result.hasMore;

      // 实时保存游标，避免中途断开重复拉取
      meta.cursor = cursor;
      store.saveMeta(meta);
    }

    return fetched;
  }

  // 进行中的 flush（同一 store 串行执行，防止并发快照互相覆盖丢任务）
  private flushing = new Map<LocalShardStore<SentenceMark | SentenceFavorite>, Promise<void>>();

  async flushQueue(store: LocalShardStore<SentenceMark | SentenceFavorite>): Promise<void> {
    const running = this.flushing.get(store);
    if (running) return running;

    const task = this.doFlush(store).finally(() => this.flushing.delete(store));
    this.flushing.set(store, task);
    return task;
  }

  private async doFlush(store: LocalShardStore<SentenceMark | SentenceFavorite>): Promise<void> {
    // 每轮重新读取 meta（await 期间可能有新任务入队），成功一条持久化一条，
    // 避免旧代码"循环结束才保存"导致并发调用时用过期快照清掉对方的任务
    while (true) {
      const meta = store.getMeta();
      const task = meta.pendingQueue[0];
      if (!task) return;

      try {
        const { _id, _openid, ...data } = task.data as any;
        await wx.cloud
          .database()
          .collection(store.getCollection())
          .doc(_id)
          .set({ data });

        meta.pendingQueue.shift(); // 成功才出队
        store.saveMeta(meta);
      } catch (e) {
        task.retry += 1;
        if (task.retry >= 5) {
          console.error('[sync] 任务重试超限，丢弃', task.data._id, e);
          meta.pendingQueue.shift();
          store.saveMeta(meta);
        } else {
          console.warn('[sync] 队列任务写入失败，停止本轮', e);
          store.saveMeta(meta);
          break;
        }
      }
    }
  }

  private syncState = {
    syncing: false,
    lastError: null as Error | null,
    pendingCount: 0,
  };

  async startSync(): Promise<void> {
    this.syncState.syncing = true;
    try {
      if(appStore.markStore.value && appStore.favStore.value){
        await this.flushQueue(appStore.markStore.value);
        await this.flushQueue(appStore.favStore.value);
        await this.syncFromCloud(appStore.markStore.value);
        await this.syncFromCloud(appStore.favStore.value);
      }
      this.syncState.lastError = null;
    } catch (err) {
      this.syncState.lastError = err as Error;
      console.error('[sync] 失败', err);
    } finally {
      this.syncState.syncing = false;
      this.syncState.pendingCount = appStore.markStore?.value?.getMeta().pendingQueue.length || 0;
    }
  }
}

export default new Sync();