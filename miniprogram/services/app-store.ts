import { signal, computed } from "@preact/signals-core";
import { BookContent, BookType } from "../enums/app-enums";
import { LocalShardStore } from "../utils/local-store";

import { AppEvent } from "./event-type";
import eventBus from "./EventBus";

export class AppStore {
  _openid = signal<string>('')
  
  books = signal<Book[]>([]);

  userBooks = computed(() => {
    const openid = getApp().globalData._openid;
    return this.books.value.filter(
      (item) => item._openid === openid && item.content === BookContent.sentence
    );
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

  currentBook = signal<Book | undefined>(undefined);

  currentFavoriteBook = signal<Book | undefined>(undefined);

  markStore = signal<LocalShardStore<SentenceMark> | undefined>(undefined)
  
  favStore = signal<LocalShardStore<SentenceFavorite> | undefined>(undefined)

  constructor() {
    console.log("app store contructor");
    eventBus.on(AppEvent.GET_BOOK_SUCCESS, (books: Book[]) => {
      console.log("get boos success");
      this.books.value = books;
    });
  }
  init() {}
}

const appStore = new AppStore();
export default appStore;
