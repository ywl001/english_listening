import { signal, computed } from "@preact/signals-core";
import { BookContent, BookType } from "../enums/app-enums";
import { LocalShardStore } from "../utils/local-store";

export class AppStore {
  _openid = signal<string>('')
  
  books = signal<Book[]>([]);

  userBooks = computed(() => {
    // 必须读响应式信号 this._openid（initOpenid 写入），不能用 globalData._openid：
    // globalData 不是依赖，openid 晚于 books 到达时 computed 不会重算（冷启动竞态）
    const openid = this._openid.value;
    return openid
      ? this.books.value.filter(
          (item) => item._openid === openid && item.content === BookContent.sentence
        )
      : [];
  });

  systemBooks = computed(() =>
    this.books.value.filter(
      (item) => item.content === BookContent.sentence && !item._openid
    )
  );

  refBooks = computed(() =>
    this.books.value.filter(
      (item) => item.content === BookContent.sentence && item.type === "ref"
    )
  );

  // 文章书（content === 'article'）：无 _openid 为系统文章书
  articleBooks = computed(() =>
    this.books.value.filter(
      (item) => item.content === BookContent.article && !item._openid
    )
  );

  currentBook = signal<Book | undefined>(undefined);

  currentFavoriteBook = signal<Book | undefined>(undefined);

  // 文章收藏数（虚拟书"我收藏的文章"的 count 数据源）
  articleFavoriteCount = signal(0);

  markStore = signal<LocalShardStore<SentenceMark> | undefined>(undefined)
  
  favStore = signal<LocalShardStore<SentenceFavorite> | undefined>(undefined)

  init() {}

  /**
   * 词书被删除后的本地缓存清理（由 AppController 调用）
   */
  onBookDeleted(bookId: string) {
    this.favStore.value?.removeBook(bookId)
    this.markStore.value?.removeBook(bookId)
  }
}

const appStore = new AppStore();
export default appStore;
