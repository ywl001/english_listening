// cloudfunctions/getBooks/index.js
const cloud = require('wx-server-sdk');
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});
const db = cloud.database();
const _ = db.command;

const MAX_LIMIT = 100;

exports.main = async (event) => {
  const {
    OPENID
  } = cloud.getWXContext();
  const {
    type
  } = event;

  try {
    // 1. 查出当前用户可见的所有书籍 (自己的 + 公共无 _openid 的)
    const whereCondition = {
      _openid: _.or([
        _.eq(OPENID),
        _.exists(false),
        _.eq(''),
        _.eq(null)
      ])
    };
    if (type) whereCondition.type = type;

    const books = await fetchAll('book', whereCondition);
    if (books.length === 0) {
      return {
        code: 0,
        msg: 'success',
        data: []
      };
    }

    // 2. 服务端按书籍类型并发统计数量
    const statTasks = books.map(async (book) => {
      let itemCount = 0;
      try {
        if (book._openid && book._openid === OPENID) {
          const countUserInput = await db.collection('sentence')
          .where({
            bookId: book._id
          })
          .count();

          const countUserRef = await db.collection('sentenceBookRef')
          .where({
            bookId: book._id
          })
          .count();
          itemCount = countUserInput.total + countUserRef.total || 0;

        } else if (book.type === 'article') {
          // 统计 article 集合的数量
          const countRes = await db.collection('article')
            .where({
              bookId: book._id
            })
            .count();
          itemCount = countRes.total || 0;
        } else {
          // 默认 / sentence：统计 sentence 集合的数量
          const countRes = await db.collection('sentence')
            .where({
              bookId: book._id
            })
            .count();
          itemCount = countRes.total || 0;
        }
      } catch (err) {
        console.error(`计算书籍 [${book.name || book._id}] 数量失败:`, err);
      }

      return {
        ...book,
        itemCount // 统一返回 itemCount 字段，供前端展示数量
      };
    });

    const booksWithCount = await Promise.all(statTasks);

    return {
      code: 0,
      msg: 'success',
      data: booksWithCount
    };

  } catch (err) {
    console.error('获取书籍列表失败:', err);
    return {
      code: 500,
      msg: '服务器异常',
      error: err
    };
  }
};

/**
 * 突破 100 条限制，全量并发拉取数据库记录
 */
async function fetchAll(collectionName, whereCondition) {
  const countRes = await db.collection(collectionName).where(whereCondition).count();
  const total = countRes.total;
  if (total === 0) return [];

  const batchTimes = Math.ceil(total / MAX_LIMIT);
  const tasks = [];

  for (let i = 0; i < batchTimes; i++) {
    tasks.push(
      db.collection(collectionName)
      .where(whereCondition)
      .orderBy('createdAt', 'desc')
      .skip(i * MAX_LIMIT)
      .limit(MAX_LIMIT)
      .get()
    );
  }

  const results = await Promise.all(tasks);
  return results.reduce((acc, cur) => acc.concat(cur.data || []), []);
}