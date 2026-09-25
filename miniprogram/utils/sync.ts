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
    let cursor = meta.cursor;
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

  async flushQueue(store: LocalShardStore<SentenceMark | SentenceFavorite>): Promise<void> {
    const meta = store.getMeta();

    while (meta.pendingQueue.length > 0) {
      const task = meta.pendingQueue[0];
      try {
        const { _id, _openid, ...data } = task.data as any;
        await wx.cloud
          .database()
          .collection(store.getCollection())
          .doc(_id)
          .set({ data });

        meta.pendingQueue.shift(); // 成功才出队
      } catch (e) {
        task.retry += 1;
        if (task.retry >= 5) {
          console.error('[sync] 任务重试超限，丢弃', task.data._id, e);
          meta.pendingQueue.shift();
        } else {
          console.warn('[sync] 队列任务写入失败，停止本轮', e);
          break;
        }
      }
    }

    store.saveMeta(meta);
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