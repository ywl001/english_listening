/**
 * 句子本地文件存储（FileSystemManager）：
 * - 每本书一个 JSON 文件：`${USER_DATA_PATH}/sentences/s_{bookId}.json`
 *   结构：{ list: Sentence[], updatedAt: number, v: number }
 * - 句子不可变（只有增/删，没有原地更新），因此用「条数对账」代替 createdAt 水位线：
 *   打开书时只需一次 count 查询，本地条数 == 云端条数即视为已最新，毫秒级返回
 * - 不一致（远端增删/版本升级）才全量重拉：并发分页（skip/limit）
 */
export interface SentenceFileData {
  list: Sentence[]
  updatedAt: number
  /** 文件结构版本：v<2 曾按 PAGE=100 分页被客户端 20 条上限截断，强制全量重刷 */
  v?: number
}

// 云函数端单页条数（服务端 .get() 上限 100）
const CLOUD_PAGE = 100
// 全量分页拉取的并发数（微信并发网络请求上限 10）
const CONCURRENCY = 10
// 缓存结构版本：v<2 曾按 PAGE=100 分页被客户端 20 条上限截断；
// v=3 起走 syncSentence 云函数拉取，audio 为公有读长期 URL 并附带原始 fileID
const SCHEMA_VERSION = 3

class SentenceFileStore {
  private dir = `${wx.env.USER_DATA_PATH}/sentences`
  private cache = new Map<string, SentenceFileData>()
  private syncing = new Map<string, Promise<SentenceFileData>>()
  private legacyCleaned = false

  constructor() {
    this.ensureDir()
    this.cleanLegacyKeys()
  }

  private fs(): WechatMiniprogram.FileSystemManager {
    return wx.getFileSystemManager()
  }

  private ensureDir(): void {
    const fs = this.fs()
    try {
      fs.accessSync(this.dir)
    } catch (e) {
      try {
        fs.mkdirSync(this.dir, true)
      } catch (err) {
        console.error('[SentenceFileStore] 创建目录失败:', err)
      }
    }
  }

  private filePath(bookId: string): string {
    return `${this.dir}/s_${bookId}.json`
  }

  private load(bookId: string): SentenceFileData | null {
    const cached = this.cache.get(bookId)
    if (cached) return cached
    try {
      const raw = this.fs().readFileSync(this.filePath(bookId), 'utf-8') as string
      const data = JSON.parse(raw) as SentenceFileData
      if (data && Array.isArray(data.list)) {
        this.cache.set(bookId, data)
        return data
      }
    } catch (e) {
      // 文件不存在或损坏：视为未同步，走全量
    }
    return null
  }

  private persist(bookId: string, data: SentenceFileData): void {
    this.cache.set(bookId, data)
    try {
      this.fs().writeFileSync(this.filePath(bookId), JSON.stringify(data), 'utf-8')
    } catch (e) {
      console.error('[SentenceFileStore] 写文件失败:', bookId, e)
    }
  }

  /** 读取某本书的全部句子（仅本地，不触发同步） */
  public getSentences(bookId: string): Sentence[] {
    return this.load(bookId)?.list || []
  }

  /**
   * 确保某本书数据可用（initManagerAndNavigate 打开书时调用）：
   * - 条数对账通过：一次 count 请求，直接返回本地数据（毫秒级）
   * - 对账不通过（远端有增删/版本升级/本地为空）：全量重拉（并发分页）
   * 并发去重：同一本书同时只跑一个同步
   */
  public async ensureReady(bookId: string): Promise<SentenceFileData> {
    const inflight = this.syncing.get(bookId)
    if (inflight) return inflight

    const p = this.sync(bookId).finally(() => this.syncing.delete(bookId))
    this.syncing.set(bookId, p)
    return p
  }

  private async sync(bookId: string): Promise<SentenceFileData> {
    const data = this.load(bookId)
    const db = wx.cloud.database()

    // 对账：一次 count 查询。句子不可变，条数一致即本地已最新
    const total = (await db.collection('sentence').where({ bookId }).count()).total || 0
    const stale = !data || (data.v || 0) < SCHEMA_VERSION || data.list.length !== total

    if (!stale && data) {
      console.log(`[SentenceFileStore] 对账通过 ${bookId}: 本地 ${data.list.length} = 云端 ${total}，跳过拉取`)
      return data
    }

    // 全量重拉：并发分页（orderBy _id 保证分页顺序稳定，Map 去重兜底拉取期间的数据变动）
    const list = await this.fetchAll(bookId, total)
    const next: SentenceFileData = { list, updatedAt: Date.now(), v: SCHEMA_VERSION }
    this.persist(bookId, next)
    console.log(`[SentenceFileStore] 全量同步 ${bookId}: 云端 ${total} 条, 拉到 ${list.length} 条`)
    return next
  }

