console.log('AppStore.ts loaded')

import { AppEvent } from "./event-type"
import eventBus from "./EventBus"

export class AppStore {
  constructor(){
    console.log('app store contructor')
  }
  init(){}
  private _books: Book[]=[]
  private _currentBook?:Book

  get books() {
    return this._books
  }

  set books(value: Book[]) {
    if (value && value != this._books){
      this._books = value
      eventBus.emit(AppEvent.GET_BOOK_SUCCESS,value)
    }
  }

  get currentBook(){
    return this._currentBook as Book
  }

  set currentBook(value:Book){
    this._currentBook = value
  }
}

const appStore = new AppStore()
export default appStore