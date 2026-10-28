import { SegmentAudioPlayer, resolveTrack } from "./segment-audio-player";

/**
 * 短音频播放统一出口（列表试听 / 生成器预览）：
 * - 单例 + 单播放器实例：新任务自动顶掉旧任务，试听与预览互不叠播
 * - 句子解析统一走 resolveTrack（新旧结构兼容，新结构句子自动定位时间片段）
 * - 长任务（播放页引擎）由 PlayEngine 持有自己的 SegmentAudioPlayer；
 *   进播放页时调用 stop() 实现跨系统互斥
 *
 * 同时对外广播"当前正在播放的 url"，UI 可订阅实现播放高亮：
 *   const off = audioPlayerService.onChange(url => ...)
 *   off() // 卸载时反注册
 */
type PlayingListener = (url: string | null) => void

class AudioPlayerService {
  private player = new SegmentAudioPlayer();
  private currentUrl: string | null = null;
  private listeners = new Set<PlayingListener>();

  constructor() {
    this.player.onError((err) => {
      console.error('[AudioPlayerService] 播放出错:', err);
      wx.showToast({ title: '音频播放失败', icon: 'none' });
      this.notify(null);
    });
    this.player.onEnded(() => {
      this.notify(null);
    });
  }

  private notify(url: string | null) {
    this.currentUrl = url;
    this.listeners.forEach((l) => l(url));
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
    this.notify(task.url);
    this.player.play(task);
    return true;
  }

  /** 播放裸 URL（生成器的临时音频预览） */
  playUrl(url: string): void {
    if (!url) return;
    this.notify(url);
    this.player.play({ url });
  }

  /** 停止当前播放（进播放页 / 组件卸载时调用，实现互斥） */
  stop(): void {
    this.notify(null);
    this.player.stop();
  }

  /** 注册"当前任务播放完毕"回调（后注册者覆盖前者，长期有效） */
  onEnded(cb: () => void): void {
    this.player.onEnded(cb);
  }

  /**
   * 订阅"当前播放 url"变化（起播/结束/被打断都会触发）。
   * 立即用当前值回调一次，避免新订阅者错过初始状态。
   * 返回反注册函数，组件 detached 时调用。
   */
  onChange(listener: PlayingListener): () => void {
    this.listeners.add(listener);
    listener(this.currentUrl);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export default new AudioPlayerService();
