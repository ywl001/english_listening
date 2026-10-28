// 混合 TTS 路由：
// - 主通道 -> 讯飞云函数 xfTts（中文/英文都走，音质好）
// - 失败/超时/免费配额用完 -> 自动降级微信同声传译插件 + 10 分钟熔断
//
// 微信同声传译插件文档:
//   https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/extended/translator.html
//   配额: 100 次/分钟，2w 次/天（单小程序）
//   长度: 文档声称 <= 50 字符，但 2026-10 实测英文 178 字符可正常合成，
//         后台未拦截；中文超 50 未验证。如遇 retcode=-20002 再考虑加拦截
//   注意: 插件不返回词级时间戳，wordBoundaries 统一返回空数组

import { cloudFunctionName } from "../enums/app-enums"

// ---- 讯飞 TTS 开关 / 熔断配置 ----
// 总开关：想彻底绕过讯飞（如想省免费额度），改成 false 即可
const XF_TTS_ENABLED = true
// 单次调用等待上限：超时立即降级插件，不再干等云函数超时
const XF_TTS_TIMEOUT_MS = 10_000
// 熔断时长：讯飞失败一次后（含配额用完 retcode=10105），这段时间内直接走插件不再尝试
const XF_TTS_COOLDOWN_MS = 10 * 60 * 1000

let xfDisabledUntil = 0

type SITextToSpeechOptions = {
  lang: 'zh_CN' | 'en_US'
  content: string
  success: (res: {
    retcode: number
    origin: string
    filename: string
    expired_time: number
  }) => void
  fail: (err: { retcode: number; msg: string }) => void
}

type WechatSIPlugin = {
  textToSpeech: (opts: SITextToSpeechOptions) => void
}

const siPlugin = requirePlugin('WechatSI') as WechatSIPlugin

export class TtsService {
  /** 调微信同声传译插件的 textToSpeech，成功返回远程音频 URL（3 小时有效） */
  private static synthOnce(text: string): Promise<string> {
    if (!text) {
      return Promise.reject(new Error('TTS 文本为空'))
    }

    const lang: 'zh_CN' | 'en_US' = /[\u4e00-\u9fff]/.test(text)
      ? 'zh_CN'
      : 'en_US'

    return new Promise((resolve, reject) => {
      siPlugin.textToSpeech({
        lang,
        content: text,
        success: (res) => {
          if (res.retcode === 0 && res.filename) {
            resolve(res.filename)
          } else {
            reject(new Error(`TTS 合成失败 retcode=${res.retcode}`))
          }
        },
        fail: (err) =>
          reject(
            new Error(
              `TTS 合成失败 retcode=${err.retcode} msg=${err.msg || ''}`
            )
          )
      })
    })
  }

  /**
   * 插件路径：合成 + 转存到云存储
   * 保留契约 { fileID, url, wordBoundaries }，上层（sentence-generator /
   * sentence-input）无感切换；插件不提供词级时间戳，统一返回空数组。
   */
  private static async synthesizeByPlugin(text: string): Promise<TtsResult> {
    const remoteUrl = await TtsService.synthOnce(text)

    // 1. 远程 URL -> 本地临时文件
    //    注意：发布到正式环境前需把插件 CDN 域名加入「小程序后台 -> 开发管理
    //    -> 服务器域名 -> downloadFile 合法域名」白名单；开发工具通常无需配置。
    const dl = await new Promise<WechatMiniprogram.DownloadFileSuccessCallbackResult>(
      (resolve, reject) => {
        wx.downloadFile({
          url: remoteUrl,
          success: resolve,
          fail: reject
        })
      }
    )
    if (dl.statusCode !== 200) {
      throw new Error(`下载 TTS 音频失败 statusCode=${dl.statusCode}`)
    }
    const tempFilePath = dl.tempFilePath

    // 2. 上传云存储：与原 edgeTts 行为一致，保留 fileID 便于后续搬永久目录 / 清理
    const cloudPath = `tts/si_${Date.now()}_${Math.random()
      .toString(36)
      .slice(-6)}.mp3`
    const uploadRes = await wx.cloud.uploadFile({
      cloudPath,
      filePath: tempFilePath
    })
    const fileID = uploadRes.fileID

    // 3. 取临时访问 URL 用于播放预览
    const { fileList } = await wx.cloud.getTempFileURL({ fileList: [fileID] })
    const url = fileList[0].tempFileURL

    return {
      fileID,
      url,
      wordBoundaries: []
    }
  }

  /**
   * 云函数路径（讯飞 xfTts）
   * 不走 callCloudFunction：降级场景下避免弹出错误 toast
   */
  private static async synthesizeByCloud(text: string): Promise<TtsResult> {
    const res = await wx.cloud.callFunction({
      name: cloudFunctionName.xfTts,
      data: { text }
    })

    const result = res.result as {
      code: number
      message?: string
      msg?: string
      data?: {
        fileID: string
        wordBoundaries?: WordBoundary[]
      }
    }

    if (!result || result.code !== 0 || !result.data?.fileID) {
      // dbhelper.fail 用 message 字段，兼容部分旧接口用 msg
      throw new Error(
        result?.message ||
          result?.msg ||
          'xfTts 云函数返回异常'
      )
    }

    const { fileList } = await wx.cloud.getTempFileURL({
      fileList: [result.data.fileID]
    })

    return {
      fileID: result.data.fileID,
      url: fileList[0].tempFileURL,
      wordBoundaries: result.data.wordBoundaries || []
    }
  }

  /**
   * 统一入口：讯飞优先，失败/超时/配额用完降级插件
   * - 讯飞云函数（总开关开 + 非熔断期）
   * - 失败 -> 触发熔断，本次及接下来 XF_TTS_COOLDOWN_MS 内直接走插件
   */
  static async synthesize(text: string): Promise<TtsResult> {
    const canUseXf = XF_TTS_ENABLED && Date.now() >= xfDisabledUntil

    if (canUseXf) {
      try {
        return await TtsService.withTimeout(
          TtsService.synthesizeByCloud(text),
          XF_TTS_TIMEOUT_MS
        )
      } catch (err) {
        console.warn('[TtsService] 讯飞 TTS 失败，降级为同声传译插件:', err)
        xfDisabledUntil = Date.now() + XF_TTS_COOLDOWN_MS
      }
    }

    return TtsService.synthesizeByPlugin(text)
  }

  /** 给 Promise 加超时，超时立即 reject，不等底层调用慢死 */
  private static withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      p,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`云函数 TTS ${ms / 1000}s 内未响应`)),
          ms
        )
      )
    ])
  }

  static async moveToPermanent(
    fileID: string,
    cloudPath: string
  ): Promise<string> {
    const { tempFilePath } = await wx.cloud.downloadFile({ fileID })

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
