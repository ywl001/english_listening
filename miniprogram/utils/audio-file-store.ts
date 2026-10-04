
/**
 * 整本书共用音频的本地缓存（FileSystemManager）：
 *
 * 新结构的 audioUrl 是每个 audioGroup 一个大 mp3，播放时需要频繁 seek。
 * 网络流 seek 会触发重新缓冲（模拟器/部分机型卡顿严重且不一致），
 * 因此首次使用时通过 wx.cloud.downloadFile 下载到本地，之后所有
 * seek 都在本地文件上进行——即时且精确，各平台行为一致。
 *
 * - 缓存 key 使用 DB 中的原始相对路径（如 english/日常/01-1.mp3），
 *   跨会话稳定（临时 URL 每次转换都不同，不能做 key）
 * - 本地路径由 key 确定性派生，accessSync 命中即免下载
 * - 下载中并发去重，同一文件只下载一次
 */
class AudioFileStore {
  private dir = `${wx.env.USER_DATA_PATH}/audio`
  private ensured = false
  private pending = new Map<string, Promise<string>>()

  private fs(): WechatMiniprogram.FileSystemManager {
    return wx.getFileSystemManager()
  }

  private ensureDir(): void {
    if (this.ensured) return
    try {
      this.fs().accessSync(this.dir)
    } catch (e) {
      try {
        this.fs().mkdirSync(this.dir, true)
      } catch (err) {
        console.error('[AudioFileStore] 创建目录失败:', err)
      }
    }
    this.ensured = true
  }

  /**
   * 原始相对路径 -> 本地文件路径（确定性派生，可用 accessSync 探测）。
   * 文件名使用 key 的 FNV-1a 哈希：部分平台（如开发者工具）把本地路径当
   * URL 解析，中文等非 ASCII 文件名会导致 "Unable to decode audio data"。
   */
  private localPath(key: string): string {
    let hash = 0x811c9dc5
    for (let i = 0; i < key.length; i++) {
      hash ^= key.charCodeAt(i)
      hash = (hash * 0x01000193) >>> 0
    }
    const ext = (key.match(/\.(\w+)$/) || [])[1] || 'mp3'
    return `${this.dir}/${hash.toString(16)}.${ext.toLowerCase()}`
  }

  /**
   * 获取音频的本地路径；未缓存则下载后落盘。
   * @param key    稳定标识（DB 中的相对路径）
   * @param fileID 完整 cloud:// fileID
   * @returns 本地文件路径；落盘失败时返回下载临时路径（本次会话可用）
   */
  public async ensure(key: string, fileID: string): Promise<string> {
    this.ensureDir()
    const path = this.localPath(key)
    try {
      this.fs().accessSync(path)
      return path
    } catch (e) {
      // 未缓存，走下载
    }

    const inflight = this.pending.get(key)
    if (inflight) return inflight

    const p = (async () => {
      const res = await wx.cloud.downloadFile({ fileID })
      try {
        // 落盘持久化（temp 路径重启后可能被系统清理）
        this.fs().saveFileSync(res.tempFilePath, path)
        return path
      } catch (err) {
        console.warn('[AudioFileStore] 落盘失败，本次会话使用临时路径:', err)
        return res.tempFilePath
      }
    })().finally(() => this.pending.delete(key))

    this.pending.set(key, p)
    return p
  }
}

export default new AudioFileStore()
