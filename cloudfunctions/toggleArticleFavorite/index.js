// 文章收藏开关：articleFavorite 单文档 upsert
// 文档结构：{ _id: openid__articleId, _openid, articleId, bookId, deleted, createdAt, updatedAt }
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

function success(data, message = 'ok') {
  return { code: 0, data, message };
}
function fail(message = 'error', code = -1) {
  return { code, data: null, message };
}

exports.main = async (event) => {
  try {
    const { action = 'toggle', articleId, bookId, isFavorite } = event;
    const { OPENID } = cloud.getWXContext();

    if (!articleId || !OPENID) return fail('参数缺失');

    const docId = `${OPENID}__${articleId}`;
    const coll = db.collection('articleFavorite');

    // 查询收藏状态（文档不存在视为未收藏）
    if (action === 'get') {
      try {
        const res = await coll.doc(docId).get();
        return success({ isFavorite: !res.data.deleted });
      } catch (e) {
        return success({ isFavorite: false });
      }
    }

    // toggle：set 保证文档不存在时自动创建，存在时整体覆盖（幂等）
    const now = Date.now();
    await coll.doc(docId).set({
      data: {
        _openid: OPENID,
        articleId,
        bookId: bookId || '',
        deleted: !isFavorite,
        createdAt: now,
        updatedAt: now
      }
    });

    return success({ isFavorite: !!isFavorite });
  } catch (err) {
    console.error('[toggleArticleFavorite] 失败:', err);
    return fail(err.message || '操作失败');
  }
};
