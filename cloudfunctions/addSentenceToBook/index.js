const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 把一个已存在的句子（可能是系统例句，也可能是别的词书里的句子）
 * "加入"到当前用户自己的某本词书。
 *
 * 关键设计：不复制句子内容，只在 sentenceBookRef 表里建一条引用关系。
 * 这样：
 * - 原句子的文本/音频只有一份，不会因为被多个词书引用而冗余；
 * - 学习进度/收藏状态挂在 sentenceMark 上（openid + sentenceId），
 *   跟句子在哪本词书里出现无关，天然支持"同一句话出现在多本词书"。
 *
 * _id 用 `${bookId}__${sentenceId}` 做主键，重复加入会被 set() 自动去重覆盖，
 * 不会插出多条重复引用。
 */
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { sentenceId, bookId } = event || {}

  if (!sentenceId || !bookId) {
    return { code: 400, msg: 'sentenceId / bookId 不能为空' }
  }

  try {
    // 1. 校验目标词书存在，且属于当前用户
    //    （不允许往别人的词书、或公共词书里随便塞句子）
    const bookDoc = await db.collection('book').doc(bookId).get().catch(() => null)
    const book = bookDoc && bookDoc.data
    if (!book) {
      return { code: 404, msg: '词书不存在' }
    }
    if (book._openid && book._openid !== OPENID) {
      return { code: 403, msg: '无权操作该词书' }
    }

    // 2. 校验句子存在
    const sentenceDoc = await db.collection('sentence').doc(sentenceId).get().catch(() => null)
    if (!sentenceDoc || !sentenceDoc.data) {
      return { code: 404, msg: '句子不存在' }
    }

    // 3. 如果句子本来就直接归属这本词书，不需要再建引用
    if (sentenceDoc.data.bookId === bookId) {
      return { code: 0, msg: 'success', data: { refId: '', alreadyIn: true } }
    }

    const refId = `${bookId}__${sentenceId}`
    await db.collection('sentenceBookRef').doc(refId).set({
      data: {
        bookId,
        sentenceId,
        _openid: OPENID,
        addedAt: Date.now()
      }
    })

    return { code: 0, msg: 'success', data: { refId } }
  } catch (err) {
    console.error('[addSentenceToBook] 加入词书失败:', err)
    return { code: 500, msg: '加入词书失败', error: err }
  }
}
