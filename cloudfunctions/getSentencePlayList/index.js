const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command
const MAX_LIMIT = 100
const STORAGE_PREFIX = 'cloud://cloud1-d0gyvvq93ab34b8b7.636c-cloud1-d0gyvvq93ab34b8b7-1333600691/'

// 分批获取，突破云数据库单次 100 条限制
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

// 获取到期复习句子
async function getReviewList(openid, bookId, cursor, targetCount) {
  const reviewCursor = cursor?.reviewCursor || null
  let where = {
    openid,
    bookId,
    nextReviewAt: _.lte(Date.now())
  }

  // 游标分页：时间相同再用 _id 保证唯一顺序
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

  // 多取 1 条，用于判断是否还有更多
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

  // 根据 sentenceId 批量获取句子
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

  // 注意：cursor 使用实际返回的最后一条，而不是多取的第 N+1 条
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

// 获取新句子，用于不足 targetCount 时补齐
async function getNewSentenceList(openid, bookId, cursor, targetCount) {
  const newCursor = cursor?.newSentenceCursor || null

  if (targetCount <= 0) {
    return {
      list: [],
      nextCursor: newCursor,
      hasMore: false
    }
  }

  // 获取用户已经学习过的句子，避免重复返回
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

  // 新句游标分页：createdAt + _id
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

  // 多取 1 条，用于判断是否还有更多
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

// 将 cloud:// 文件 ID 转成临时 URL
async function getAudioUrls(list) {
  const ids = [...new Set(
    list.flatMap(x => [x.audio, x.audio_zh])
    .filter(x => typeof x === 'string' && x.startsWith('cloud://'))
  )]

  if (!ids.length) return list

  const res = await cloud.getTempFileURL({
    fileList: ids
  })
  const map = new Map(
    (res.fileList || [])
    .filter(x => x.status === 0)
    .map(x => [x.fileID, x.tempFileURL])
  )

  return list.map(x => ({
    ...x,
    audio: map.get(x.audio) || x.audio || '',
    audio_zh: map.get(x.audio_zh) || x.audio_zh || ''
  }))
}

function toFullFileId(path) {
  if (!path) return ''
  if (path.startsWith('cloud://') || path.startsWith('http')) return path
  const cleanPath = path.startsWith('/') ? path.substring(1) : path
  return `${STORAGE_PREFIX}${cleanPath}`
}


// 主流程：复习优先，不足部分用新句补齐
exports.main = async event => {
  const {
    OPENID
  } = cloud.getWXContext()
  const {
    bookId,
    cursor = null,
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
    // 先取复习句
    const review = await getReviewList(OPENID, bookId, cursor, count)

    // 复习不足时，用新句补齐
    const need = count - review.list.length
    const fresh = await getNewSentenceList(OPENID, bookId, cursor, need)

    // 合并后先统一文件路径，再转换临时 URL
    let list = [...review.list, ...fresh.list].map(item => ({
      ...item,
      audio: toFullFileId(item.audio),
      audio_zh: toFullFileId(item.audio_zh)
    }))
    // 合并并转换音频 URL
    list = await getAudioUrls(list)

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