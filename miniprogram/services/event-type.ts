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
  REFRESH_SENTENCE_LIST = 'refreshSentenceList'
}

export interface EventPayloadMap {
  [AppEvent.MARK_SENTENCE]:any,
  [AppEvent.FAVORITE_SENTENCE]:FavoritePayload,
  [AppEvent.REFRESH_SENTENCE_LIST]:void,
}