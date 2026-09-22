import sentenceService from "../../services/sentence-service"
import { TranslateService } from "../../services/translate-service"
import { TtsService } from "../../services/tts-service"
import sentenceStore from "../../utils/sentenceStore"

// 页面生成结果的初始状态
const EMPTY_RESULT = {
  zh: '', en: '',
  tempAudioUrl: '', tempAudioZhUrl: '',
  audioFileID: '', audioZhFileID: '',
  audioZhText: '', enAudioText: '', // 统一属性名：audioZhText 和 enAudioText
  generatedInputText: '', genError: ''
}

Page({
  data: {
    inputText: '',
    detectedLang: 'en' as 'zh' | 'en',
    ...EMPTY_RESULT,
    generating: false,
    saving: false,
    selectedBookId: '',
    selectedBookName: ''
  },

  bookId: '',

  onLoad(option: any) {
    this.bookId = option.bookId
    console.log(this.bookId)
    // 💡 补上这一行：同步给 data 中的 selectedBookId 赋值
    if (this.bookId) {
      this.setData({ selectedBookId: this.bookId })
    }
  },

  /** 输入文字 */
  onInput(e: WechatMiniprogram.TextareaInput) {
    const inputText = e.detail.value
    const updates: Record<string, any> = {
      inputText,
      detectedLang: this.detectLang(inputText)
    }
    // 如果已经生成过结果，且修改了文本，立刻清理上一轮未保存的临时音频
    if (this.data.generatedInputText && inputText.trim() !== this.data.generatedInputText) {
      this.discardPendingAudio() // 异步清理，不阻塞 UI 响应
      Object.assign(updates, EMPTY_RESULT)
    }
    this.setData(updates)
  },

  /** 判断输入语言 */
  detectLang(text: string): 'zh' | 'en' {
    return /[\u4e00-\u9fa5]/.test(text) ? 'zh' : 'en'
  },

  async onTranslateAndGenerate() {
    if (this.data.generating) return

    const trimmed = this.data.inputText.trim()
    if (!trimmed) { wx.showToast({ title: '请输入内容', icon: 'none' }); return }

    await this.discardPendingAudio()

    // 1. 设置生成状态，先清空旧结果
    this.setData({ ...EMPTY_RESULT, generating: true })
    wx.showLoading({ title: '翻译中...', mask: true })

    try {
      // 2. 翻译
      const { zh, en } = await TranslateService.translate(trimmed)
      if (this.data.inputText.trim() !== trimmed) return

      // 💡 调整点：翻译完立刻渲染出文字，无需等待音频生成
      this.setData({ zh, en })

      // 3. 生成音频
      wx.showLoading({ title: '生成发音中...', mask: true })
      const [zhAudio, enAudio] = await Promise.all([
        TtsService.synthesize(zh),
        TtsService.synthesize(en)
      ])

      if (this.data.inputText.trim() !== trimmed) {
        await TtsService.deleteTemps([zhAudio?.fileID, enAudio?.fileID].filter(Boolean))
        return
      }

      // 打印日志排查：请在开发者工具 Console 确认这几个值是否正确存在！
      console.log('Synthesize Success:', { zh, en, zhAudio, enAudio })

      // 4. 关键：一次性将翻译和音频结果更新进 data
      this.setData({
        tempAudioZhUrl: zhAudio.url || '',
        tempAudioUrl: enAudio.url || '',
        audioZhFileID: zhAudio.fileID || '',
        audioFileID: enAudio.fileID || '',
        audioZhText: zh,
        enAudioText: en,
        generatedInputText: trimmed,
        genError: ''
      })

      wx.showToast({ title: '生成成功', icon: 'success' })
    } catch (e) {
      console.error('翻译/生成失败', e)
      const message = e instanceof Error ? e.message : '生成失败'
      this.setData({ genError: message })
      wx.showToast({ title: message, icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ generating: false })
    }
  },

  /** 播放音频方法 */
  playAudio(e: WechatMiniprogram.CustomEvent) {
    const url = e.currentTarget.dataset.url
    if (!url) return

    const audioCtx = wx.createInnerAudioContext()
    audioCtx.src = url
    audioCtx.play()

    audioCtx.onError((res) => {
      console.error('音频播放失败', res)
      wx.showToast({ title: '音频播放失败', icon: 'none' })
    })
  },

  /** 保存句子 */
  async onSave() {
    if (this.data.saving) return

    const { zh, en, audioFileID, audioZhFileID, audioZhText, enAudioText, selectedBookId } = this.data

    if (!audioFileID || !audioZhFileID) {
      wx.showToast({ title: '请先生成音频', icon: 'none' }); return
    }

    // 文字和音频不一致校验
    if (zh.trim() !== audioZhText || en.trim() !== enAudioText) {
      wx.showToast({ title: '文字已修改，请重新生成发音', icon: 'none' })
      return
    }

    if (!selectedBookId) {
      wx.showToast({ title: '请先选择词书', icon: 'none' }); return
    }

    this.setData({ saving: true })
    wx.showLoading({ title: '保存中...', mask: true })

    try {
      const timestamp = Date.now()

      // 1. 临时音频 → 正式目录
      const [audio, audio_zh] = await Promise.all([
        TtsService.moveToPermanent(audioFileID, `english/en/${timestamp}.mp3`),
        TtsService.moveToPermanent(audioZhFileID, `english/zh/${timestamp}.mp3`)
      ])

      // 2. 保存句子记录
      const createdSentence = await sentenceService.createSentence({
        bookId: selectedBookId,
        zh: zh.trim(),
        en: en.trim(),
        audio,
        audio_zh
      })

      // 3. 更新本地 SentenceStore 缓存
      if (createdSentence) {
        sentenceStore.prependOrUpdate(selectedBookId, [createdSentence])
      }

      // 迁移成功后，原临时文件已移动或变成正式文件，清空本地记录的临时 fileID，防止 onReset 重复删除
      this.setData({ audioFileID: '', audioZhFileID: '' })

      wx.hideLoading()
      wx.showToast({ title: '保存成功', icon: 'success' })

      // 重置 UI
      this.onReset()
    } catch (e) {
      console.error('保存句子失败', e)
      wx.hideLoading()
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },

  onReset() {
    this.setData({ inputText: '', detectedLang: 'en', ...EMPTY_RESULT, generating: false, saving: false })
  },

  async onDiscardAndReset() {
    await this.discardPendingAudio()
    this.onReset()
  },

  /** 清理当前还没有保存的临时音频 */
  async discardPendingAudio() {
    const fileIDs = [this.data.audioFileID, this.data.audioZhFileID].filter(Boolean)
    if (!fileIDs.length) return

    // 先把 data 中的 fileID 清空，防止重复调用造成二次清理报错
    this.setData({ audioFileID: '', audioZhFileID: '' })

    try {
      await TtsService.deleteTemps(fileIDs)
    } catch (err) {
      console.error('清理临时音频异常:', err)
    }
  },

  onBack() { wx.navigateBack() },

  /** 离开页面：清理未保存的临时文件 */
  onUnload() {
    // 页面卸载时同步触发清理（推荐在 TtsService.deleteTemps 内部做好容错，即使页面销毁请求也会发出）
    this.discardPendingAudio()
  }
})