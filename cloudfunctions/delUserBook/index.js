const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const PAGE = 100
const STORAGE_PREFIX = 'cloud://cloud1-d0gyvvq93ab34b8b7.636c-cloud1-d0gyvvq93ab34b8b7-1333600691/'

function toFullFileId(path) {
  if (!path || typeof path !== 'string') return ''
  if (path.startsWith('cloud://') || path.startsWith('http')) return path
  return STORAGE_PREFIX + path.replace(/^\//, '')
}

async function countOf(collection, where) {
  const res = await db.collection(collection).where(where).count()
  return res.total || 0
}

async function fetchAll(collection, where, field) {
  const result = []
  let skip = 0
  while (true) {
    let q = db.collection(collection).where(where).skip(skip).limit(PAGE)
    if (field) q = q.field(field)
    const res = await q.get()
    result.push(...res.data)
    if (res.data.length < PAGE) break
    skip += PAGE
  }
  return result
}

// 按 sentenceId 分批删除关联集合（规避 in 查询条目上限）
async function removeBySentenceIds(collection, sentenceIds) {
  for (let i = 0; i < sentenceIds.length; i += 100) {
    await db.collection(collection)
      .where({ sentenceId: _.in(sentenceIds.slice(i, i + 100)) })
      .remove()
  }
}

/**
 * 删除用户词书（两阶段提交）：
 * - confirm=false：返回统计信息（句子数/收藏数）供前端提示
 * - confirm=true：执行删除
 *
 * 按书类型分别处理：
 * - 引用书（type=ref）：删除该书所有收藏记录（refBookId 维度），句子本体不动
 * - 实体书（我的句子/自定义书）：删除书内句子 + 其他书对这些句子的收藏/学习记录 + 音频文件
 *
 * 注意：引用关系统一存在 sentenceFavorite（refBookId 字段指向引用书），无独立引用集合。
 */
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { bookId, confirm = false } = event || {}

  if (!bookId) return { code: 400, msg: '缺少 bookId' }

  try {
    // 1. 校验词书存在且属于当前用户
    const bookDoc = await db.collection('book').doc(bookId).get().catch(() => null)
    const book = bookDoc && bookDoc.data
    if (!book) return { code: 404, msg: '词书不存在' }
    if (book._openid !== OPENID) return { code: 403, msg: '无权删除该词书' }

    const isRef = book.type === 'ref'

    // 2. 统计删除影响范围
    let sentenceCount = 0
    let favoriteCount = 0
    let sentences = []

    // 该书夹子里的有效收藏数（所有书类型通用）
    favoriteCount = await countOf('sentenceFavorite', { refBookId: bookId, deleted: false })

    if (!isRef) {
      sentences = await fetchAll('sentence', { bookId }, { audio: true, audio_zh: true })
      sentenceCount = sentences.length

      // 书内句子被其他词书收藏的次数（排除本书自己的收藏，避免重复计数）
      const sentenceIds = sentences.map(s => s._id)
      for (let i = 0; i < sentenceIds.length; i += 100) {
        const ids = sentenceIds.slice(i, i + 100)
        favoriteCount += await countOf('sentenceFavorite', { sentenceId: _.in(ids), refBookId: _.neq(bookId), deleted: false })
      }
    }

    // 3. 未确认 → 只返回统计，绝不执行删除（空书也不允许穿透）
    if (!confirm) {
      return { code: 0, msg: 'success', data: { needConfirm: (sentenceCount + favoriteCount) > 0, sentenceCount, favoriteCount } }
    }

    // 4. 执行删除
    let fileList = []

    // 4.1 这本书夹子里的收藏记录（所有书类型通用）
    await db.collection('sentenceFavorite').where({ refBookId: bookId }).remove()

    if (!isRef) {
      const sentenceIds = sentences.map(s => s._id)

      // 4.2 其他词书对这些句子的收藏 / 学习记录
      await removeBySentenceIds('sentenceFavorite', sentenceIds)
      await removeBySentenceIds('sentenceMark', sentenceIds)

      // 4.3 句子本体
      await db.collection('sentence').where({ bookId }).remove()

      // 4.4 音频文件
      fileList = sentences.flatMap(s => [toFullFileId(s.audio), toFullFileId(s.audio_zh)]).filter(Boolean)
    }

    // 4.5 词书本体（最后删，中途失败可重试）
    await db.collection('book').doc(bookId).remove()

    if (fileList.length) {
      try {
        await cloud.deleteFile({ fileList })
      } catch (e) {
        console.warn('[delUserBook] 音频清理失败:', e)
      }
    }

    return {
      code: 0,
      msg: '删除成功',
      data: { deleted: true, sentenceCount, favoriteCount }
    }
  } catch (err) {
    console.error('[delUserBook] 删除词书失败:', err)
    return { code: 500, msg: err.message || '删除失败', data: null }
  }
}
