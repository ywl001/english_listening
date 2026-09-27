const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const MAX_LIMIT = 100
const STORAGE_PREFIX = 'cloud://cloud1-d0gyvvq93ab34b8b7.636c-cloud1-d0gyvvq93ab34b8b7-1333600691/'

function toFullFileId(path) {
  if (!path) return ''
  if (path.startsWith('cloud://') || path.startsWith('http')) return path
  return STORAGE_PREFIX + path.replace(/^\//, '')
}

async function getAudioUrls(list) {
  const ids = [...new Set(
    list.flatMap(x => [x.audio, x.audio_zh])
    .filter(x => typeof x === 'string' && x.startsWith('cloud://'))
  )]

  if (!ids.length) return list

  const chunks = []
  for (let i = 0; i < ids.length; i += 50) {
    chunks.push(ids.slice(i, i + 50))
  }

  const results = await Promise.all(
    chunks.map(async chunk => {
      try {
        return await cloud.getTempFileURL({
          fileList: chunk
        })
      } catch (err) {
        console.error('获取音频地址失败:', err)
        return {
          fileList: []
        }
      }
    })
  )

  const map = new Map()

  results.forEach(res => {
    ;
    (res.fileList || []).forEach(x => {
      if (x.status === 0) map.set(x.fileID, x.tempFileURL)
    })
  })

  return list.map(x => ({
    ...x,
    // 公有读权限下为长期有效 URL，可直接落盘播放
    audio: map.get(x.audio) || x.audio || '',
    audio_zh: map.get(x.audio_zh) || x.audio_zh || '',
    // 保留原始 cloud:// fileID：删除/管理云存储文件时需要
    audioFileId: x.audio || '',
    audioZhFileId: x.audio_zh || ''
  }))
}
exports.main = async event => {
  const {
    bookId,
    cursor = 0,
    limit = 100,
    // withUrl=false：不换 URL，直接返回 cloud:// fileID（需要 fileID 的调用方）
    // 默认 true：返回长期有效 URL（云存储需设为"所有用户可读"）+ 附带原始 fileID 字段
    withUrl = true
  } = event

  if (!bookId) return {
    code: -1,
    msg: '缺少必要的 bookId 参数',
    data: null
  }

  const skip = Math.max(Number(cursor) || 0, 0)
  const count = Math.min(Math.max(Number(limit) || 100, 1), MAX_LIMIT)

  try {
    const res = await db.collection('sentence')
      .where({
        bookId
      })
      .orderBy('createdAt', 'asc')
      .orderBy('_id', 'asc')
      .skip(skip)
      .limit(count)
      .get()

    let list = (res.data || []).map(item => ({
      ...item,
      audio: toFullFileId(item.audio),
      audio_zh: toFullFileId(item.audio_zh)
    }))

    if (withUrl) {
      list = await getAudioUrls(list)
    }

    return {
      code: 0,
      msg: 'success',
      data: {
        list,
        nextCursor: skip + list.length,
        hasMore: list.length === count
      }
    }
  } catch (err) {
    console.error('getBookSentences 云函数异常:', err)
    return {
      code: -1,
      msg: err.message || '获取句子失败',
      error: String(err)
    }
  }
}