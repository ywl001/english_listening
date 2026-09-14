const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { bookId } = event

  if (!bookId) {
    return { code: 400, msg: '缺少 bookId' }
  }

  try {
    const result = await db.runTransaction(async transaction => {
      // 1. 查询书籍，并确认属于当前用户
      const bookRes = await transaction.collection('book')
        .where({
          _id: bookId,
          openid: OPENID
        })
        .get()

      if (bookRes.data.length === 0) {
        throw new Error('书籍不存在或无权删除')
      }

      // 2. 删除收藏记录
      const favoriteRes = await transaction.collection('sentenceFavorite')
        .where({
          bookid: bookId,
          openid: OPENID
        })
        .remove()

      // 3. 删除书籍
      await transaction.collection('book')
        .doc(bookId)
        .remove()

      return {
        favoriteCount: favoriteRes.stats.removed
      }
    })

    return {
      code: 0,
      msg: '删除成功',
      data: result
    }
  } catch (err) {
    console.error(err)

    return {
      code: 500,
      msg: err.message || '删除失败',
      data: null
    }
  }
}