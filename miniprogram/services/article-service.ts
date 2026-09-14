import { cloudFunctionName } from "../enums/app-enums";
import { callCloudFunction } from "./cloud-client";

/**
 * 获取文章/课文列表
 */
export async function getArticles(bookId: string): Promise<Article[]> {
  return callCloudFunction<Article[]>(cloudFunctionName.getArticles, { bookId })
}

export async function getArticleSentences(articleId: string): Promise<ArticleSentence[]> {
  return callCloudFunction<ArticleSentence[]>(cloudFunctionName.getArticleSentences, { articleId })
}