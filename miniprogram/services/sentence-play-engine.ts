

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
import { AudioTask, SegmentAudioPlayer } from "./segment-audio-player";

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
  private awaitingNextStep = false;
  private playToken = 0;
  private playing = false;
  /** 连续播放错误计数（正常播完一句即清零，防止错误→跳句→再错误的死循环） */
  private errorStreak = 0;
  /** 中文轮次是否已处理（学习模式排序用） */
  private zhPlayed = false;
  /** 已完成的朗读次数（片段级：1 个片段 = 1 次朗读） */
  private readsDone = 0;
  /** 刚下发的任务包含的朗读段数 */
  private lastTaskSegments = 1;
  /** 当前任务播完后是否计入 readsDone（英文/计数语言才计） */
  private countThisTask = false;

  constructor(
    private player: SegmentAudioPlayer,
    private listManager: SentencePlayListManager,
    private config: PlayConfig,
    private callbacks: PlayCallbacks
  ) {
    // 监听音频任务播放完毕（旧结构=整文件结束；新结构=最后一段到达终点）
    this.player.onEnded(() => {
      this.errorStreak = 0;
      this.handleAudioEnded();
    });

    // 监听音频播放异常
    this.player.onError(err => {
      console.error('[PlayEngine] 播放出错:', err);
      // 连续 3 句失败：不再继续跳句，避免死循环刷屏
      this.errorStreak += 1;
      if (this.errorStreak >= 3) {
        this.setPlaying(false);
        this.callbacks.onFinished('连续播放失败，已停止');
        return;
      }
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
    return this.listManager.currentSentence;
  }

  /**
   * 开始/启动播放（入口）
   */
  public start(): void {
    const current = this.listManager.currentSentence;
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
      this.player.pause();
      this.setPlaying(false);
      return;
    }

    this.setPlaying(true);
    if (this.awaitingNextStep) {
      // 如果暂停发生于 sleep 句间停顿期间，直接触发下一步
      this.awaitingNextStep = false;
      this.advanceStep();
    } else {
      this.player.resume();
    }
  }

  /**
   * 停止播放
   */
  public stop(): void {
    this.player.stop();
    this.setPlaying(false);
    this.awaitingNextStep = false;
  }

  /**
   * 销毁引擎与音频实例
   */
  public destroy(): void {
    this.stop();
    this.player.destroy();
  }

  // ==================== 内部步骤与状态控制 ====================

  private resetStepState(): void {
    this.awaitingNextStep = false;
    this.zhPlayed = false;
    this.readsDone = 0;
    this.lastTaskSegments = 1;
    this.countThisTask = false;
    this.playToken += 1;
  }

  private setPlaying(playing: boolean): void {
    this.playing = playing;
    this.callbacks.onPlayingChange(playing);
  }

  /**
   * 构造某句话某种语言的播放任务
   * - 新结构（audioUrl + audioSegments）：返回整本书 URL + 对应语言的时间片段
   * - 旧结构（audio / audio_zh）：返回单句文件 URL，无片段
   * - 无可用音频：返回 null
   */
  private buildAudioTask(sentence: Sentence, lang: 'en' | 'zh'): AudioTask | null {
    if (sentence.audioUrl && sentence.audioSegments) {
      const segs = sentence.audioSegments[lang];
      if (!segs || segs.length === 0) return null;
      return { url: sentence.audioUrl, segments: segs };
    }
    const url = lang === 'en' ? sentence.audio : sentence.audio_zh;
    return url ? { url } : null;
  }

  /**
   * 执行当前句子的具体步骤（中英文交替/重复控制）
   *
   * repeatCount 的语义是"朗读总次数"（片段级）：
   * 一个任务可能含多个片段（如英文快/慢速 2 段 = 朗读 2 次），
   * repeatCount=2 时只播一轮任务即达到 2 次，不再乘出 4 次。
   */
  private playStep(): void {
    const current = this.currentSentence;
    if (!current) return;

    // 1. 只听英文模式
    if (this.config.playOrder === 'en_only') {
      const task = this.buildAudioTask(current, 'en');
      if (!task) {
        console.warn('当前句子无英文音频，跳过');
        this.next(true);
        return;
      }
      this.callbacks.onStatusChange('听英文');
      this.playCountedTask(task);
      return;
    }

    // 2. 只听中文模式
    if (this.config.playOrder === 'zh_only') {
      const task = this.buildAudioTask(current, 'zh');
      if (!task) {
        console.warn('当前句子无中文音频，跳过');
        this.next(true);
        return;
      }
      this.callbacks.onStatusChange('听中文');
      this.playCountedTask(task);
      return;
    }

    // 3. 测试模式：只播放单侧音频一次，播完挂起等待作答
    if (this.config.playMode === 'test') {
      const isListenZh = this.config.playOrder === 'zh_first';
      const task = this.buildAudioTask(current, isListenZh ? 'zh' : 'en');

      if (!task) {
        this.next(true);
        return;
      }

      this.callbacks.onStatusChange(isListenZh ? '听中文' : '听英文');
      this.player.play(task);
      return;
    }

    // 4. 学习/全量模式：repeatCount = 0 表示"无限"：英文无限重复，直到用户手动切句
    const rc = this.config.repeatCount;
    const isZhFirst = this.config.playOrder === 'zh_first';

    // 中文轮次：zh_first 为第一步；en_first 则等英文读满之后
    const zhTurn = isZhFirst
      ? !this.zhPlayed
      : (rc > 0 && this.readsDone >= rc && !this.zhPlayed);

    if (zhTurn) {
      // 无论有无音频都标记已处理，避免无中文音频时反复进入该轮次
      this.zhPlayed = true;
      const task = this.buildAudioTask(current, 'zh');
      if (!task) {
        this.handleAudioEnded();
        return;
      }
      this.callbacks.onStatusChange('中文');
      this.player.play(task);
      return;
    }

    // 英文轮次：按剩余次数裁剪片段，使累计朗读次数恰好等于 repeatCount
    const enTask = this.buildAudioTask(current, 'en');
    if (!enTask) {
      console.warn('当前句子无英文音频，跳过');
      if (rc > 0) {
        this.readsDone = rc; // 视为已读满，走向中文/下一句
        this.handleAudioEnded();
      } else {
        this.next(true); // 无限模式无音频：直接下一句，避免死循环
      }
      return;
    }
    this.playCountedTask(enTask);
    this.callbacks.onStatusChange(
      rc > 0
        ? `英文 (${Math.min(this.readsDone + this.lastTaskSegments, rc)}/${rc})`
        : '英文 (∞)'
    );
  }

  /**
   * 下发一个计入 repeatCount 的任务：按剩余次数裁剪片段
   * （如剩 1 次而任务含快/慢 2 段，只播第 1 段）
   */
  private playCountedTask(task: AudioTask): void {
    const rc = this.config.repeatCount;
    const remaining = rc > 0 ? Math.max(1, rc - this.readsDone) : Infinity;
    let trimmed = task;
    if (task.segments && task.segments.length > 1 && remaining < task.segments.length) {
      trimmed = { url: task.url, segments: task.segments.slice(0, remaining) };
    }
    this.lastTaskSegments = trimmed.segments ? trimmed.segments.length : 1;
    this.countThisTask = true;
    this.player.play(trimmed);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 当前音频播放完毕的回调句柄
   */
  private async handleAudioEnded(): Promise<void> {
    if (!this.playing) return;

    // 统计刚播任务的朗读次数（英文多段 = 多次朗读）
    if (this.countThisTask) {
      this.readsDone += this.lastTaskSegments;
      this.countThisTask = false;
    }

    const token = this.playToken;
    this.awaitingNextStep = true;

    // 如果配置了句间/步骤间停顿
    if (this.config.gapMs > 0 ) {
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
    // 测试模式：单句（单侧音频）播完即挂起，等待用户作答
    if (this.config.playMode === 'test') {
      this.next(true);
      return;
    }
    // 无限模式（repeatCount = 0）：英文永远重复，不切下一句
    if (this.config.repeatCount === 0) {
      this.playStep();
      return;
    }
    // 朗读次数已读满
    if (this.readsDone >= this.config.repeatCount) {
      // en_first：中文还没播过 → 轮到中文，播完再切句
      if (this.config.playOrder === 'en_first' && !this.zhPlayed) {
        this.playStep();
        return;
      }
      this.next(true);
      return;
    }
    this.playStep();
  }
}