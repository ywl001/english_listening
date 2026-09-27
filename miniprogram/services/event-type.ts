export interface FavoritePayload {
  sentenceId: string;
  isFavorite: boolean;
  bookId: string;
  refBookId?: string;
}

export interface MarkPayload {
  sentenceId: string;
  currentStage: number;
  bookId: string;
  /** 目标阶段：忘记=0、熟悉=8；不传则按 currentStage+1 递增（已会按钮） */
  targetStage?: number;
}
export interface NeedMorePayload {
  bookId: string;
}

/** 事件应答回调：result 为成功结果，err 为失败原因（失败时 callCloudFunction 已 toast） */
export type EventCallback<T = any> = (result: T, err?: any) => void;

export interface CreateBookPayload {
  name: string;
  callback?: EventCallback;
}

export interface DeleteBookPayload {
  bookId: string;
  confirm: boolean;
  callback?: EventCallback<{ needConfirm?: boolean; sentenceCount?: number; favoriteCount?: number; deleted?: boolean }>;
}

export interface DeleteSentencePayload {
  sentenceId: string;
  bookId: string; // 句子所属实体书，用于删除后清理本地文件缓存
  confirm: boolean;
  callback?: EventCallback<{ needConfirm?: boolean; favoriteCount?: number; deleted?: boolean }>;
}

export interface CreateSentencePayload {
  bookId: string;
  zh: string;
  en: string;
  audioFileID: string;   // 临时英文音频 fileID（controller 负责搬运到永久目录）
  audioZhFileID: string; // 临时中文音频 fileID
  callback?: EventCallback<Sentence>;
}

export interface AddSentenceToBookPayload {
  sentenceId: string;
  bookId: string;
  callback?: EventCallback;
}

export interface FindSentencePayload {
  en: string;
  callback?: EventCallback<Sentence | null>;
}

export interface RemoveFavoritePayload {
  sentenceId: string;
  refBookId: string;
}

export interface RebuildPlaylistPayload {
  bookId: string;
  callback?: EventCallback;
}

export enum AppEvent {
  MARK_SENTENCE = "markSentence",
  FAVORITE_SENTENCE = "favoriteSentence",
  REFRESH_SENTENCE_LIST = "refreshSentenceList",
  GET_PLAYLIST = "getPlaylist",
  GET_PLAYLIST_SUCCESS = "getPlaylistSuccess",
  NEED_MORE_SENTENCES = "needMoreSentences",

  GET_BOOKS = "getBook",
  GET_BOOK_SUCCESS = "getBookSuccess",

  CREATE_BOOK = "createBook",
  DELETE_BOOK = "deleteBook",
  CREATE_SENTENCE = "createSentence",
  DELETE_SENTENCE = "deleteSentence",
  ADD_SENTENCE_TO_BOOK = "addSentenceToBook",
  FIND_SENTENCE = "findSentence",
  REMOVE_FAVORITE = "removeFavoriteFromBook",
  REBUILD_PLAYLIST = "rebuildPlaylist",
}

export interface EventPayloadMap {
  [AppEvent.MARK_SENTENCE]: any;
  [AppEvent.FAVORITE_SENTENCE]: FavoritePayload;
  [AppEvent.REFRESH_SENTENCE_LIST]: void;
  [AppEvent.GET_BOOK_SUCCESS]: Book[];
  [AppEvent.GET_BOOKS]: void;
  [AppEvent.GET_PLAYLIST]: string;
  [AppEvent.GET_PLAYLIST_SUCCESS]: Sentence[];
  [AppEvent.NEED_MORE_SENTENCES]: NeedMorePayload;

  [AppEvent.CREATE_BOOK]: CreateBookPayload;
  [AppEvent.DELETE_BOOK]: DeleteBookPayload;
  [AppEvent.CREATE_SENTENCE]: CreateSentencePayload;
  [AppEvent.DELETE_SENTENCE]: DeleteSentencePayload;
  [AppEvent.ADD_SENTENCE_TO_BOOK]: AddSentenceToBookPayload;
  [AppEvent.FIND_SENTENCE]: FindSentencePayload;
  [AppEvent.REMOVE_FAVORITE]: RemoveFavoritePayload;
  [AppEvent.REBUILD_PLAYLIST]: RebuildPlaylistPayload;
}
