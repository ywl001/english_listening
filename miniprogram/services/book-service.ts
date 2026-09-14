// 1. services/book-service.ts (纯粹的数据服务)

import { BookType, cloudFunctionName } from "../enums/app-enums";
import { callCloudFunction } from "./cloud-client";

export class BookService {
  private booksCache: Book[] | null = null;

  async getBooks(): Promise<Book[]> {
    if (this.booksCache === null) {
      this.booksCache = await callCloudFunction(cloudFunctionName.getBooks, {});
      console.log(this.booksCache)
    }
    return this.booksCache || [];
  }

  async getSentenceBooks() {
    const books = await this.getBooks()
    return books.filter(item => item.type === BookType.sentence);
  }

  async getArticleBooks() {
    const books = await this.getBooks()
    return books.filter(item => item.type === BookType.article);
  }

  async getUserBooks() {
    const books = await this.getBooks()
    const openid = getApp().globalData.openid
    return books.filter(item => item.openid === openid);
  }

  /**
   * 创建词书。
   */
  async createBook(name: string, type: string): Promise<Book> {
    const book = await callCloudFunction(cloudFunctionName.createBook, { name, type })
    if (!this.booksCache?.some(item => item._id === book._id)) {
      this.booksCache?.push(book)
    }
    return book;
  }

  /**
   * 把一个已存在的句子加入某本词书（不复制内容，只建立引用关系）。
   * 用于"搜索句子 -> 点收藏 -> 选词书"这个场景。
   */
  async addSentenceToBook(
    sentenceId: string,
    bookId: string
  ): Promise<{ refId: string; alreadyIn?: boolean }> {
    return callCloudFunction(cloudFunctionName.addSentenceToBook, { sentenceId, bookId })
  }
}
const bookService = new BookService();
export default bookService;