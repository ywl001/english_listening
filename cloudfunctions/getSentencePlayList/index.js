const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command
const MAX_LIMIT = 100
const STORAGE_PREFIX = 'cloud://cloud1-d0gyvvq93ab34b8b7.636c-cloud1-d0gyvvq93ab34b8b7-1333600691/'

// 1. 通用分批获取（突破数据库单次 100 条限制）
async function fetchAll(query, batchSize = 100) {
  const result = []
  let skip = 0

  while (true) {
    const res = await query.skip(skip).limit(batchSize).get()
    const data = res.data || []
    result.push(...data)
    if (data.length < batchSize) break
    skip += batchSize
  }

  return result
}

// 2. 批量获取并注入收藏状态 (突破 100 条查询限制)
async function attachFavorites(openid, bookId, list) {
  if (!list || list.length === 0) return list

  const sentenceIds = list.map(item => item._id).filter(Boolean)
  if (!sentenceIds.length) return list

  try {
    // 使用 fetchAll 替代普通 get，防止 sentenceIds 过多导致数据截断
    const favDocs = await fetchAll(
      db.collection('sentenceFavorite').where({
        openid: openid,
        sentenceId: _.in(sentenceIds)
      })
    )

    const favSet = new Set(favDocs.map(item => item.sentenceId))

    return list.map(item => ({
      ...item,
      isFavorite: favSet.has(item._id)
    }))
  } catch (err) {
    console.error('获取收藏状态失败:', err)
    return list.map(item => ({
      ...item,
      isFavorite: false
    }))
  }
}

// 3. 将 cloud:// 文件 ID 分批转成临时 URL（突破 getTempFileURL 50 条限制）
async function getAudioUrls(list) {
  // 提取去重后的 cloud:// 文件地址
  const ids = [...new Set(
    list.flatMap(x => [x.audio, x.audio_zh])
    .filter(x => typeof x === 'string' && x.startsWith('cloud://'))
  )]

  if (!ids.length) return list

  // 拆分为每组最多 50 个的二维数组
  const chunkedIds = []
  const CHUNK_SIZE = 50
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    chunkedIds.push(ids.slice(i, i + CHUNK_SIZE))
  }

  // 并行分批调用 getTempFileURL
  const map = new Map()
  await Promise.all(
    chunkedIds.map(async (chunk) => {
      try {
        const res = await cloud.getTempFileURL({ fileList: chunk })
        ;(res.fileList || []).forEach(x => {
          if (x.status === 0) {
            map.set(x.fileID, x.tempFileURL)
          }
        })
      } catch (err) {
        console.error('获取临时链接批处理失败:', err)
      }
    })
  )

  return list.map(x => ({
    ...x,
    audio: map.get(x.audio) || x.audio || '',
    audio_zh: map.get(x.audio_zh) || x.audio_zh || ''
  }))
}

// 获取到期复习句子
async function getReviewList(openid, bookId, cursor, targetCount) {
  const reviewCursor = cursor?.reviewCursor || null
  let where = {
    openid,
    bookId,
    nextReviewAt: _.lte(Date.now())
  }

  if (typeof reviewCursor?.lastNextReviewAt === 'number' && reviewCursor.lastId) {
    where = _.and([
      where,
      _.or([{
          nextReviewAt: _.gt(reviewCursor.lastNextReviewAt)
        },
        {
          nextReviewAt: _.eq(reviewCursor.lastNextReviewAt),
          _id: _.gt(reviewCursor.lastId)
        }
      ])
    ])
  }

  const res = await db.collection('sentenceMark')
    .where(where)
    .orderBy('nextReviewAt', 'asc')
    .orderBy('_id', 'asc')
    .limit(Math.min(targetCount + 1, MAX_LIMIT))
    .get()

  const marks = res.data || []
  const hasMore = marks.length > targetCount
  const validMarks = marks.slice(0, targetCount)

  if (!validMarks.length) {
    return {
      list: [],
      nextCursor: reviewCursor,
      hasMore
    }
  }

  const ids = validMarks.map(x => x.sentenceId).filter(Boolean)
  const sentenceRes = ids.length ?
    await db.collection('sentence').where({
      _id: _.in(ids)
    }).limit(MAX_LIMIT).get() : {
      data: []
    }

  const sentenceMap = new Map((sentenceRes.data || []).map(x => [x._id, x]))

  const list = validMarks.map(mark => {
    const sentence = sentenceMap.get(mark.sentenceId)

    if (!sentence) {
      console.warn('sentenceMark 对应的 sentence 不存在:', mark.sentenceId)
      return null
    }

    return {
      ...sentence,
      mark,
      isNew: false
    }
  }).filter(Boolean)

  const last = validMarks[validMarks.length - 1]

  return {
    list,
    nextCursor: {
      lastNextReviewAt: last.nextReviewAt,
      lastId: last._id
    },
    hasMore
  }
}

