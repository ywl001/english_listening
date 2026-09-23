const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { bookId, en, zh, audio, audio_zh } = event || {}

  if (!bookId) return { code: 400, msg: 'bookId 不能为空' }
  if (!en || !zh) return { code: 400, msg: '中英文内容不能为空' }
  if (!OPENID) return { code: 400, msg: '_openid 不能为空' }

  //我的句子book._id
  const originBookId = `origin_${OPENID}`

  if (bookId !== originBookId) {
    try {
      const book = (await db.collection('book').doc(bookId).get()).data
      if (!book || book._openid !== OPENID) return { code: 403, msg: '无权在该词书中录入句子' }
    } catch (err) {
      return { code: 403, msg: '目标词书不存在或无权限操作' }
    }
  }

  const transaction = await db.startTransaction()

  try {
    const now = Date.now()

    let s = {
      bookId: originBookId,
      en,
      zh,
      audio: audio || '',
      audio_zh: audio_zh || '',
      createdAt: now,
      _openid: OPENID,
    }

    const { _id: sentenceId } = await transaction.collection('sentence').add({
      data: s
    })

    if (bookId !== originBookId) {
      s.favorites = [bookId]
      await transaction.collection('sentenceFavorite').add({
        data: {
          _id: `${OPENID}__${sentenceId}`,
          bookId,
          sentenceId,
          _openid: OPENID,
          updatedAt: now,
          deleted: false
        }
      })
    }
    s.mark = null;

    await transaction.commit()
    return { code: 0, msg: 'success', data: s}
  } catch (err) {
    await transaction.rollback().catch(() => {})
    console.error('[createSentence] 保存句子失败:', err)
    return { code: 500, msg: '保存失败，请重试', error: err }
  }
}