const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const MAX_LIMIT = 100 // 云数据库单次查询上限
const IN_CHUNK_SIZE = 20 // command.in() 单次数组长度上限，超过要分片查询
const STORAGE_PREFIX = 'cloud://cloud1-d0gyvvq93ab34b8b7.636c-cloud1-d0gyvvq93ab34b8b7-1333600691/'

exports.main = async (event) => {
  const { bookId } = event
  const { OPENID } = cloud.getWXContext()

  if (!bookId) {
    throw new Error('bookId 不能为空')
  }

  // 1. 该 bookId 下"直接归属"的句子（原来就有的逻辑，分页突破 100 条限制）
  const directSentences = await fetchAllByWhere('sentence', { bookId })

  // 2. 该 bookId 下"引用加入"的句子（用户从搜索里把别的句子加进了本词书）
  const refs = await fetchAllByWhere('sentenceBookRef', { bookId })
  const refSentenceIds = Array.from(new Set(refs.map(r => r.sentenceId)))

  const referencedSentences = refSentenceIds.length > 0
    ? await fetchByIdsIn('sentence', refSentenceIds)
    : []

  // 3. 合并去重（同一句子同时命中两边时，以直接归属的记录为准）
  const sentenceMap = new Map()
  directSentences.forEach(s => sentenceMap.set(s._id, s))
  referencedSentences.forEach(s => {
    if (!sentenceMap.has(s._id)) sentenceMap.set(s._id, s)
  })
  const rawSentences = Array.from(sentenceMap.values())

  // 4. 获取该用户对这些句子的全部 Mark 标记
  //    注意：这里按 sentenceId 查，不再按 bookId 查——
  //    一句话现在可能通过"引用"出现在多本词书里，
  //    收藏/学习进度是跟"用户 + 句子"绑定的，不应该被具体某本词书限制住。
  const sentenceIds = rawSentences.map(s => s._id)
  const marks = sentenceIds.length > 0
    ? await fetchMarksBySentenceIds(OPENID, sentenceIds)
    : []

  // ---------------- 💡 拼接相对路径 & 分片转换为 HTTPS 临时链接 ----------------

  const fileIds = []

  const toFullFileId = (path) => {
    if (!path) return ''
    if (path.startsWith('cloud://') || path.startsWith('http')) return path
    const cleanPath = path.startsWith('/') ? path.substring(1) : path
    return `${STORAGE_PREFIX}${cleanPath}`
  }

  rawSentences.forEach(s => {
    const fullAudio = toFullFileId(s.audio)
    const fullAudioZh = toFullFileId(s.audio_zh)

    if (fullAudio && fullAudio.startsWith('cloud://')) fileIds.push(fullAudio)
    if (fullAudioZh && fullAudioZh.startsWith('cloud://')) fileIds.push(fullAudioZh)
  })

  const urlMap = new Map()

  if (fileIds.length > 0) {
    const uniqueFileIds = Array.from(new Set(fileIds))
    const fileList = await batchGetTempFileURL(uniqueFileIds)

    fileList.forEach(item => {
      if (item.fileID && item.tempFileURL) {
        urlMap.set(item.fileID, item.tempFileURL)
      }
    })
  }

  // 5. 规范输出格式：填充 HTTPS 链接并映射成前端需要的对象
  const sentences = rawSentences.map(s => {
    const fullAudio = toFullFileId(s.audio)
    const fullAudioZh = toFullFileId(s.audio_zh)

    return {
      ...s,
      audio: urlMap.get(fullAudio) || fullAudio || s.audio,
      audio_zh: urlMap.get(fullAudioZh) || fullAudioZh || s.audio_zh
    }
  })

  return {
    code: 0,
    msg: 'success',
    data: {
      sentences,
      marks
    }
  }
}

/**
 * 分页拉取满足 where 条件的全部记录，突破单次 100 条限制
 */
async function fetchAllByWhere(collectionName, whereCondition) {
  const countRes = await db.collection(collectionName).where(whereCondition).count()
  const total = countRes.total
  if (total === 0) return []

  const batchTimes = Math.ceil(total / MAX_LIMIT)
  const tasks = []

  for (let i = 0; i < batchTimes; i++) {
    tasks.push(
      db.collection(collectionName)
        .where(whereCondition)
        .skip(i * MAX_LIMIT)
        .limit(MAX_LIMIT)
        .get()
    )
  }

  const results = await Promise.all(tasks)
  return results.reduce((acc, cur) => acc.concat(cur.data || []), [])
}

/**
 * 按 _id 批量查询（自动按 20 个一组分片，规避 command.in 的数量限制）
 */
async function fetchByIdsIn(collectionName, ids) {
  const chunks = []
  for (let i = 0; i < ids.length; i += IN_CHUNK_SIZE) {
    chunks.push(ids.slice(i, i + IN_CHUNK_SIZE))
  }

  const tasks = chunks.map(chunkIds =>
    db.collection(collectionName).where({ _id: _.in(chunkIds) }).get()
  )

  const results = await Promise.all(tasks)
  return results.reduce((acc, cur) => acc.concat(cur.data || []), [])
}

/**
 * 按用户 + 一批 sentenceId 拉取 mark（同样分片规避 command.in 限制）
 */
async function fetchMarksBySentenceIds(openid, sentenceIds) {
  const chunks = []
  for (let i = 0; i < sentenceIds.length; i += IN_CHUNK_SIZE) {
    chunks.push(sentenceIds.slice(i, i + IN_CHUNK_SIZE))
  }

  const tasks = chunks.map(chunkIds =>
    db.collection('sentenceMark')
      .where({ openid, sentenceId: _.in(chunkIds) })
      .get()
  )

  const results = await Promise.all(tasks)
  return results.reduce((acc, cur) => acc.concat(cur.data || []), [])
}

/**
 * 💡 分批获取临时 HTTPS 链接（规避 SDK 单次 50 个文件限制）
 */
async function batchGetTempFileURL(fileIds) {
  const CHUNK_SIZE = 50
  const tasks = []

  for (let i = 0; i < fileIds.length; i += CHUNK_SIZE) {
    const chunk = fileIds.slice(i, i + CHUNK_SIZE)
    tasks.push(cloud.getTempFileURL({ fileList: chunk }))
  }

  const results = await Promise.all(tasks)
  return results.reduce((acc, cur) => acc.concat(cur.fileList || []), [])
}
