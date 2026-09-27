const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

const STORAGE_PREFIX = 'cloud://cloud1-d0gyvvq93ab34b8b7.636c-cloud1-d0gyvvq93ab34b8b7-1333600691/'

function toFullFileId(path) {
  if (!path) return ''
  if (typeof path !== 'string') return ''
  if (path.startsWith('cloud://') || path.startsWith('http')) return path
  return STORAGE_PREFIX + path.replace(/^\//, '')
}

async function countOf(collection, where) {
  const res = await db.collection(collection).where(where).count()
  return res.total || 0
}

/**
 * 删除用户句子（两阶段提交）：
 * - confirm=false：只统计收藏情况，返回 needConfirm 供前端提示
 * - confirm=true：执行删除——收藏（sentenceFavorite，即所有引用）、学习记录一并清除，
 *   最后删句子本体与音频文件
 *
 * 安全约束：仅能删除自己的句子（sentence._openid === OPENID），系统句子返回 403。
 */
exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { sentenceId, confirm = false } = event || {}

  if (!sentenceId) return { code: 400, msg: 'sentenceId 不能为空' }

  try {
    // 1. 校验句子存在且属于当前用户（系统句子不允许删除）
    const doc = await db.collection('sentence').doc(sentenceId).get().catch(() => null)
    const sentence = doc && doc.data
    if (!sentence) return { code: 404, msg: '句子不存在' }
    if (sentence._openid !== OPENID) return { code: 403, msg: '无权删除该句子' }

    // 2. 统计收藏情况（引用关系都在 sentenceFavorite）
    const favoriteCount = await countOf('sentenceFavorite', { sentenceId, deleted: false })

    // 3. 未确认 → 只返回统计，绝不执行删除（空数据也不允许穿透）
    if (!confirm) {
      return { code: 0, msg: 'success', data: { needConfirm: favoriteCount > 0, favoriteCount } }
    }

    // 4. 执行删除（句子本体最后删，中途失败可安全重试）
    await db.collection('sentenceFavorite').where({ sentenceId }).remove()
    await db.collection('sentenceMark').where({ sentenceId }).remove()
    await db.collection('sentence').doc(sentenceId).remove()

    // 5. 清理音频文件（尽力而为，失败不影响删除结果）
    const fileList = [toFullFileId(sentence.audio), toFullFileId(sentence.audio_zh)].filter(Boolean)
    if (fileList.length) {
      try {
        await cloud.deleteFile({ fileList })
      } catch (e) {
        console.warn('[deleteSentence] 音频清理失败:', e)
      }
    }

    return { code: 0, msg: 'success', data: { deleted: true, favoriteCount } }
  } catch (err) {
    console.error('[deleteSentence] 删除句子失败:', err)
    return { code: 500, msg: err.message || '删除失败', data: null }
  }
}
