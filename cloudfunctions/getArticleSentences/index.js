// cloudfunctions/getSentences/index.js
const cloud = require('wx-server-sdk');
const { fetchAll, success, fail } = require('./dbHelper');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  try {
    const { articleId } = event;
    let query = db.collection('articleSentence');
    const whereCondition = {};

    if (articleId) whereCondition.articleId = articleId;
    // if (bookId) whereCondition.bookId = bookId;

    query = query.where(whereCondition).orderBy('order', 'asc');

    // 使用公共工具分批拉取全部句子数据
    const list = await fetchAll(query);

    return success(list);
  } catch (err) {
    console.error('[getArticleSentences] 失败:', err);
    return fail(err.message || '获取句子列表失败');
  }
};