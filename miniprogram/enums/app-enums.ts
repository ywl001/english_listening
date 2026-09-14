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
  index = "/pages/index/index"
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
