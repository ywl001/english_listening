const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { sentenceId, bookId = '', patch = {} } = event

  if (!sentenceId) {
    return { success: false, error: 'sentenceId 不能为空' }
  }

  const collection = db.collection('sentenceMark')
  const id = `${OPENID}__${sentenceId}`
  const now = Date.now()

  try {
    // 先查询当前记录是否存在，以保持默认字段的完整性（仅在首次创建时填入默认值）
    // 或者利用 update 的结果结合 set
    const updateRes = await collection.doc(id).update({
      data: {
        ...patch,
        updatedAt: now
      }
    })

    // 如果更新成功，直接返回
    if (updateRes.stats && updateRes.stats.updated > 0) {
      return { success: true, id, action: 'update' }
    }
  } catch (err) {
    // 如果报错是因为 doc 不存在，捕获异常后走新建逻辑，不要直接 throw 挂掉
  }

  // 记录不存在，执行 set 创建，保证默认值全量写入
  await collection.doc(id).set({
    data: {
      _id: id,
      sentenceId,
      bookId,
      openid: OPENID,
      favorite: false,
      stage: 0,
      nextReviewAt: 0,
      createdAt: now,
      updatedAt: now,
      ...patch // 传入的 patch 会覆盖上面的默认值
    }
  })

  return { success: true, id, action: 'create' }
}