// export enum LocalStorageKey {
//   progress_sequence = 'progress',
//   Progress_favorite = 'favorite',
//   progress_test = 'progress_test'
// }

export enum BookType {
  sentence = 'sentence',
  article = 'article'
}

export enum Pages {
  sentenceBookList = '/pages/sentence-book-list/sentence-book-list',
  index = "/pages/index/index",
  sentencePlay = '/pages/sentence-play/sentence-play',
  testPage = '/pages/test-page/test-page',
  favoriteSentenceList = '/pages/favorite-sentence-list/favorite-sentence-list'
}

export enum cloudFunctionName {
  edgeTts = 'edgeTts',
  getOpenId = 'getOpenId',
  translate = 'translate',
  upsertMark = 'upsertMark',
  getBooks = 'getBooks',
  getBookSentence = 'getBookSentence',
  getArticles = 'getArticles',
  getArticleSentences = 'getArticleSentences',
  createBook = 'createBook',
  searchSentences = 'searchSentences',
  addSentenceToBook = 'addSentenceToBook',
  ensureUserBook = 'ensureUserBook',
  createSentence = 'createSentence',
  getSentencePlayList = 'getSentencePlayList',
  getFavoriteSentences = 'getFavoriteSentences'
}

export enum CollectionName{
  book = 'book',
  sentence = 'sentence',
  sentenceMark = 'sentenceMark',
  sentenceFavorite = 'sentenceFavorite',
  article = 'article',
  articleSentence = 'articleSentence'
}