export interface FavoritePayload {
  sentenceId: string;
  isFavorite: boolean;
  bookId?: string;
}

export interface MarkPayload {
  sentenceId: string;
  currentStage: number;
  bookId?: string;
}
export enum AppEvent {
  MARK_SENTENCE = 'markSentence',
  FAVORITE_SENTENCE = 'favoriteSentence',
  REFRESH_SENTENCE_LIST = 'refreshSentenceList',
  GET_BOOK = 'getBook',
  GET_BOOK_SUCCESS = 'getBookSuccess',
  GET_PLAYLIST = 'getPlaylist',
  GET_PLAYLIST_SUCCESS = 'getPlaylistSuccess',
  SET_CURRENT_BOOK = 'setCurrentBook'
}

export interface EventPayloadMap {
  [AppEvent.MARK_SENTENCE]:any,
  [AppEvent.FAVORITE_SENTENCE]:FavoritePayload,
  [AppEvent.REFRESH_SENTENCE_LIST]:void,
  [AppEvent.GET_BOOK_SUCCESS]:Book[],
  [AppEvent.GET_BOOK]:void,
  [AppEvent.GET_PLAYLIST]:string,
  [AppEvent.GET_PLAYLIST_SUCCESS]:Sentence[],
  [AppEvent.SET_CURRENT_BOOK]:Book,
}
