// 科大讯飞 在线语音合成（流式版 WebAPI）
// 文档: https://www.xfyun.cn/doc/tts/online_tts/API.html
// 鉴权: HMAC-SHA256 签名拼到 WebSocket URL
// 凭证: 环境变量 XF_APPID / XF_API_KEY / XF_API_SECRET（config.json 或控制台配置）
// 配额: 免费额度用完时讯飞返回错误码（常见 10105），本函数原样透传，
//       客户端 TtsService 收到失败会自动降级为微信同声传译插件

const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const WebSocket = require('ws')
const { success, fail } = require('./dbhelper')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const HOST = 'tts-api.xfyun.cn'
const API_PATH = '/v2/tts'

const APPID = process.env.XF_APPID || ''
const API_KEY = process.env.XF_API_KEY || ''
const API_SECRET = process.env.XF_API_SECRET || ''

// 发音人：中文/英文各一个
// 完整音色列表见讯飞控制台「在线语音合成 -> 发音人」，可自行替换
const VOICE_ZH = 'x4_lingfeizhe_zl'
const VOICE_EN = 'x4_enus_lucy_education'

function getVoice(text) {
  return /[\u4e00-\u9fff]/.test(text) ? VOICE_ZH : VOICE_EN
}

/** 按讯飞鉴权规则生成带签名的 WebSocket URL */
function buildAuthUrl() {
  const date = new Date().toUTCString() // RFC1123 格式

  const signatureOrigin =
    `host: ${HOST}\ndate: ${date}\nGET ${API_PATH} HTTP/1.1`
  const signature = crypto
    .createHmac('sha256', API_SECRET)
    .update(signatureOrigin)
    .digest('base64')

  const authorizationOrigin =
    `api_key="${API_KEY}", algorithm="hmac-sha256", ` +
    `headers="host date request-line", signature="${signature}"`
  const authorization = Buffer.from(authorizationOrigin).toString('base64')

  return (
    `wss://${HOST}${API_PATH}?authorization=${encodeURIComponent(authorization)}` +
    `&date=${encodeURIComponent(date)}&host=${HOST}`
  )
}

/** 单次合成：建立 WS -> 发文本 -> 收 mp3 分片 -> 拼 Buffer */
function synthesizeOnce(text, vcn) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(buildAuthUrl())
    const chunks = []

    // 讯飞合成一般 1~2s，给 8s 兜底，防止挂死拖满云函数超时
    const timer = setTimeout(() => {
      try { ws.close() } catch (e) { /* ignore */ }
      reject(new Error('讯飞 TTS 合成超时'))
    }, 8000)

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          common: { app_id: APPID },
          business: {
            aue: 'lame', // mp3 格式
            sfl: 1, // 流式返回
            auf: 'audio/L16;rate=16000',
            vcn,
            tte: 'UTF8',
            speed: 50,
            volume: 50,
            pitch: 50
          },
          data: {
            status: 2, // 一次性发完整段文本
            text: Buffer.from(text).toString('base64')
          }
        })
      )
    })

    ws.on('message', (raw) => {
      let msg
      try {
        msg = JSON.parse(raw.toString())
      } catch (e) {
        clearTimeout(timer)
        reject(new Error('讯飞 TTS 返回非 JSON 数据'))
        return
      }

      // code != 0：鉴权失败 / 配额用尽等，透传给上层
      if (msg.code !== 0) {
        clearTimeout(timer)
        try { ws.close() } catch (e) { /* ignore */ }
        reject(new Error(`讯飞 TTS retcode=${msg.code} ${msg.message || ''}`))
        return
      }

      if (msg.data && msg.data.audio) {
        chunks.push(Buffer.from(msg.data.audio, 'base64'))
      }

      // status 2 = 结束帧
      if (msg.data && msg.data.status === 2) {
        clearTimeout(timer)
        try { ws.close() } catch (e) { /* ignore */ }
        resolve(Buffer.concat(chunks))
      }
    })

    ws.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

exports.main = async (event) => {
  const text = (event.text || '').trim()

  if (!text) {
    return fail('text 不能为空', 400)
  }

  if (!APPID || !API_KEY || !API_SECRET) {
    return fail(
      '讯飞凭证未配置：请在云函数环境变量设置 XF_APPID / XF_API_KEY / XF_API_SECRET',
      500
    )
  }

  try {
    const vcn = getVoice(text)
    const audioBuffer = await synthesizeOnce(text, vcn)

    if (!audioBuffer || !audioBuffer.length) {
      return fail('讯飞未返回音频数据', 500)
    }

    const cloudPath = `tts/xf_${Date.now()}_${Math.random()
      .toString(36)
      .slice(-6)}.mp3`
    const uploadResult = await cloud.uploadFile({
      cloudPath,
      fileContent: audioBuffer
    })

    return success(
      { fileID: uploadResult.fileID },
      '语音合成成功'
    )
  } catch (err) {
    console.error('[xfTts Error]:', err)
    return fail(err.message || '语音合成失败', 500)
  }
}
