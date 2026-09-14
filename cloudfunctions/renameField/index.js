const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event, context) => {
  const { collectionName, oldKey, newKey } = event;

  if (!collectionName || !oldKey || !newKey) {
    return { success: false, message: '缺少必要参数' };
  }

  const db = cloud.database();
  const _ = db.command;

  let totalUpdated = 0;
  let hasMore = true;

  try {
    while (hasMore) {
      // 1. 查询所有还包含 oldKey 的记录（单次批次处理 100 条）
      const queryRes = await db.collection(collectionName)
        .where({
          [oldKey]: _.exists(true)
        })
        .limit(100)
        .get();

      const list = queryRes.data;

      // 没有符合条件的数据，退出循环
      if (!list || list.length === 0) {
        hasMore = false;
        break;
      }

      // 2. 逐条处理：设置新字段，删除旧字段
      for (const item of list) {
        const oldValue = item[oldKey];

        await db.collection(collectionName)
          .doc(item._id)
          .update({
            data: {
              [newKey]: oldValue,    // 建立新字段并赋值
              [oldKey]: _.remove()   // 删除旧字段
            }
          });

        totalUpdated++;
      }
    }

    return {
      success: true,
      totalUpdated,
      message: `处理完成，共重命名 ${totalUpdated} 条记录`
    };
  } catch (err) {
    console.error('更新失败:', err);
    return {
      success: false,
      totalUpdated,
      error: err.errMsg || err.message
    };
  }
};