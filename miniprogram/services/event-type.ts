export interface FavoritePayload {
  sentenceId: string;
  /**
   * 句集（引用书）维度的目标状态：
   * - true = 确保加入该句集（已存在则幂等）
   * - false = 确保从该句集移除
   * - 不传 = 由存储现状决定方向（toggle）——推荐的纯意图用法，单一事实源由 service 判定
   * 三种取法都只作用于 refBookId 这一个句集，不影响其他句集。
   */
  isFavorite?: boolean;
  bookId: string;
  /** 目标句集（引用书）id；不传则默认当前收藏夹 */
  refBookId?: string;
}

export interface MarkPayload {
  sentenceId: string;
  currentStage: number;
  bookId: string;
  /** 目标阶段：忘记=0、熟悉=8；不传则按 currentStage+1 递增（已会按钮） */
  targetStage?: number;
  /**
   * 阶段已到顶（8）后再点已会/熟悉：stage 不变，把 nextReviewAt 顺延 15 天
   * 由 sentence-play.onSetStage 检测 currentStage===8 && 目标 stage===8 时置 true
   */
  extendReview?: boolean;
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
  NEED_MORE_SENTENCES = "needMoreSentences",

  GET_BOOKS = "getBook",

  DELETE_BOOK = "deleteBook",
  CREATE_SENTENCE = "createSentence",
  DELETE_SENTENCE = "deleteSentence",
  REMOVE_FAVORITE = "removeFavoriteFromBook",
  REBUILD_PLAYLIST = "rebuildPlaylist",
}

export interface EventPayloadMap {
  [AppEvent.MARK_SENTENCE]: any;
  [AppEvent.FAVORITE_SENTENCE]: FavoritePayload;
  [AppEvent.GET_BOOKS]: void;
  [AppEvent.NEED_MORE_SENTENCES]: NeedMorePayload;

  [AppEvent.DELETE_BOOK]: DeleteBookPayload;
  [AppEvent.CREATE_SENTENCE]: CreateSentencePayload;
  [AppEvent.DELETE_SENTENCE]: DeleteSentencePayload;
  [AppEvent.REMOVE_FAVORITE]: RemoveFavoritePayload;
  [AppEvent.REBUILD_PLAYLIST]: RebuildPlaylistPayload;
}
