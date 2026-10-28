import { TranslateService } from "../../services/translate-service"
import { TtsService } from "../../services/tts-service"
import appStore from "../../services/app-store"
import eventBus from "../../services/EventBus"
import { AppEvent } from "../../services/event-type"
import audioPlayerService from "../../services/audio-player-service"
import sentenceService from "../../services/sentence-service"
import bookService from "../../services/book-service"

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
    selectedBookId: '',
    playingUrl: ''
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

        // 查重：库里已有相同英文句子则不再生成（service 直调）
        const existing = await sentenceService.findSentence(en)
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
     * - 目标是引用书：把已有句子加入该引用书（service 直调），随后走 saved 事件刷新列表
     * - 目标是实体书（我的句子等）：提示已存在，什么都不做，关闭弹层
     */
    async handleExistingSentence(existing: Sentence) {
      const bookId = this.data.selectedBookId
      const book = appStore.books.value.find(b => b._id === bookId)
      const isRefBook = book?.type === 'ref'

      if (isRefBook && bookId) {
        try {
          await bookService.addSentenceToBook(existing._id, bookId)
          // 云端已写入引用记录，补写本地收藏分片，否则重进本书时列表为空
          sentenceService.cacheLocalFavorite(existing._id, bookId, existing.bookId)
          wx.showToast({ title: '已添加到词书', icon: 'success' })
          this.triggerEvent('saved', { sentence: existing })
        } catch (err) {
          console.error('[sentence-generator] 加入词书失败:', err)
        }
        this.triggerEvent('close')
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

    // 统一走 audioPlayerService：单实例互斥播放，不再每次 new InnerAudioContext（泄漏 + 可叠播）
    playAudio(url: string) {
      if (!url) return
      ;(this as any).playedByMe = true
      audioPlayerService.playUrl(url)
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
            audioZhFileID: '',
            inputText:''
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
    // 只停自己发起的预览，避免误停列表页等其他来源的播放
    if ((this as any).playedByMe) {
      ;(this as any).playedByMe = false
      audioPlayerService.stop()
    }
    ;(this as any)._unsubAudio?.()
    this.discardPendingAudio()
  },

  attached() {
    // 订阅全局"当前播放 url"，用于小喇叭高亮
    ;(this as any)._unsubAudio = audioPlayerService.onChange((url) => {
      this.setData({ playingUrl: url || '' })
    })
  }
})
