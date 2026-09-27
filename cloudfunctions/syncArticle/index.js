const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 拉取单篇文章（含音频播放地址）：
 * - 一次云函数调用替代客户端的 doc.get + getTempFileURL 两次往返
 * - 云存储公有读权限下返回的 URL 长期有效，可直接落盘缓存
 * - audioFileId 保留原始 cloud:// fileID（管理/删除场景使用）
 */
exports.main = async (event) => {
  const { articleId } = event || {}
  if (!articleId) return { code: 400, msg: 'articleId 不能为空', data: null }

  try {
    const doc = await db.collection('article').doc(articleId).get().catch(() => null)
    const article = doc && doc.data
    if (!article) return { code: 404, msg: '文章不存在', data: null }

    const fileId = article.audioUrl || ''
    let audioSrc = fileId
    if (fileId && fileId.startsWith('cloud://')) {
      try {
        const res = await cloud.getTempFileURL({ fileList: [fileId] })
        const url = (res.fileList && res.fileList[0] && res.fileList[0].tempFileURL) || ''
        if (url) audioSrc = url
      } catch (e) {
        // 换 URL 失败：退回 fileID，InnerAudioContext 原生支持 cloud:// 协议
        console.warn('[syncArticle] 换取音频地址失败:', e)
      }
    }

    return {
      code: 0,
      msg: 'success',
      data: { article, audioSrc, audioFileId: fileId }
    }
  } catch (err) {
    console.error('[syncArticle] 获取文章失败:', err)
    return { code: 500, msg: err.message || '获取文章失败', data: null }
  }
}
