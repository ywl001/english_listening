import { cloudFunctionName } from "../enums/app-enums"
import { callCloudFunction } from "../utils/cloud-client"

export class TranslateService {
  static async translate(text: string): Promise<{
    zh: string
    en: string
  }> {
    const res = await callCloudFunction(
      cloudFunctionName.translate,
      { text }
    )

    const result = res as {
      source: string
      target: string
      original: string
      translated: string
    }

    const isChinese = result.source === 'zh'

    return {
      zh: isChinese ? result.original : result.translated,
      en: isChinese ? result.translated : result.original
    }
  }
}