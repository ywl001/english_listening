import sentenceService from "../../services/sentence-service"
import { TranslateService } from "../../services/translate-service"
import { TtsService } from "../../services/tts-service"
import sentenceStore from "../../utils/sentenceStore"

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
      console.log('geerator :',value)
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

      try {
        const timestamp = Date.now()

        const [audio, audio_zh] = await Promise.all([
          TtsService.moveToPermanent(
            audioFileID,
            `english/en/${timestamp}.mp3`
          ),
          TtsService.moveToPermanent(
            audioZhFileID,
            `english/zh/${timestamp}.mp3`
          )
        ])

        const createdSentence = await sentenceService.createSentence({
          bookId: selectedBookId,
          zh: zh.trim(),
          en: en.trim(),
          audio,
          audio_zh
        })

        if (createdSentence) {
          sentenceStore.prependOrUpdate(
            selectedBookId,
            [createdSentence]
          )
        }

        this.setData({
          audioFileID: '',
          audioZhFileID: ''
        })

        wx.hideLoading()

        wx.showToast({
          title: '保存成功',
          icon: 'success'
        })

        this.triggerEvent('saved', { sentence: createdSentence })

      } catch (e) {
        console.error('保存句子失败', e)

        wx.hideLoading()

        wx.showToast({
          title: '保存失败，请重试',
          icon: 'none'
        })

      } finally {
        this.setData({ saving: false })
      }
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
