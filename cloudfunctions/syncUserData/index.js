const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command

const PAGE = 100        // 云函数端单批上限
const MAX_BATCHES = 20  // 单次调用最多拉 20 批（2000 条），防止云函数超时

exports.main = async (event) => {
  const { collection } = event;
  if (!collection) {
    throw new Error('collection 不能为空')
  }
  const { OPENID } = cloud.getWXContext()
  let cursor = Number(event.cursor) || 0
  const list = []
  let batches = 0
  let lastFull = false

  while (batches < MAX_BATCHES) {
    const res = await db.collection(collection)
      // 与客户端版同一套逻辑：gte 游标 + 边界重复由 mergeFavs 去重
      .where({
        _openid: OPENID,
        updatedAt: _.gte(cursor)
      })
      .orderBy('updatedAt', 'asc')
      .limit(PAGE)
      .get()

    if (!res.data.length) {
      lastFull = false
      break
    }

    list.push(...res.data)
    cursor = res.data[res.data.length - 1].updatedAt
    batches++

    if (res.data.length < PAGE) {
      lastFull = false
      break
    }
    lastFull = true
  }

  return {
    list,
    cursor,
    // 达到批次上限且最后一批还是满的 → 还有数据，客户端继续拉
    hasMore: batches >= MAX_BATCHES && lastFull
  }
}