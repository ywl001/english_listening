/// <reference path="./types/index.d.ts" />

interface IAppOption {
  globalData: {
    userInfo?: WechatMiniprogram.UserInfo,
    _openid?: string,
    playConfig?: PlayConfig
    favoriteBookId?: string;
    originBookId?: string
  }

  userInfoReadyCallback?: WechatMiniprogram.GetUserInfoSuccessCallback
  openidReady: Promise<void>

  getPlayConfig(): PlayConfig
  ensureUserBook(): void
  updatePlayConfig(config: Partial<PlayConfig>): void

  initOpenid(): void
}

type PlayMode = 'sequence' | 'test'

type SentenceListMode = 'smart' | 'fav' | 'reviewOnly';
type PlayOrder = 'zh_first' | 'en_first' | 'zh_only' | 'en_only'

type WordBoundary = { text: string; start: number; duration: number }

interface UserDefaultBooks {
  originBook: Book;
  favoriteBook: Book;
  originBookId: string;
  favoriteBookId: string;
}


interface Sentence {
  _id: string
  zh: string
  en: string
  bookId: string
  audio: string      // 英文音频的临时播放链接
  audio_zh: string    // 中文音频的临时播放链接
  createdAt: number

  // 下面附加属性表示句子的学习记录
  mark?: SentenceMark | null
  isNew?: boolean

  favorites?: string[]
  isFavorite?: boolean
}

interface SentenceMark {
  _id: string
  _openid?: string
  bookId: string
  sentenceId: string
  stage: number
  lastReviewedAt: number
  nextReviewAt: number
  // createdAt:number
  updatedAt: number
}

interface SentenceFavorite {
  _id: string
  _openid: string
  sentenceId: string
  bookId: string
  // createdAt: number
  updatedAt: number
  deleted: boolean
}

// 本地离线待推送队列接口定义
interface PendingAction {
  type: 'mark' | 'favorite_add' | 'favorite_remove';
  payload: any;
}

interface ToggleFavoriteResult {
  isFavorite: boolean;
  sentenceId: string;
  bookId: string;
}

interface PlayListCursor {
  reviewCursor: {
    lastNextReviewAt: number
    lastId: string
  } | null
  newSentenceCursor: {
    lastCreatedAt: number
    lastId: string
  } | null
}
interface PlayListResult {
  list: Sentence[]
  nextCursor: PlayListCursor
  hasMore: boolean
}

interface FavoriteSentenceResult {
  list: Sentence[];
  nextCursor: {
    lastCreatedAt: number;
    lastId: string;
  } | null;
  hasMore: boolean;
}

interface SentenceStats {
  total: number;     // 总句数
  unlearned: number; // 未学句数 (stage === 0)
  learning: number;  // 学习中/复习中 (stage 1 ~ 4)
  mastered: number;  // 已会/已精通 (stage === 5)
  dueCount: number;  // 当前到期需复习句数
  favorite: number;  // 收藏句数
}

interface SyncCloudResponse {
  success: boolean;
  marks?: SentenceMark[];
  favorites?: SentenceFavorite[];
  error?: any;
}


interface PlayConfig {
  playMode: PlayMode  //播放模式，顺序或继续上次
  repeatCount: number   // 每句英文重复几遍
  gapMs: number          // 每段音频之间的间隔(毫秒)
  playOrder: PlayOrder  //播放顺序-->先英后中或先中后英
  limitCount: number    // 0 表示不限
  startId?: string
  bookId?: string
  bookName?: string
}

interface Article {
  _id: string
  audioUrl: string
  bookId: string
  createAt: number
  order: number
  sentenceCount: number
  title: string
}
interface ArticleSentence {
  _id: string;
  articleId: string;
  bookId: string;
  en: string;
  order: number;
  startTime: number;
  zh: string;
}

interface PlayCallbacks {
  onCurrentChange: (sentence: Sentence | null, index: number) => void
  onStatusChange: (status: string) => void
  onPlayingChange: (playing: boolean) => void
  onFinished: (message: string) => void      // 整个会话结束时的提示("全部播完"/"达到设定条数")
  onNotice: (message: string) => void        // 一次性的轻提示,比如"已经是第一句了"
  // 播放列表快见底/取完时,引擎会调用这个方法要更多句子
  // 宿主页面负责调 service 拿数据,返回空数组表示确实没有更多了
}


interface MarksSummary {
  favoriteIds: Set<string>          // 收藏的句子 id
  stageMap: Map<string, number>     // 句子 id -> 当前 stage(只包含 stage>=1 的,即"学习过"的句子)
  nextReviewAtMap: Map<string, number>  // 句子 id -> 下次复习时间戳(只包含 stage>=1 的)
}



interface Book {
  _id: string;
  name: string;
  content?: string;
  _openid?: string;
  itemCount?: number
  isCustom?: boolean
}

interface ApiResponse<T = any> {
  code: number;     // 0 代表成功，非 0 代表失败
  data: T;   // 成功时的数据 Payload
  msg: string;  // 错误提示或成功描述
}

interface GetMarksParams {
  articleId?: string;
  sentenceId?: string;
}

interface GetSentencesParams {
  articleId?: string;
  bookId?: string;
}

interface TtsResult {
  fileID: string
  url: string
  wordBoundaries: WordBoundary[]
}

interface QueryResult<T> {
  data: T[]
}

interface ApiSuccess<T> {
  code: 0
  data: T
  message: string
}

interface ApiFail {
  code: number
  data: null
  message: string
}

type ApiResult<T> = ApiSuccess<T> | ApiFail

interface MarkIndex {
  bookIds: string[];
  total: number;
}
interface PendingTask<T> {
  op: string
  data: T;
  retry: number;
  ts: number;
}

interface SyncMeta<T> {
  cursor: number;
  pendingQueue: PendingTask<T>[];
}

interface SentenceCache {
  list: Sentence[]
  cursor: number
  completed: boolean
  updatedAt: number
}

interface SentenceCache {
  list: Sentence[]
  cursor: number
  completed: boolean
  updatedAt: number
}

// interface LocalStoreOptions<T> {
//   prefix: string;              // 分片 key 前缀：'marks' / 'favs'
//   metaKey: string;             // 游标+队列的存储 key
//   keyOf: (item: T) => string;  // 分片内唯一标识
//   timeOf: (item: T) => number; // 新旧比较依据（旧的不会覆盖新的）
//   bookIdOf: (item: T) => string;
// }