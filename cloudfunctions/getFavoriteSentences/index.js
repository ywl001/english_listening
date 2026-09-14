const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command
const MAX_LIMIT = 100
const STORAGE_PREFIX = 'cloud://cloud1-d0gyvvq93ab34b8b7.636c-cloud1-d0gyvvq93ab34b8b7-1333600691/'

// 补全 cloud:// 完整路径
function toFullFileId(path) {
  if (!path) return ''
  if (path.startsWith('cloud://') || path.startsWith('http')) return path
  const cleanPath = path.startsWith('/') ? path.substring(1) : path
  return `${STORAGE_PREFIX}${cleanPath}`
}

// 分批将 cloud:// 文件 ID 批量转成临时 HTTPS URL（限制每批 50 条）
async function getAudioUrls(list, batchSize = 50) {
  const ids = [...new Set(
    list.flatMap(x => [x.audio, x.audio_zh])
      .filter(x => typeof x === 'string' && x.startsWith('cloud://'))
  )]

  if (!ids.length) return list

  // 分批切片
  const chunks = []
  for (let i = 0; i < ids.length; i += batchSize) {
    chunks.push(ids.slice(i, i + batchSize))
  }

  // 并发转换所有批次
  const resArray = await Promise.all(
    chunks.map(fileList => cloud.getTempFileURL({ fileList }))
  )

  // 建立全局映射表
  const map = new Map()
  resArray.forEach(res => {
    (res.fileList || []).forEach(x => {
      if (x.status === 0) {
        map.set(x.fileID, x.tempFileURL)
      }
    })
  })

  // 重新映射返回数据
  return list.map(x => ({
    ...x,
    audio: map.get(x.audio) || x.audio || '',
    audio_zh: map.get(x.audio_zh) || x.audio_zh || ''
  }))
}

exports.main = async event => {
  const { OPENID } = cloud.getWXContext()
  const {
    bookId,
    cursor = null, // { lastCreatedAt, lastId }
    targetCount = 20
  } = event

  if (!bookId) {
    return {
      code: -1,
      msg: '缺少必要的 bookId 参数',
      data: null
    }
  }

  const count = Math.min(Math.max(Number(targetCount) || 20, 1), MAX_LIMIT)

  try {
    // 1. 构造 sentenceFavorite 的查询条件
    let where = {
      openid: OPENID,
      bookId: bookId
    }

    // 游标分页
    if (typeof cursor?.lastCreatedAt === 'number' && cursor.lastId) {
      where = _.and([
        where,
        _.or([
          { createdAt: _.lt(cursor.lastCreatedAt) },
          {
            createdAt: _.eq(cursor.lastCreatedAt),
            _id: _.lt(cursor.lastId)
          }
        ])
      ])
    }

    // 2. 查询收藏关联表（多取 1 条判断 hasMore）
    const favRes = await db.collection('sentenceFavorite')
      .where(where)
      .orderBy('createdAt', 'desc')
      .orderBy('_id', 'desc')
      .limit(Math.min(count + 1, MAX_LIMIT))
      .get()

    const favList = favRes.data || []
    const hasMore = favList.length > count
    const validFavs = favList.slice(0, count)

    if (!validFavs.length) {
      return {
        code: 0,
        msg: 'success',
        data: {
          list: [],
          nextCursor: cursor,
          hasMore: false
        }
      }
    }

    // 3. 提取 sentenceId 数组并批量拉取 sentence 物理表数据
    const sentenceIds = [...new Set(validFavs.map(x => x.sentenceId).filter(Boolean))]
    
    const [sentenceRes, markRes] = await Promise.all([
      sentenceIds.length ? db.collection('sentence').where({
        _id: _.in(sentenceIds)
      }).limit(MAX_LIMIT).get() : { data: [] },

      sentenceIds.length ? db.collection('sentenceMark').where({
        openid: OPENID,
        bookId: bookId,
        sentenceId: _.in(sentenceIds)
      }).limit(MAX_LIMIT).get() : { data: [] }
    ])

    const sentenceMap = new Map((sentenceRes.data || []).map(x => [x._id, x]))
    const markMap = new Map((markRes.data || []).map(x => [x.sentenceId, x]))

    // 4. 组装数据并保持顺序
    let rawList = validFavs.map(fav => {
      const sentence = sentenceMap.get(fav.sentenceId)
      if (!sentence) {
        console.warn('sentenceFavorite 对应的 sentence 不存在:', fav.sentenceId)
        return null
      }

      const mark = markMap.get(fav.sentenceId) || null

      return {
        ...sentence,
        favCreatedAt: fav.createdAt,
        mark,
        isFavorite: true
      }
    }).filter(Boolean)

    // 5. 补全路径并安全分批转换临时 URL
    rawList = rawList.map(item => ({
      ...item,
      audio: toFullFileId(item.audio),
      audio_zh: toFullFileId(item.audio_zh)
    }))

    const finalReadList = await getAudioUrls(rawList, 50)

    // 6. 计算下一页游标
    const lastFav = validFavs[validFavs.length - 1]
    const nextCursor = {
      lastCreatedAt: lastFav.createdAt || 0,
      lastId: lastFav._id
    }

    return {
      code: 0,
      msg: 'success',
      data: {
        list: finalReadList,
        nextCursor,
        hasMore
      }
    }

  } catch (err) {
    console.error('getFavoriteSentences 云函数异常:', err)

    return {
      code: -1,
      msg: err.message || '数据库查询或云函数异常',
      error: String(err)
    }
  }
}