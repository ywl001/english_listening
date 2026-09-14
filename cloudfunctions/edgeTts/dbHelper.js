/**
 * 突破 100 条限制的分批拉取工具函数
 * @param {DB.Collection | DB.Query} query 数据库查询对象
 * @param {number} batchSize 每批次读取数量，默认 100
 * @returns {Promise<Array>} 合并后的完整数组
 */
async function fetchAll(query, batchSize = 100) {
  const countResult = await query.count();
  const total = countResult.total;

  if (total === 0) {
    return [];
  }

  const batchTimes = Math.ceil(total / batchSize);
  const tasks = [];

  for (let i = 0; i < batchTimes; i++) {
    const promise = query.skip(i * batchSize).limit(batchSize).get();
    tasks.push(promise);
  }

  const resArray = await Promise.all(tasks);
  return resArray.reduce((acc, cur) => acc.concat(cur.data), []);
}

/**
 * 统一成功响应
 */
function success(data, message = 'ok') {
  return { code: 0, data, message };
}

/**
 * 统一失败响应
 */
function fail(message = 'error', code = -1) {
  return { code, data: null, message };
}

module.exports = {
  fetchAll,
  success,
  fail
};