
/**
 * 分段音频播放器
 *
 * 兼容两种句子数据结构：
 * - 旧结构：每句独立音频文件（audio / audio_zh），任务无 segments，
 *   直接播放整个文件，靠原生 onEnded 通知结束。
 * - 新结构：整本书共用一个音频文件（audioUrl，已由 AudioFileStore 本地化），
 *   每句携带时间片段（audioSegments.en / audioSegments.zh）。
 *   英文可能含多段（快/慢速），依次播完全部片段视为"播放一次英文"。
 *
 * 定位机制（关键设计）：
 * 起播定位优先用原生 startTime 属性：stop → 重设 src → startTime → play。
 * 注意赋值顺序：src 赋值会重建音频并可能重置 startTime，因此 startTime
 * 需在 src 之后（重设前也设一次兜底）再赋值，否则起播恒从头开始。
 * 由于个别环境仍可能忽略 startTime，起播后 400ms 做快速校验，
 * 未生效则在"播放中"用 seek() 补救（播放状态下 seek 最可靠），
 * 看门狗 1.5s 作为最终兜底：seek → 重设 src 重来 → 跳过片段。
 */
export interface AudioSegment {
  start: number;
  end: number;
}

export interface AudioTask {
  /** 音频文件地址（旧结构=单句文件；新结构=本地化后的整本书文件） */
  url: string;
  /** 时间片段（缺省=播放整个文件） */
  segments?: AudioSegment[];
}

type PlayerState = 'idle' | 'loading' | 'playing' | 'paused';

export class SegmentAudioPlayer {
  private audioCtx!: WechatMiniprogram.InnerAudioContext;
  private task: AudioTask | null = null;
  private segIndex = 0;
  private state: PlayerState = 'idle';
  /** 起点未生效时的重试次数（每个任务/片段独立配额） */
  private startRetried = 0;
  /** 起点生效确认的看门狗 */
  private startWatchdog: ReturnType<typeof setTimeout> | null = null;
  /** 起播快速校验定时器 */
  private quickCheck: ReturnType<typeof setTimeout> | null = null;
  /** 暂停时的位置，恢复播放用 */
  private resumeAt: number | null = null;
  /** 一次任务只通知一次 ended */
  private endedNotified = false;

  private endedHandler: () => void = () => { };
  private errorHandler: (err: any) => void = () => { };

  constructor() {
    this.attachAudio();
  }

  /**
   * 创建音频实例并挂载全部监听（构造与每次重建共用）。
   *
   * 为什么每次起播都重建：同一 InnerAudioContext 对同一 src 二次赋值时，
   * 原生层可能忽略赋值不重载，play 后无声、无 onPlay、无 onError，
   * 表现为"同句第二轮任务"静默卡死（引擎等不到 ended，卡片不切）。
   * 重建实例让 src/startTime 按全新加载处理，规避该平台缺陷。
   */
  private attachAudio(): void {
    this.audioCtx = wx.createInnerAudioContext();

    this.audioCtx.onPlay(() => this.handlePlay());
    this.audioCtx.onTimeUpdate(() => this.checkBoundary());
    this.audioCtx.onEnded(() => this.handleNaturalEnded());
    this.audioCtx.onError((err) => {
      const msg = String((err as any)?.errMsg || '');
      // stop/pause 等操作失败属于良性噪音（如音频已自然结束后再 stop，
      // 真机会异步触发 onError）。不能当作播放失败传播，
      // 否则引擎会误跳句、与延时切句叠加形成死循环。
      if (msg.indexOf('stop audio') >= 0 || msg.indexOf('pause audio') >= 0) {
        console.warn('[SegmentAudioPlayer] 忽略音频操作失败:', err);
        return;
      }
      console.error('[SegmentAudioPlayer] 播放出错:', err);
      this.state = 'idle';
      this.clearTimers();
      this.errorHandler(err);
    });
  }

  /** 销毁当前实例并重建（本地文件重载开销极小） */
  private rebuildAudio(): void {
    try {
      this.audioCtx.destroy();
    } catch (e) { /* 销毁异常忽略，继续重建 */ }
    this.attachAudio();
  }

