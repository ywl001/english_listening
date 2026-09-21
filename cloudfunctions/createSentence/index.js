const cloud = require('wx-server-sdk')
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})
const db = cloud.database()

exports.main = async (event) => {
  const {
    OPENID
  } = cloud.getWXContext()
  const {
    bookId,
    en,
    zh,
    audio,
    audio_zh
  } = event || {}

  if (!bookId) return {
    code: 400,
    msg: 'bookId 不能为空'
  }
  if (!en || !zh) return {
    code: 400,
    msg: '中英文内容不能为空'
  }
  if (!OPENID) return {
    code: 400,
    msg: '_openid 不能为空'
  }

  const originBookId = `origin_${OPENID}`

  // 1. 【事务外】先进行权限校验（异步读操作不占用事务时间）
  if (bookId !== originBookId) {
    try {
      const bookDoc = await db.collection('book').doc(bookId).get()
      const book = bookDoc && bookDoc.data
      if (!book || book._openid !== OPENID) {
        return {
          code: 403,
          msg: '无权在该词书中录入句子'
        }
      }
    } catch (err) {
      return {
        code: 403,
        msg: '目标词书不存在或无权限操作'
      }
    }
  }

  // 2. 校验通过后，再开启事务（确保事务内只有快速的纯写操作）
  const transaction = await db.startTransaction()

  try {
    const now = Date.now()

    // A. 插入主句子实体
    const addRes = await transaction.collection('sentence').add({
      data: {
        bookId: originBookId, // 物理归属永远是"用户句子"
        en,
        zh,
        audio: audio || '',
        audio_zh: audio_zh || '',
        createdAt: now,
        _openid: OPENID
      }
    })

    const sentenceId = addRes._id

    // B. 如果不是默认库，插入引用关系
    if (bookId !== originBookId) {
      const refId = `${OPENID}__${sentenceId}`
      await transaction.collection('sentenceFavorite').add({
        data: {
          _id: refId,
          bookId,
          sentenceId,
          _openid: OPENID,
          updatedAt: now,
          deleted: false
        }
      })
    }

    // C. 立即提交事务
    await transaction.commit()

    return {
      code: 0,
      msg: 'success',
      data: {
        sentenceId
      }
    }
  } catch (err) {
    // 出现异常才进行回滚
    await transaction.rollback().catch(() => {}) // 增加 catch 防止重复 rollback 报错
    console.error('[createSentence] 保存句子失败:', err)
    return {
      code: 500,
      msg: '保存失败，请重试',
      error: err
    }
  }
}