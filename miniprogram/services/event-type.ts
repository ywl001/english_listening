export interface FavoritePayload {
  sentenceId: string;
  isFavorite: boolean;
  bookId: string;
}

export interface MarkPayload {
  sentenceId: string;
  currentStage: number;
  bookId?: string;
}
export enum AppEvent {
  MARK_SENTENCE = "markSentence",
  FAVORITE_SENTENCE = "favoriteSentence",
  REFRESH_SENTENCE_LIST = "refreshSentenceList",
  GET_PLAYLIST = "getPlaylist",
  GET_PLAYLIST_SUCCESS = "getPlaylistSuccess",

  GET_BOOKS = "getBook",
  GET_BOOK_SUCCESS = "getBookSuccess",
}

export interface EventPayloadMap {
  [AppEvent.MARK_SENTENCE]: any;
  [AppEvent.FAVORITE_SENTENCE]: FavoritePayload;
  [AppEvent.REFRESH_SENTENCE_LIST]: void;
  [AppEvent.GET_BOOK_SUCCESS]: Book[];
  [AppEvent.GET_BOOKS]: void;
  [AppEvent.GET_PLAYLIST]: string;
  [AppEvent.GET_PLAYLIST_SUCCESS]: Sentence[];
}