  /**
   * 全量拉取：走 syncSentence 云函数（服务端单页 100 条 + 内网查询），
   * 相比客户端直连分页（单次上限 20 条）请求数量降到 1/5。
   * 云存储已设为所有用户可读：返回的 URL 长期有效，可直接落盘；
   * audioFileId/audioZhFileId 保留原始 cloud:// fileID（删文件等管理场景用）。
   */
  private async fetchAll(bookId: string, total: number): Promise<Sentence[]> {
    if (total === 0) return []

    const pages = Math.ceil(total / CLOUD_PAGE)
    const merged = new Map<string, Sentence>()
    for (let i = 0; i < pages; i += CONCURRENCY) {
      const tasks: Promise<{ list: Sentence[] }>[] = []
      const end = Math.min(i + CONCURRENCY, pages)
      for (let j = i; j < end; j++) {
        tasks.push(wx.cloud.callFunction({
          name: 'syncSentence',
          data: { bookId, cursor: j * CLOUD_PAGE, limit: CLOUD_PAGE }
        }).then((res: any) => {
          const result = res.result
          if (result && result.code === 0) return { list: (result.data && result.data.list) || [] }
          throw new Error((result && result.msg) || 'syncSentence error')
        }) as Promise<{ list: Sentence[] }>)
      }
      const results = await Promise.all(tasks)
      for (const r of results) {
        for (const s of r.list) merged.set(s._id, s)
      }
    }
    // createdAt 可能是 Date/数字/缺失，统一转时间戳比较
    const ts = (x: any): number => x instanceof Date ? x.getTime() : (typeof x === 'number' ? x : 0)
    return [...merged.values()].sort((a, b) => ts(a.createdAt) - ts(b.createdAt))
  }

  /** 从某本书的本地缓存中移除句子（删句事件时调用） */
  public removeSentence(bookId: string, sentenceId: string): void {
    if (!bookId) return
    const data = this.load(bookId)
    if (!data) return
    const idx = data.list.findIndex(s => s._id === sentenceId)
    if (idx === -1) return
    const list = [...data.list]
    list.splice(idx, 1)
    this.persist(bookId, { ...data, list, updatedAt: Date.now() })
  }

  /**
   * 写入/更新一个句子（创建句子事件时调用）：
   * 云端先落库（count 已包含新句子），本地同步追加保持条数对账一致
   */
  public upsertSentence(sentence: Sentence): void {
    if (!sentence || !sentence.bookId || !sentence._id) return
    const data = this.load(sentence.bookId) || { list: [], updatedAt: 0 }

    const list = [...data.list]
    const idx = list.findIndex(s => s._id === sentence._id)
    if (idx >= 0) {
      list[idx] = sentence
    } else {
      list.push(sentence)
      const ts = (x: any): number => x instanceof Date ? x.getTime() : (typeof x === 'number' ? x : 0)
      list.sort((a, b) => ts(a.createdAt) - ts(b.createdAt))
    }
    this.persist(sentence.bookId, { ...data, list, updatedAt: Date.now(), v: Math.max(data.v || 0, SCHEMA_VERSION) })
  }

  /** 删除整本书的本地文件（删书事件时调用） */
  public removeBook(bookId: string): void {
    this.cache.delete(bookId)
    try {
      this.fs().unlinkSync(this.filePath(bookId))
    } catch (e) {
      // 文件不存在，忽略
    }
  }

  /** 清理旧播放列表机制的遗留 storage key（只执行一次） */
  private cleanLegacyKeys(): void {
    if (this.legacyCleaned) return
    this.legacyCleaned = true
    try {
      const info = wx.getStorageInfoSync()
      for (const key of info.keys || []) {
        if (key.startsWith('sentence_watermark_') || key.startsWith('sentence_pending_')) {
          wx.removeStorageSync(key)
        }
      }
    } catch (e) {
      // 忽略
    }
  }
}

export default new SentenceFileStore()
