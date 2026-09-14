const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 创建词书（服务端统一处理，替代原来客户端直接写 db.collection('books') 的方式）
 */
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { name, type = 'sentence' } = event || {}

  const bookName = (name || '').trim()
  if (!bookName) {
    return { code: 400, msg: '词书名称不能为空' }
  }

  try {
    // 避免用户手抖重复点击 / 网络重试导致创建出多本同名词书
    const existed = await db.collection('book')
      .where({ openid: OPENID, name: bookName, type })
      .limit(1)
      .get()

    if (existed.data.length > 0) {
      return { code: 0, msg: 'success', data: existed.data[0] }
    }

    const now = Date.now()
    const addRes = await db.collection('book').add({
      data: {
        name: bookName,
        type,
        openid: OPENID,
        createdAt: now
      }
    })

    return {
      code: 0,
      msg: 'success',
      data: {
        _id: addRes._id,
        name: bookName,
        type,
        openid: OPENID,
        createdAt: now
      }
    }
  } catch (err) {
    console.error('[createBook] 创建词书失败:', err)
    return { code: 500, msg: '创建词书失败', error: err }
  }
}
