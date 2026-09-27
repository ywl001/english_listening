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

    // 排序：有 order 字段的按 order 升序排在前面；没有 order 的按 createdAt 升序排在后面
    // （可通过给 book 文档设置 order: 1, 2, 3... 自定义显示顺序）
    books.sort((a, b) => {
      const oa = typeof a.order === 'number' ? a.order : null;
      const ob = typeof b.order === 'number' ? b.order : null;
      if (oa !== null && ob !== null) return oa - ob;
      if (oa !== null) return -1;          // 有 order 的排前面
      if (ob !== null) return 1;
      return (a.createdAt || 0) - (b.createdAt || 0); // 都没有：按创建时间升序
    });

    // 2. 服务端按书籍类型并发统计：总数 count + 已学数 learnedCount（stage > 0）
    const statTasks = books.map(async (book) => {
      let itemCount = 0;
      let learnedCount = 0;
      try {
        if (book.content === 'article') {
          // 文章书：统计 article 集合（区分维度是 content，不是 type）
          const countRes = await db.collection('article')
            .where({ bookId: book._id })
            .count();
          itemCount = countRes.total || 0;
        } else if (book.type === 'ref') {
          // 引用书（收藏夹）：总数 = 本书的有效收藏数
          itemCount = (await db.collection('sentenceFavorite')
            .where({ refBookId: book._id, deleted: false })
            .count()).total || 0;

          // 已学 = 收藏的句子中，该用户 mark.stage > 0 的数量
          if (itemCount > 0) {
            const favs = await fetchAll('sentenceFavorite',
              { refBookId: book._id, deleted: false }, { sentenceId: true });
            const ids = favs.map(f => f.sentenceId);
            for (let i = 0; i < ids.length; i += 100) {
              learnedCount += (await db.collection('sentenceMark')
                .where({
                  _openid: OPENID,
                  sentenceId: _.in(ids.slice(i, i + 100)),
                  stage: _.gt(0)
                })
                .count()).total || 0;
            }
          }
        } else {
          // 实体书（系统书 / 我的句子）：总数 = 书内句子数
          itemCount = (await db.collection('sentence')
            .where({ bookId: book._id })
            .count()).total || 0;

          // 已学 = 该用户在这本书上的 mark.stage > 0 的数量
          learnedCount = (await db.collection('sentenceMark')
            .where({ _openid: OPENID, bookId: book._id, stage: _.gt(0) })
            .count()).total || 0;
        }
      } catch (err) {
        console.error(`统计书籍 [${book.name || book._id}] 失败:`, err);
      }

      return {
        ...book,
        itemCount, // 兼容旧字段
        count: itemCount, // 总数
        learnedCount // 已学数（stage > 0）
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
async function fetchAll(collectionName, whereCondition, field) {
  const countRes = await db.collection(collectionName).where(whereCondition).count();
  const total = countRes.total;
  if (total === 0) return [];

  const batchTimes = Math.ceil(total / MAX_LIMIT);
  const tasks = [];

  for (let i = 0; i < batchTimes; i++) {
    let q = db.collection(collectionName)
      .where(whereCondition)
      .orderBy('createdAt', 'desc')
      .skip(i * MAX_LIMIT)
      .limit(MAX_LIMIT);
    if (field) q = q.field(field);
    tasks.push(q.get());
  }

  const results = await Promise.all(tasks);
  return results.reduce((acc, cur) => acc.concat(cur.data || []), []);
}