const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 按英文原文精确查重（忽略大小写与首尾空白）。
 * 只在当前用户可见范围内查找：自己的句子 + 公共（系统）句子，
 * 与 searchSentences 的可见性口径保持一致。
 *
 * 返回 data: 命中的第一条句子（含 _id/bookId/en/zh/audio 等），未命中返回 null。
 */
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const en = ((event && event.en) || '').trim()

  if (!en) return { code: 0, msg: 'success', data: null }

  try {
    const re = db.RegExp({ regexp: `^${escapeRegExp(en)}$`, options: 'i' })

    const res = await db.collection('sentence')
      .where(
        _.and([
          { en: re },
          { _openid: _.or([_.eq(OPENID), _.exists(false), _.eq(''), _.eq(null)]) }
        ])
      )
      .limit(1)
      .get()

    const sentence = (res.data && res.data[0]) || null
    return { code: 0, msg: 'success', data: sentence }
  } catch (err) {
    console.error('[findSentence] 查重失败:', err)
    return { code: 500, msg: '查重失败', data: null }
  }
}
