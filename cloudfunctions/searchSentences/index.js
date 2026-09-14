const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const MAX_RESULTS = 30
const MAX_VISIBLE_BOOKS = 200 // 简化处理：假设用户可见词书数量不会大到需要再分页
const IN_CHUNK_SIZE = 20 // command.in() 单次数组长度上限，超过要分片查询

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size))
  }
  return out
}

/**
 * 跨词书搜索句子（中文或英文，模糊、大小写不敏感）
 *
 * 注意：只在"当前用户可见的词书"范围内搜索——
 * 即自己的词书 + 公共词书，不会搜到别人的私有词书内容，
 * 逻辑和 getBooks 云函数保持一致。
 *
 * MVP 版本用的是正则匹配，数据量大了以后建议换成
 * 云开发的全文检索能力或者自建分词索引。
 */
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const keyword = ((event && event.keyword) || '').trim()

  if (!keyword) {
    return { code: 0, msg: 'success', data: [] }
  }

  try {
    const bookRes = await db.collection('book')
      .where({
        openid: _.or([_.eq(OPENID), _.exists(false), _.eq(''), _.eq(null)])
      })
      .limit(MAX_VISIBLE_BOOKS)
      .get()

    const bookMap = new Map()
    bookRes.data.forEach(b => bookMap.set(b._id, b.name))

    const visibleBookIds = Array.from(bookMap.keys())
    if (visibleBookIds.length === 0) {
      return { code: 0, msg: 'success', data: [] }
    }

    const re = db.RegExp({ regexp: escapeRegExp(keyword), options: 'i' })

    const bookIdChunks = chunk(visibleBookIds, IN_CHUNK_SIZE)
    const tasks = bookIdChunks.map(ids =>
      db.collection('sentence')
        .where(
          _.and([
            { bookId: _.in(ids) },
            _.or([{ en: re }, { zh: re }])
          ])
        )
        .limit(MAX_RESULTS)
        .get()
    )

    const results = await Promise.all(tasks)
    const merged = results.reduce((acc, cur) => acc.concat(cur.data || []), [])

    const data = merged
      .slice(0, MAX_RESULTS)
      .map(s => ({ ...s, bookName: bookMap.get(s.bookId) || '' }))

    return { code: 0, msg: 'success', data }
  } catch (err) {
    console.error('[searchSentences] 搜索失败:', err)
    return { code: 500, msg: '搜索失败', error: err }
  }
}
