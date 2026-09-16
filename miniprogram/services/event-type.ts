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
}

export interface EventPayloadMap {
  [AppEvent.MARK_SENTENCE]:any,
  [AppEvent.FAVORITE_SENTENCE]:any,
}