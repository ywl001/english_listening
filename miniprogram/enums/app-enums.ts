export enum LocalStorageKey {
  // progress_sequence = 'progress',
  CURRENT_FAVORITE_BOOK = 'currentFavoriteBook',
  // progress_test = 'progress_test'

  PREMIX_MARK = 'mark',
  META_MARK = 'mark_meta',
  PREMIX_FAV = 'fav',
  META_FAV = 'fav_meta'
}

export enum BookContent {
  sentence = 'sentence',
  article = 'article'
}

export enum BookType {
  original = 'original',
  ref = 'ref'
}

export enum Pages {
  bookList = '/pages/book-list/book-list',
  index = "/pages/index/index",
  sentencePlay = '/pages/sentence-play/sentence-play',
  testPage = '/pages/test-page/test-page',
  sentenceList = '/pages/sentence-list/sentence-list',
  sentenceInput = '/pages/sentence-input/sentence-input',
  articleList = '/pages/article-list/article-list',
  articlePlay = '/pages/article-play/article-play'
}

export enum cloudFunctionName {
  edgeTts = 'edgeTts',
  getOpenId = 'getOpenId',
  translate = 'translate',
  getBooks = 'getBooks',
  getBookSentence = 'getBookSentence',
  getArticles = 'getArticles',
  getArticleSentences = 'getArticleSentences',
  syncArticle = 'syncArticle',
  createBook = 'createBook',
  searchSentences = 'searchSentences',
  addSentenceToBook = 'addSentenceToBook',
  ensureUserBook = 'ensureUserBook',
  createSentence = 'createSentence',
  getSentencePlayList = 'getSentencePlayList',
  getFavoriteSentences = 'getFavoriteSentences',
  syncUserData= 'syncUserData',
  syncSentence= 'syncSentence',
  deleteSentence = 'deleteSentence',
  delUserBook = 'delUserBook',
  findSentence = 'findSentence',
  toggleArticleFavorite = 'toggleArticleFavorite'
}

export enum CollectionName{
  book = 'book',
  sentence = 'sentence',
  sentenceMark = 'sentenceMark',
  sentenceFavorite = 'sentenceFavorite',
  article = 'article',
  articleSentence = 'articleSentence',
  articleFavorite = 'articleFavorite'
}