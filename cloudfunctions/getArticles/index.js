const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 定义常量
const MAX_LIMIT = 100;

exports.main = async (event, context) => {
  try {
    const { bookId } = event;

    // 1. 构建查询条件
    const whereCondition = bookId ? { bookId } : {};

    // 2. 调用修正后的全量拉取函数
    const list = await fetchAll('article', whereCondition);

    // 3. 提取需要换取临时 URL 的 fileID
    const fileList = list
      .map(item => item.audioUrl)
      .filter(Boolean);

    // 4. 分批并发获取音频临时 URL（每次最多 50 个）
    const urlMap = new Map();
    if (fileList.length > 0) {
      const batchPromises = [];
      for (let i = 0; i < fileList.length; i += 50) {
        const batch = fileList.slice(i, i + 50);
        batchPromises.push(cloud.getTempFileURL({ fileList: batch }));
      }

      // 使用 Promise.all 并发请求，大幅提升耗时性能
      const batchResults = await Promise.all(batchPromises);
      batchResults.forEach(res => {
        (res.fileList || []).forEach(item => {
          if (item.tempFileURL) {
            urlMap.set(item.fileID, item.tempFileURL);
          }
        });
      });
    }

    // 5. 替换字段中的临时 URL
    list.forEach(item => {
      if (item.audioUrl) {
        item.audioUrl = urlMap.get(item.audioUrl) || '';
      }
    });

    return {
      code: 0,
      msg: 'success',
      data: list
    };

  } catch (err) {
    console.error('[getArticles] 失败:', err);
    return {
      code: -1,
      msg: err.message || '获取文章列表失败',
      data: null
    };
  }
};

/**
 * 突破 100 条限制，全量并发拉取数据库记录
 * @param {string} collectionName 集合名称
 * @param {object} whereCondition 查询条件
 */
async function fetchAll(collectionName, whereCondition = {}) {
  // 1. 获取总数
  const countRes = await db.collection(collectionName).where(whereCondition).count();
  const total = countRes.total;
  if (total === 0) return [];

  // 2. 计算分批次数
  const batchTimes = Math.ceil(total / MAX_LIMIT);
  const tasks = [];

  // 3. 构建并发查询任务
  for (let i = 0; i < batchTimes; i++) {
    tasks.push(
      db.collection(collectionName)
        .where(whereCondition)
        .orderBy('createdAt', 'asc')
        .skip(i * MAX_LIMIT)
        .limit(MAX_LIMIT)
        .get()
    );
  }

  // 4. 并发拉取并合并结果
  const results = await Promise.all(tasks);
  return results.reduce((acc, cur) => acc.concat(cur.data || []), []);
}