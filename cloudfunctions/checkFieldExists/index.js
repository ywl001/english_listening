const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { collectionName, fieldName } = event;

  // 参数校验
  if (!collectionName || !fieldName) {
    return {
      success: false,
      errorMessage: '缺少必要参数：collectionName 或 fieldName'
    };
  }

  try {
    // 1. 统计总记录数
    const totalCountRes = await db.collection(collectionName).count();
    const totalCount = totalCountRes.total;

    // 2. 统计【存在】该字段的记录数
    const existsCountRes = await db.collection(collectionName)
      .where({
        [fieldName]: _.exists(true)
      })
      .count();
    const existsCount = existsCountRes.total;

    // 3. 计算【不存在】该字段的记录数
    const notExistsCount = totalCount - existsCount;

    return {
      success: true,
      data: {
        collectionName,
        fieldName,
        totalCount,        // 总记录数
        existsCount,       // 包含该字段的记录数
        notExistsCount,    // 不包含该字段的记录数
        existsRatio: totalCount > 0 ? `${((existsCount / totalCount) * 100).toFixed(2)}%` : '0%' // 占比
      }
    };
  } catch (err) {
    console.error('统计字段失败：', err);
    return {
      success: false,
      error: err
    };
  }
};