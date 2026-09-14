const cloud = require('wx-server-sdk')
const { Blob } = require('buffer')
global.Blob = Blob

const { EdgeTTS } = require('edge-tts-universal')
const { success, fail } = require('./dbhelper')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

function getVoice(text) {
  // 包含中文
  if (/[\u4e00-\u9fff]/.test(text)) {
    return 'zh-CN-XiaoxiaoNeural'
  }
  // 默认英语
  return 'en-US-JennyNeural'
}

exports.main = async (event) => {
  const text = event.text

  if (!text) {
    return fail('text 不能为空', 400)
  }

  try {
    const voice = getVoice(text)
    const tts = new EdgeTTS(text, voice)

    const result = await tts.synthesize()

    const audioBuffer = Buffer.from(
      await result.audio.arrayBuffer()
    )

    // 转换逐词时间戳（100纳秒 tick -> 秒）
    const wordBoundaries = (result.subtitle || []).map(w => ({
      text: w.text,
      start: w.offset / 10000000,
      duration: w.duration / 10000000
    }))

    // 直接使用 Buffer 上传到云存储，免去读写 /tmp 磁盘文件
    const cloudPath = `tts/${Date.now()}_${Math.random().toString(36).slice(-6)}.mp3`
    const uploadResult = await cloud.uploadFile({
      cloudPath,
      fileContent: audioBuffer
    })

    return success({
      fileID: uploadResult.fileID,
      wordBoundaries
    }, '语音合成成功')

  } catch (err) {
    console.error('[edgeTts Error]:', err)
    return fail(err.message || '语音合成失败', 500)
  }
}