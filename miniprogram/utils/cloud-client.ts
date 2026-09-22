// miniprogram/services/cloud-client.ts

export interface ApiResponse<T = any> {
  code: number
  data?: T
  msg?: string
}

/**
 * 统一调用云函数的封装
 */
export async function callCloudFunction<T = any>(
  name: string,
  data: Record<string, any> = {}
): Promise<T> {
  try {
    const res = await wx.cloud.callFunction({
      name,
      data
    })

    const result = res.result as ApiResponse<T>

    // 如果接口定义了 code 状态码
    if (result && typeof result.code === 'number') {
      if (result.code !== 0) {
        throw new Error(result.msg || `Cloud function ${name} error`)
      }
      return result.data as T
    }

    // 若无 code 直接返回 raw result
    return res.result as T
  } catch (err: any) {
    console.error(`[Cloud Call Error] ${name}:`, err)
    wx.showToast({
      title: err.message || '网络或服务异常',
      icon: 'none'
    })
    throw err
  }
}