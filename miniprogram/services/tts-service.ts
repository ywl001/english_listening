import { cloudFunctionName } from "../enums/app-enums"
import { callCloudFunction } from "./cloud-client"

export class TtsService {
  static async synthesize(text: string): Promise<TtsResult> {
    const res = await callCloudFunction(
      cloudFunctionName.edgeTts,
      { text }
    )

    const {
      fileID,
      wordBoundaries
    } = res as {
      fileID: string
      wordBoundaries: WordBoundary[]
    }

    const { fileList } = await wx.cloud.getTempFileURL({
      fileList: [fileID]
    })

    return {
      fileID,
      url: fileList[0].tempFileURL,
      wordBoundaries: wordBoundaries || []
    }
  }

  static async moveToPermanent(
    fileID: string,
    cloudPath: string
  ): Promise<string> {
    const { tempFilePath } =
      await wx.cloud.downloadFile({ fileID })

    const result = await wx.cloud.uploadFile({
      cloudPath,
      filePath: tempFilePath
    })

    await this.deleteTemp(fileID)

    return result.fileID
  }

  static async deleteTemp(fileID: string) {
    if (!fileID) return

    try {
      await wx.cloud.deleteFile({
        fileList: [fileID]
      })
    } catch (err) {
      console.warn('清理临时音频失败', err)
    }
  }

  static async deleteTemps(fileIDs: string[]) {
    const list = fileIDs.filter(Boolean)
    if (!list.length) return

    try {
      await wx.cloud.deleteFile({
        fileList: list
      })
    } catch (err) {
      console.warn('清理未保存音频失败', err)
    }
  }
}