  /** 注册"当前任务播放完毕"回调（整文件播完或最后一段到达终点） */
  public onEnded(cb: () => void): void {
    this.endedHandler = cb;
  }

  /** 注册播放出错回调 */
  public onError(cb: (err: any) => void): void {
    this.errorHandler = cb;
  }

  public get isPlaying(): boolean {
    return this.state === 'playing';
  }

  /**
   * 播放一个音频任务：从首个片段的起点（或整文件 0）原生起播。
   */
  public play(task: AudioTask): void {
    const segments = task.segments && task.segments.length > 0 ? task.segments : null;
    this.task = segments ? { url: task.url, segments } : { url: task.url };
    this.segIndex = 0;
    this.endedNotified = false;
    this.startFrom(segments ? segments[0].start : 0);
  }

  /** 暂停（记录位置，恢复时续播） */
  public pause(): void {
    if (this.state === 'playing' || this.state === 'loading') {
      this.resumeAt = this.audioCtx.currentTime;
      this.audioCtx.pause();
      this.state = 'paused';
    }
  }

  /** 从暂停位置恢复（startTime 设为暂停点：平台无论是否应用该值结果都正确） */
  public resume(): void {
    if (this.state === 'paused') {
      const at = this.resumeAt ?? this.audioCtx.currentTime;
      if (at > 0) this.audioCtx.startTime = at;
      this.audioCtx.play();
      this.state = 'playing';
      this.resumeAt = null;
    }
  }

  /** 停止并复位 */
  public stop(): void {
    this.clearTimers();
    // idle 状态（从未播放或已自然结束）下原生音频无可停止，
    // 真机会报 operateAudio:fail:stop audio fail
    if (this.state !== 'idle') {
      this.audioCtx.stop();
    }
    this.audioCtx.startTime = 0;
    this.state = 'idle';
    this.task = null;
    this.resumeAt = null;
    this.endedNotified = false;
  }

  public destroy(): void {
    this.stop();
    this.audioCtx.destroy();
  }

  // ==================== 内部：定位与播放 ====================

  /**
   * 从指定位置开始播放：重建实例 → startTime → src → play。
   * startTime 必须在 src 赋值之后再设置（src 赋值可能将其重置为 0），
   * 重设 src 前也先设一次兜底。本地文件重载开销极小。
   */
  private startFrom(start: number, isRetry = false): void {
    if (!this.task) return;
    if (!isRetry) this.startRetried = 0;
    this.clearTimers();

    // 每次起播都重建音频实例，规避"同 src 二次赋值被忽略导致静默卡死"
    this.rebuildAudio();
    this.audioCtx.startTime = start;
    this.audioCtx.src = this.task.url;
    this.audioCtx.startTime = start;
    this.state = 'loading';
    this.audioCtx.play();

    this.armWatchdog();
    // 快速校验：起播后 400ms 检查 startTime 是否生效，未生效立即 seek 补救
    this.quickCheck = setTimeout(() => this.verifyStart(), 400);
  }

  /** 起播快速校验：startTime 被忽略（仍在文件头部）则播放中 seek 补救 */
  private verifyStart(): void {
    this.quickCheck = null;
    const segments = this.task?.segments;
    if (!segments || this.state !== 'playing') return;

    const cur = segments[this.segIndex];
    const t = this.audioCtx.currentTime;
    // 已进入本片段有效区域：startTime 生效，无需处理
    if (t >= cur.start - 1.5 && t <= cur.end + 2) return;
    // 离目标区间太远（从头播 / 从上次停止位置续播 / 超前）：
    // startTime 未生效，播放中 seek 补救
    if (this.startRetried === 0) {
      console.warn('[SegmentAudioPlayer] startTime 未生效，播放中 seek 补救:',
        `start=${cur.start}`, `current=${t}`);
      this.startRetried = 1;
      this.audioCtx.seek(cur.start);
    }
  }

