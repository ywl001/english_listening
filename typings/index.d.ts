/// <reference path="./types/index.d.ts" />

interface IAppOption {
  globalData: {
    userInfo?: WechatMiniprogram.UserInfo,
    _openid?: string,
    playConfig?: PlayConfig
    favoriteBookId?: string;
    originBookId?: string
  }
  userInfoReadyCallback?: WechatMiniprogram.GetUserInfoSuccessCallback,

  getPlayConfig(): PlayConfig
  ensureUserBook(): void
  updatePlayConfig(config: Partial<PlayConfig>): void
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

  isFavorite?: boolean
}

interface SentenceMark {
  _id?: string
  _openid?: string
  bookId?: string
  sentenceId: string
  // favorite: boolean
  stage?: number
  lastReviewedAt?: number
  nextReviewAt?: number
}

interface SentenceFavorite {
  _id: string
  _openid: string
  bookId: string
  createdAt: number
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
  type?: string;
  _openid?: string;
  itemCount?: number
}

interface ApiResponse<T = any> {
  code: number;     // 0 代表成功，非 0 代表失败
  data: T | null;   // 成功时的数据 Payload
  message: string;  // 错误提示或成功描述
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