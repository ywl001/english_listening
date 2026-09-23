console.log('AppStore.ts loaded')

import { AppEvent } from "./event-type"
import eventBus from "./EventBus"

export class AppStore {
  constructor(){
    console.log('app store contructor')
  }
  init(){}
  private _books: Book[]=[]

  get books() {
    return this._books
  }

  set books(value: Book[]) {
    if (value && value != this._books){
      this._books = value
      eventBus.emit(AppEvent.GET_BOOK_SUCCESS,value)
    }
  }
}

const appStore = new AppStore()
export default appStore