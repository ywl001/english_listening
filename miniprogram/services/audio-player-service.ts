import { SegmentAudioPlayer, resolveTrack } from "./segment-audio-player";

/**
 * 短音频播放统一出口（列表试听 / 生成器预览）：
 * - 单例 + 单播放器实例：新任务自动顶掉旧任务，试听与预览互不叠播
 * - 句子解析统一走 resolveTrack（新旧结构兼容，新结构句子自动定位时间片段）
 * - 长任务（播放页引擎）由 PlayEngine 持有自己的 SegmentAudioPlayer；
 *   进播放页时调用 stop() 实现跨系统互斥
 */
class AudioPlayerService {
  private player = new SegmentAudioPlayer();

  constructor() {
    this.player.onError((err) => {
      console.error('[AudioPlayerService] 播放出错:', err);
      wx.showToast({ title: '音频播放失败', icon: 'none' });
    });
  }

  /**
   * 试听句子（默认英文）
   * @returns 是否成功起播（无音频时 toast 提示并返回 false）
   */
  playSentence(sentence: Sentence, lang: 'en' | 'zh' = 'en'): boolean {
    const task = resolveTrack(sentence, lang);
    if (!task) {
      wx.showToast({ title: lang === 'en' ? '该句子无英文音频' : '该句子无中文音频', icon: 'none' });
      return false;
    }
    this.player.play(task);
    return true;
  }

  /** 播放裸 URL（生成器的临时音频预览） */
  playUrl(url: string): void {
    if (!url) return;
    this.player.play({ url });
  }

  /** 停止当前播放（进播放页 / 组件卸载时调用，实现互斥） */
  stop(): void {
    this.player.stop();
  }

  /** 注册"当前任务播放完毕"回调（后注册者覆盖前者，长期有效） */
  onEnded(cb: () => void): void {
    this.player.onEnded(cb);
  }
}

export default new AudioPlayerService();
