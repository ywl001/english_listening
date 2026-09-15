

/**
 * 播放配置项
 */
// export interface PlayConfig {
//   playMode: 'learn' | 'test';       // 学习模式 / 测试模式
//   playOrder: 'zh_first' | 'en_first'; // 中文优先 / 英文优先
//   repeatCount: number;               // 英文重复次数 (如 2 次)
//   gapMs: number;                     // 句间/步骤间停顿毫秒数
//   limitCount: number;                // 本次播放上限条数 (0 为不限制)
// }

import { SentencePlayListManager } from "./sentence-play-manager";

/**
 * 播放事件回调
 */
export interface PlayCallbacks {
  /** 当前播放句子变更 */
  onCurrentChange: (sentence: Sentence, index: number) => void;
  /** 播放状态文本变化 (如 "听中文" / "英文 (1/2)" / "等待回答") */
  onStatusChange: (statusText: string) => void;
  /** 播放/暂停状态切换 */
  onPlayingChange: (isPlaying: boolean) => void;
  /** 播放完毕 (达到 limitCount 或已到队列末尾) */
  onFinished: (reason: string) => void;
  /** 提示通知 (如 "已经是第一句了") */
  onNotice: (message: string) => void;
}

export class PlayEngine {
  private step = 0;
  private awaitingNextStep = false;
  private playToken = 0;
  private playing = false;

  constructor(
    private audioCtx: WechatMiniprogram.InnerAudioContext,
    private listManager: SentencePlayListManager,
    private config: PlayConfig,
    private callbacks: PlayCallbacks
  ) {
    // 监听音频自然播放结束
    this.audioCtx.onEnded(() => this.handleAudioEnded());
    
    // 监听音频播放异常
    this.audioCtx.onError(err => {
      console.error('[PlayEngine] 播放出错:', err);
      // 遇到坏音频跳过，自动尝试下一句
      this.next(true);
    });
  }

  /**
   * 更新播放配置
   */
  public updateConfig(newConfig: Partial<PlayConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * 是否正在播放
   */
  public get isPlaying(): boolean {
    return this.playing;
  }

  /**
   * 获取当前播放的句子
   */
  public get currentSentence(): Sentence | null {
    return this.listManager.getCurrent();
  }

  /**
   * 开始/启动播放（入口）
   */
  public start(): void {
    const current = this.listManager.getCurrent();
    if (!current) {
      this.callbacks.onNotice('播放队列为空');
      return;
    }

    this.resetStepState();
    this.setPlaying(true);
    this.callbacks.onCurrentChange(current, this.listManager.currentIndexNum);
    this.playStep();
  }

  /**
   * 播放下一句
   * @param isAuto 是否为自动触发（如播完本句自动切下一句）
   */
  public async next(isAuto: boolean = false): Promise<void> {
    // 1. 测试模式：单句播完后挂起，暂停并等待用户作答
    if (this.config.playMode === 'test' && isAuto) {
      this.setPlaying(false);
      this.callbacks.onStatusChange('等待回答');
      return;
    }

    const nextIndex = this.listManager.currentIndexNum + 1;

    // 2. 检查用户设定的单次播放上限
    if (this.config.limitCount > 0 && nextIndex >= this.config.limitCount) {
      this.setPlaying(false);
      this.callbacks.onFinished('已完成设定的条数，真棒！');
      return;
    }

    // 3. 向 ListManager 调度器索取下一句
    const nextSentence = this.listManager.next();
    if (!nextSentence) {
      this.setPlaying(false);
      this.callbacks.onFinished('已经全部播完啦');
      return;
    }

    this.resetStepState();
    this.setPlaying(true);
    this.callbacks.onCurrentChange(nextSentence, this.listManager.currentIndexNum);
    this.playStep();
  }

  /**
   * 播放上一句
   */
  public prev(): void {
    const prevSentence = this.listManager.prev();
    if (!prevSentence) {
      this.callbacks.onNotice('已经是第一句了');
      return;
    }

    this.resetStepState();
    this.setPlaying(true);
    this.callbacks.onCurrentChange(prevSentence, this.listManager.currentIndexNum);
    this.playStep();
  }

  /**
   * 重播当前句子
   */
  public replay(): void {
    this.resetStepState();
    this.setPlaying(true);
    this.playStep();
  }

  /**
   * 切换 播放/暂停 状态
   */
  public pauseToggle(): void {
    if (this.playing) {
      this.audioCtx.pause();
      this.setPlaying(false);
      return;
    }

    this.setPlaying(true);
    if (this.awaitingNextStep) {
      // 如果暂停发生于 sleep 句间停顿期间，直接触发下一步
      this.awaitingNextStep = false;
      this.advanceStep();
    } else {
      this.audioCtx.play();
    }
  }

  /**
   * 停止播放
   */
  public stop(): void {
    this.audioCtx.stop();
    this.setPlaying(false);
    this.awaitingNextStep = false;
  }

  /**
   * 销毁引擎与音频实例
   */
  public destroy(): void {
    this.stop();
    this.audioCtx.destroy();
  }

  // ==================== 内部步骤与状态控制 ====================

  private resetStepState(): void {
    this.step = 0;
    this.awaitingNextStep = false;
    this.playToken += 1;
  }

  private setPlaying(playing: boolean): void {
    this.playing = playing;
    this.callbacks.onPlayingChange(playing);
  }

  /**
   * 执行当前句子的具体步骤（中英文交替/重复控制）
   */
  private playStep(): void {
    const current = this.currentSentence;
    if (!current) return;

    // 测试模式：只播放单侧音频 (中文或英文)
    if (this.config.playMode === 'test') {
      const isListenZh = this.config.playOrder === 'zh_first';
      this.callbacks.onStatusChange(isListenZh ? '听中文' : '听英文');
      this.audioCtx.src = isListenZh ? current.audio_zh : current.audio;
      this.audioCtx.play();
      return;
    }

    // 学习模式：根据 repeatCount 和 order 进行中英文组合
    const isZhFirst = this.config.playOrder === 'zh_first';
    const zhStep = isZhFirst ? 0 : this.config.repeatCount;

    if (this.step === zhStep) {
      this.callbacks.onStatusChange('中文');
      this.audioCtx.src = current.audio_zh;
    } else {
      const enIndex = isZhFirst ? this.step : this.step + 1;
      this.callbacks.onStatusChange(`英文 (${enIndex}/${this.config.repeatCount})`);
      this.audioCtx.src = current.audio;
    }
    
    this.audioCtx.play();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 当前音频播放完毕的回调句柄
   */
  private async handleAudioEnded(): Promise<void> {
    if (!this.playing) return;
    
    const token = this.playToken;
    this.awaitingNextStep = true;

    // 如果配置了句间/步骤间停顿
    if (this.config.gapMs > 0 && this.config.playMode !== 'test') {
      await this.sleep(this.config.gapMs);
    }

    // 防止在 sleep 期间用户切歌或暂停导致 token 发生改变
    if (token !== this.playToken || !this.playing) return;

    this.awaitingNextStep = false;
    this.advanceStep();
  }

  /**
   * 推进至单句内的下一个步骤或直接进入下一句
   */
  private advanceStep(): void {
    if (this.config.playMode === 'test') {
      this.next(true);
      return;
    }

    this.step += 1;
    // 当步骤数超过 repeatCount（即中英文均已播放完毕）时切到下一句
    if (this.step > this.config.repeatCount) {
      this.next(true);
    } else {
      this.playStep();
    }
  }
}