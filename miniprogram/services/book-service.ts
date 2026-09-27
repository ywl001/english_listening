// 1. services/book-service.ts (纯粹的数据服务)

import { BookContent, BookType, cloudFunctionName } from "../enums/app-enums";
import { dbRequest} from "../utils/dbHelper";
import { callCloudFunction } from "../utils/cloud-client";
import appStore from "./app-store";
import eventBus from "./EventBus";
import { AppEvent } from "./event-type";

export class BookService {
  async getBooks() {
    const books = await callCloudFunction(cloudFunctionName.getBooks, {});
    return books
  }
  /**
   * 创建词书（用户自定义引用书）。
   * @param name 书名
   * @param type 书类型，默认引用书（ref），用于收藏句子
   */
  async createBook(name: string, type: string = BookType.ref): Promise<Book> {
    const bookName = name.trim()
    if (!bookName) throw new Error('词书名称不能为空')
    const db = wx.cloud.database()

    const { data } = await dbRequest(
      db.collection('book').where({ name: bookName, type }).limit(1).get(),
      '查询词书失败'
    )

    if (data.length) return data[0] as Book

    const now = Date.now()
    const res = await dbRequest(
      db.collection('book').add({
        data: {
          name: bookName,
          type,
          content: BookContent.sentence, // 必须带 content，否则不出现在 userBooks/refBooks 列表
          isCustom: true, // 用户自建书，允许滑动删除（我的句子/我的收藏等不带此字段）
          createdAt: now
        }
      }),
      '创建词书失败'
    )

    return { _id: res._id, name: bookName, type, content: BookContent.sentence, isCustom: true, createdAt: now } as Book
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

  /**
   * 删除用户词书（云端两阶段：confirm=false 仅统计影响范围，confirm=true 执行删除）
   * 返回 { needConfirm, sentenceCount, favoriteCount } 或 { deleted: true }
   */
  async deleteBook(
    bookId: string,
    confirm = false
  ): Promise<{ needConfirm?: boolean; sentenceCount?: number; favoriteCount?: number; deleted?: boolean } | null> {
    return callCloudFunction(cloudFunctionName.delUserBook, { bookId, confirm })
  }
}
const bookService = new BookService();
export default bookService;