  /** 起点看门狗：1.5s 内未进入本片段区域则依次 seek 补救 → 重设 src → 跳过 */
  private armWatchdog(): void {
    if (this.startWatchdog !== null) {
      clearTimeout(this.startWatchdog);
    }
    this.startWatchdog = setTimeout(() => {
      this.startWatchdog = null;
      const segments = this.task?.segments;

      // 音频迟迟未起播（无 onPlay、无 onError 的静默失败）：
      // 重建再试一次；仍失败则通知结束跳过，绝不能让引擎永久卡死
      if (this.state === 'loading') {
        if (this.startRetried < 3) {
          console.warn('[SegmentAudioPlayer] 起播超时，重建实例重试');
          this.startRetried += 1;
          const start = segments ? segments[this.segIndex].start : 0;
          this.startFrom(start, true);
        } else {
          console.warn('[SegmentAudioPlayer] 起播重试仍失败，跳过当前任务');
          this.state = 'idle';
          this.notifyEnded();
        }
        return;
      }

      if (!segments || this.state !== 'playing') return;

      const cur = segments[this.segIndex];
      const t = this.audioCtx.currentTime;
      // 已进入本片段有效区域：播放正常
      if (t >= cur.start - 1.5 && t <= cur.end + 2) return;

      if (this.startRetried === 0) {
        // 第一层：播放中 seek（此时音频已激活，seek 最可靠）
        console.warn('[SegmentAudioPlayer] 起点未生效，播放中 seek 补救:',
          `start=${cur.start}`, `current=${t}`);
        this.startRetried = 1;
        this.audioCtx.seek(cur.start);
        this.armWatchdog();
      } else if (this.startRetried === 1) {
        // 第二层：重设 src + startTime 重新起播
        console.warn('[SegmentAudioPlayer] seek 补救无效，重设 src 重试:',
          `start=${cur.start}`, `current=${t}`);
        this.startRetried = 2;
        this.startFrom(cur.start, true);
      } else {
        console.warn('[SegmentAudioPlayer] 起点重试仍失败，跳过当前片段:',
          `start=${cur.start}`, `current=${t}`);
        this.audioCtx.pause();
        this.state = 'paused';
        this.notifyEnded();
      }
    }, 1500);
  }

  private clearTimers(): void {
    if (this.quickCheck !== null) {
      clearTimeout(this.quickCheck);
      this.quickCheck = null;
    }
    if (this.startWatchdog !== null) {
      clearTimeout(this.startWatchdog);
      this.startWatchdog = null;
    }
  }

  // ==================== 内部事件处理 ====================

  private handlePlay(): void {
    if (this.state === 'loading' || this.state === 'paused') {
      this.state = 'playing';
    }
    this.resumeAt = null;
  }

  /** 旧结构整文件自然播完 */
  private handleNaturalEnded(): void {
    if (this.task?.segments) {
      // 分段模式由边界检测收尾，不应走到这里，忽略（防重复通知）
      return;
    }
    this.notifyEnded();
    this.state = 'idle';
  }

  /** onTimeUpdate：检测当前段是否播到终点 */
  private checkBoundary(): void {
    const segments = this.task?.segments;
    if (!segments || this.state !== 'playing') return;

    const t = this.audioCtx.currentTime;
    const cur = segments[this.segIndex];

    // 起点尚未生效（仍在片段之前的区域播放）：交由看门狗重试
    if (t < cur.start - 1.5) return;
    // 已进入本片段区域：播放正常，解除看门狗
    this.clearTimers();
    // 位置异常超前：忽略
    if (t > cur.end + 2) return;

    if (t < cur.end - 0.05) return;

    if (this.segIndex < segments.length - 1) {
      // 段间跳转（如英文快/慢速两段）：从下一段起点重新起播
      this.segIndex += 1;
      this.startFrom(segments[this.segIndex].start);
    } else {
      // 全部片段播完：停在末尾，通知引擎（引擎随后会下发下一个任务）
      this.audioCtx.pause();
      this.state = 'paused';
      this.notifyEnded();
    }
  }

  private notifyEnded(): void {
    if (this.endedNotified) return;
    this.endedNotified = true;
    this.endedHandler();
  }
}
