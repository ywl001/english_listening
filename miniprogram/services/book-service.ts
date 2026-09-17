// 1. services/book-service.ts (纯粹的数据服务)

import { BookType, cloudFunctionName } from "../enums/app-enums";
import { dbRequest, db } from "../utils/dbHelper";
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
    return books.filter(item => item.content === BookType.sentence);
  }

  async getArticleBooks() {
    const books = await this.getBooks()
    return books.filter(item => item.content === BookType.article);
  }

  async getUserBooks() {
    const books = await this.getBooks()
    const _openid = getApp().globalData._openid
    return books.filter(item => item._openid === _openid);
  }

  /**
   * 创建词书。
   */
  async createBook(name: string, type: string): Promise<Book> {
    const bookName = name.trim()
    if (!bookName) throw new Error('词书名称不能为空')

    const { data } = await dbRequest(
      db.collection('book').where({ name: bookName, type }).limit(1).get(),
      '查询词书失败'
    )

    if (data.length) return data[0] as Book

    const now = Date.now()
    const res = await dbRequest(
      db.collection('book').add({
        data: { name: bookName, type, createdAt: now }
      }),
      '创建词书失败'
    )

    return { _id: res._id, name: bookName, type, createdAt: now } as Book
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