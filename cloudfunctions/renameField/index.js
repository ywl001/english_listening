const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// 安全上限：防止个别记录更新失败导致死循环
const MAX_ROUNDS = 200;
const BATCH_SIZE = 100;

exports.main = async (event, context) => {
  const { collectionName, oldKey, newKey, overwrite = false, rounds } = event;

  if (!collectionName || !oldKey || !newKey) {
    return { success: false, message: '缺少必要参数' };
  }

  // 单次调用最多处理的轮数：客户端循环调用来避免云函数执行超时
  const maxRounds = Math.min(typeof rounds === 'number' && rounds > 0 ? rounds : MAX_ROUNDS, MAX_ROUNDS);

  const db = cloud.database();
  const _ = db.command;

  let totalUpdated = 0;
  let skipped = 0;

  try {
    for (let round = 0; round < maxRounds; round++) {
      // 1. 查询还包含 oldKey 的记录
      const queryRes = await db.collection(collectionName)
        .where({ [oldKey]: _.exists(true) })
        .limit(BATCH_SIZE)
        .get();

      const list = queryRes.data;
      if (!list || list.length === 0) break;

      // 2. 分拣：newKey 已有值的记录默认跳过（不覆盖权威数据）
      const toUpdate = [];
      for (const item of list) {
        const hasNew = item[newKey] !== undefined;
        if (hasNew && !overwrite) {
          skipped++;
          // 只删旧字段，不动新字段，避免下一轮再查到它
          toUpdate.push({ id: item._id, value: undefined, deleteOnly: true });
        } else {
          toUpdate.push({ id: item._id, value: item[oldKey], deleteOnly: false });
        }
      }

      // 3. 并发更新整批（比逐条串行快 5-10 倍）
      await Promise.all(toUpdate.map(({ id, value, deleteOnly }) =>
        db.collection(collectionName)
          .doc(id)
          .update({
            data: deleteOnly
              ? { [oldKey]: _.remove() }
              : { [newKey]: value, [oldKey]: _.remove() }
          })
      ));

      totalUpdated += toUpdate.length;
    }

    // 4. 收尾统计：确认没有残留（说明有记录一直更新失败）
    const remainRes = await db.collection(collectionName)
      .where({ [oldKey]: _.exists(true) })
      .count();
    const remaining = remainRes.total;

    return {
      success: remaining === 0,
      totalUpdated,
      skipped,
      remaining,
      message: remaining === 0
        ? `处理完成，共重命名 ${totalUpdated - skipped} 条，跳过 ${skipped} 条`
        : `处理了 ${totalUpdated} 条，但仍有 ${remaining} 条含旧字段（可能更新失败），请检查`
    };
  } catch (err) {
    console.error('更新失败:', err);
    return {
      success: false,
      totalUpdated,
      skipped,
      error: err.errMsg || err.message
    };
  }
};
