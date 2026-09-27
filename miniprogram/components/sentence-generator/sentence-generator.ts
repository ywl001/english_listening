import { TranslateService } from "../../services/translate-service"
import { TtsService } from "../../services/tts-service"
import sentenceStore from "../../utils/sentenceStore"
import appStore from "../../services/app-store"
import eventBus from "../../services/EventBus"
import { AppEvent } from "../../services/event-type"

const EMPTY_RESULT = {
  zh: '',
  en: '',
  tempAudioUrl: '',
  tempAudioZhUrl: '',
  audioFileID: '',
  audioZhFileID: '',
  audioZhText: '',
  enAudioText: '',
  generatedInputText: '',
  genError: ''
}

Component({
  properties: {
    bookId: {
      type: String,
      value: ''
    }
  },

  data: {
    inputText: '',
    detectedLang: 'en' as 'zh' | 'en',
    ...EMPTY_RESULT,
    generating: false,
    saving: false,
    selectedBookId: ''
  },

  observers: {
    bookId(value: string) {
      console.log('geerator :', value)
      this.setData({ selectedBookId: value || '' })
    }
  },

  methods: {
    onInput(e: WechatMiniprogram.CustomEvent) {
      const inputText = e.detail.value
      const updates: Record<string, any> = {
        inputText,
        detectedLang: this.detectLang(inputText)
      }

      if (
        this.data.generatedInputText &&
        inputText.trim() !== this.data.generatedInputText
      ) {
        this.discardPendingAudio()
        Object.assign(updates, EMPTY_RESULT)
      }

      this.setData(updates)
    },

    detectLang(text: string): 'zh' | 'en' {
      return /[\u4e00-\u9fa5]/.test(text) ? 'zh' : 'en'
    },

    async onTranslateAndGenerate() {
      if (this.data.generating) return

      const trimmed = this.data.inputText.trim()

      if (!trimmed) {
        wx.showToast({ title: '请输入内容', icon: 'none' })
        return
      }

      await this.discardPendingAudio()

      this.setData({
        ...EMPTY_RESULT,
        generating: true
      })

      wx.showLoading({ title: '翻译中...', mask: true })

      try {
        const { zh, en } = await TranslateService.translate(trimmed)

        if (this.data.inputText.trim() !== trimmed) return

        this.setData({ zh, en })

        // 查重：库里已有相同英文句子则不再生成（controller 查询并回传）
        const existing = await new Promise<Sentence | null>(resolve => {
          eventBus.emit(AppEvent.FIND_SENTENCE, { en, callback: (s: Sentence | null) => resolve(s) })
        })
        if (this.data.inputText.trim() !== trimmed) return

        if (existing) {
          // 展示库中已有的句子内容（替换为原文的中文翻译）
          this.setData({ zh: existing.zh || zh, en: existing.en || en })
          await this.handleExistingSentence(existing)
          return
        }

        wx.showLoading({ title: '生成发音中...', mask: true })

        const [zhAudio, enAudio] = await Promise.all([
          TtsService.synthesize(zh),
          TtsService.synthesize(en)
        ])

        if (this.data.inputText.trim() !== trimmed) {
          await TtsService.deleteTemps(
            [zhAudio?.fileID, enAudio?.fileID].filter(Boolean)
          )
          return
        }

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

        wx.showToast({
          title: message,
          icon: 'none'
        })

      } finally {
        wx.hideLoading()
        this.setData({ generating: false })
      }
    },

    /**
     * 库中已有相同句子时的处理：
     * - 目标是引用书：把已有句子加入该引用书（controller 写收藏记录），随后走 saved 事件刷新列表
     * - 目标是实体书（我的句子等）：提示已存在，什么都不做，关闭弹层
     */
    handleExistingSentence(existing: Sentence) {
      const bookId = this.data.selectedBookId
      const book = appStore.books.value.find(b => b._id === bookId)
      const isRefBook = book?.type === 'ref'

      if (isRefBook && bookId) {
        // controller 负责加入词书并提示；成功后刷新列表并关闭弹层
        eventBus.emit(AppEvent.ADD_SENTENCE_TO_BOOK, {
          sentenceId: existing._id,
          bookId,
          callback: (_: any, err?: any) => {
            if (!err) {
              this.triggerEvent('saved', { sentence: existing })
            }
            this.triggerEvent('close')
          }
        })
        return
      }

      // 实体书：提示已存在，关闭
      wx.hideLoading()
      wx.showModal({
        title: '句子已存在',
        content: `句库中已有该句子：\n${existing.en || ''}\n${existing.zh || ''}`,
        showCancel: false,
        confirmText: '知道了'
      })
      this.triggerEvent('close')
    },

    playZh() {
      this.playAudio(this.data.tempAudioZhUrl)
    },

    playEn() {
      this.playAudio(this.data.tempAudioUrl)
    },

    playAudio(url: string) {
      if (!url) return

      const audioCtx = wx.createInnerAudioContext()

      audioCtx.src = url
      audioCtx.play()

      audioCtx.onError(res => {
        console.error('音频播放失败', res)
        wx.showToast({
          title: '音频播放失败',
          icon: 'none'
        })
      })
    },

    async onSave() {
      if (this.data.saving) return

      const {
        zh,
        en,
        audioFileID,
        audioZhFileID,
        audioZhText,
        enAudioText,
        selectedBookId
      } = this.data

      if (!audioFileID || !audioZhFileID) {
        wx.showToast({
          title: '请先生成音频',
          icon: 'none'
        })
        return
      }

      if (zh.trim() !== audioZhText || en.trim() !== enAudioText) {
        wx.showToast({
          title: '文字已修改，请重新生成发音',
          icon: 'none'
        })
        return
      }

      if (!selectedBookId) {
        wx.showToast({
          title: '请先选择词书',
          icon: 'none'
        })
        return
      }

      this.setData({ saving: true })
      wx.showLoading({ title: '保存中...', mask: true })

      // controller 负责临时音频搬运到永久目录 + 落库，成功后回传新句子
      eventBus.emit(AppEvent.CREATE_SENTENCE, {
        bookId: selectedBookId,
        zh: zh.trim(),
        en: en.trim(),
        audioFileID,
        audioZhFileID,
        callback: (sentence: Sentence | null, err?: any) => {
          wx.hideLoading()
          this.setData({ saving: false })

          if (err || !sentence) return // controller/callCloudFunction 已提示

          this.setData({
            audioFileID: '',
            audioZhFileID: ''
          })

          this.triggerEvent('saved', { sentence })
        }
      })
    },

    async discardPendingAudio() {
      const fileIDs = [
        this.data.audioFileID,
        this.data.audioZhFileID
      ].filter(Boolean)

      if (!fileIDs.length) return

      this.setData({
        audioFileID: '',
        audioZhFileID: ''
      })

      try {
        await TtsService.deleteTemps(fileIDs)
      } catch (err) {
        console.error('清理临时音频异常:', err)
      }
    }
  },

  detached() {
    this.discardPendingAudio()
  }
})