// 获取新句子
async function getNewSentenceList(openid, bookId, cursor, targetCount) {
  const newCursor = cursor?.newSentenceCursor || null

  if (targetCount <= 0) {
    return {
      list: [],
      nextCursor: newCursor,
      hasMore: false
    }
  }

  const marks = await fetchAll(
    db.collection('sentenceMark')
    .where({
      openid,
      bookId
    })
    .field({
      sentenceId: true
    })
  )

  const learnedIds = marks.map(x => x.sentenceId).filter(Boolean)
  let where = {
    bookId
  }

  if (learnedIds.length) where._id = _.nin(learnedIds)

  if (typeof newCursor?.lastCreatedAt === 'number' && newCursor.lastId) {
    where = _.and([
      where,
      _.or([{
          createdAt: _.gt(newCursor.lastCreatedAt)
        },
        {
          createdAt: _.eq(newCursor.lastCreatedAt),
          _id: _.gt(newCursor.lastId)
        }
      ])
    ])
  }

  const res = await db.collection('sentence')
    .where(where)
    .orderBy('createdAt', 'asc')
    .orderBy('_id', 'asc')
    .limit(Math.min(targetCount + 1, MAX_LIMIT))
    .get()

  const raw = res.data || []
  const hasMore = raw.length > targetCount
  const sentences = raw.slice(0, targetCount)

  if (!sentences.length) {
    return {
      list: [],
      nextCursor: newCursor,
      hasMore
    }
  }

  const last = sentences[sentences.length - 1]

  return {
    list: sentences.map(x => ({
      ...x,
      mark: null,
      isNew: true
    })),
    nextCursor: {
      lastCreatedAt: last.createdAt || 0,
      lastId: last._id
    },
    hasMore
  }
}

function toFullFileId(path) {
  if (!path) return ''
  if (path.startsWith('cloud://') || path.startsWith('http')) return path
  const cleanPath = path.startsWith('/') ? path.substring(1) : path
  return `${STORAGE_PREFIX}${cleanPath}`
}

// 主流程
exports.main = async event => {
  const { OPENID } = cloud.getWXContext()
  const { bookId, cursor = null, targetCount = 20 } = event

  if (!bookId) {
    return {
      code: -1,
      msg: '缺少必要的 bookId 参数',
      data: null
    }
  }

  const count = Math.min(Math.max(Number(targetCount) || 20, 1), MAX_LIMIT)

  try {
    const review = await getReviewList(OPENID, bookId, cursor, count)
    const need = count - review.list.length
    const fresh = await getNewSentenceList(OPENID, bookId, cursor, need)

    let list = [...review.list, ...fresh.list].map(item => ({
      ...item,
      audio: toFullFileId(item.audio),
      audio_zh: toFullFileId(item.audio_zh)
    }))

    // 1. 安全分批转换临时音频 URL (按 50 切片)
    list = await getAudioUrls(list)

    // 2. 安全分批关联收藏状态 (突破 100 条限制)
    list = await attachFavorites(OPENID, bookId, list)

    return {
      code: 0,
      msg: 'success',
      data: {
        list,
        nextCursor: {
          reviewCursor: review.nextCursor,
          newSentenceCursor: fresh.nextCursor
        },
        hasMore: review.hasMore || fresh.hasMore
      }
    }
  } catch (err) {
    console.error('getPlayList 云函数异常:', err)
    return {
      code: -1,
      msg: err.message || '数据库查询或云函数异常',
      error: String(err)
    }
  }
}