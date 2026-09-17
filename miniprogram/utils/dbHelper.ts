export const db = wx.cloud.database()



export async function dbRequest<T>(request: Promise<T>, errorMsg = '数据库操作失败'): Promise<T> {
  try {
    return await request
  } catch (err) {
    console.error(errorMsg, err)
    wx.showToast({ title: errorMsg, icon: 'none' })
    throw err
  }
}

export async function fetchAll<T>(query: any, batchSize = 20): Promise<T[]> {
  const countResult = await query.count()
  const total = countResult.total
  if (total === 0) return []

  const tasks: Promise<QueryResult<T>>[] = []
  const batchTimes = Math.ceil(total / batchSize)

  for (let i = 0; i < batchTimes; i++) {
    tasks.push(query.skip(i * batchSize).limit(batchSize).get())
  }

  const resArray = await Promise.all(tasks)
  return resArray.flatMap(res => res.data)
}

export async function removeAll(query: any, batchSize = 20): Promise<number> {
  let total = 0

  while (true) {
    const res = await query.limit(batchSize).remove()
    const removed = res.stats.removed

    total += removed

    if (removed < batchSize) break
  }

  return total
}

export async function dbFetchAll<T>(query: any, errorMsg = '查询数据失败'): Promise<T[]> {
  return dbRequest(fetchAll<T>(query), errorMsg)
}

export function success<T>(data: T, message = 'ok'): ApiSuccess<T> {
  return { code: 0, data, message }
}

export function fail(message = 'error', code = -1): ApiFail {
  return { code, data: null, message }
}