const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 录入一条新句子。
 *
 * 规则（对应产品侧的约定）：
 * - 不管用户在录入页选的是哪本词书，句子的物理内容永远存进
 *   当前用户的默认库 `origin_${openid}`（"用户句子"）。
 * - 如果选的不是默认库本身，再额外建一条 sentenceBookRef 引用，
 *   让这句话"看起来"出现在用户选的那本词书里。
 * - 这两步放在同一个事务里：要么都成功，要么都不成功，
 *   不会出现"句子存进去了，但引用没建上，用户在目标词书里看不到"的半吊子状态。
 *
 * 权限：目标词书必须是当前用户自己的（openid 匹配），
 * 系统/公共词书（openid 为空）不允许作为录入目标。
 */
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { bookId, en, zh, audio, audio_zh } = event || {}

  if (!bookId) {
    return { code: 400, msg: 'bookId 不能为空' }
  }
  if (!en || !zh) {
    return { code: 400, msg: '中英文内容不能为空' }
  }

  if (!OPENID) {
    return { code: 400, msg: 'openid 不能为空' }
  }

  const originBookId = `origin_${OPENID}`

  // 校验目标词书确实是当前用户自己的，且已初始化过默认库
  if (bookId !== originBookId) {
    const bookDoc = await db.collection('book').doc(bookId).get().catch(() => null)
    const book = bookDoc && bookDoc.data
    if (!book || book.openid !== OPENID) {
      return { code: 403, msg: '无权在该词书中录入句子' }
    }
  }

  const transaction = await db.startTransaction()

  try {
    const now = Date.now()

    const addRes = await transaction.collection('sentence').add({
      data: {
        bookId: originBookId, // 物理归属永远是"用户句子"
        en,
        zh,
        audio: audio || '',
        audio_zh: audio_zh || '',
        createdAt: now
      }
    })

    const sentenceId = addRes._id

    // 录入的目标不是默认库本身时，补一条引用，让句子出现在用户选的那本词书里
    if (bookId !== originBookId) {
      const refId = `${bookId}__${sentenceId}`
      await transaction.collection('sentenceBookRef').add({
        data: {
          _id: refId,
          bookId,
          sentenceId,
          openid: OPENID,
          addedAt: now
        }
      })
    }

    await transaction.commit()

    return { code: 0, msg: 'success', data: { sentenceId } }
  } catch (err) {
    await transaction.rollback()
    console.error('[createSentence] 保存句子失败:', err)
    return { code: 500, msg: '保存失败，请重试', error: err }
  }
}
