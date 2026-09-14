const cloud = require('wx-server-sdk')
const https = require('https')
const crypto = require('crypto')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

function isChinese(text) {
  return /[\u4e00-\u9fff]/.test(text)
}

function md5(str) {
  return crypto.createHash('md5').update(str, 'utf8').digest('hex')
}

// 百度翻译 通用文本翻译API
// 文档：https://fanyi-api.baidu.com/doc/21
function translate(text, from, to) {
  return new Promise((resolve, reject) => {
    const appid = process.env.BAIDU_TRANSLATE_APPID
    const secretKey = process.env.BAIDU_TRANSLATE_SECRET_KEY

    if (!appid || !secretKey) {
      reject(new Error('未配置百度翻译密钥，请在云函数环境变量里设置 BAIDU_TRANSLATE_APPID 和 BAIDU_TRANSLATE_SECRET_KEY'))
      return
    }

    const salt = Date.now().toString()
    const sign = md5(appid + text + salt + secretKey)

    const params = new URLSearchParams({
      q: text,
      from,
      to,
      appid,
      salt,
      sign
    })

    const url = `https://fanyi-api.baidu.com/api/trans/vip/translate?${params}`

    https.get(url, res => {
      let data = ''

      res.on('data', chunk => {
        data += chunk
      })

      res.on('end', () => {
        try {
          const result = JSON.parse(data)

          if (result.error_code) {
            reject(new Error(`百度翻译失败[${result.error_code}]: ${result.error_msg || '未知错误'}`))
            return
          }

          const translated = (result.trans_result || []).map(r => r.dst).join('\n')
          resolve(translated)
        } catch (err) {
          reject(err)
        }
      })
    }).on('error', reject)
  })
}

exports.main = async (event) => {
  const text = (event.text || '').trim()

  if (!text) {
    throw new Error('请输入要翻译的内容')
  }

  const chinese = isChinese(text)

  // 百度翻译语言代码：中文是 zh，不是 zh-CN
  const source = chinese ? 'zh' : 'en'
  const target = chinese ? 'en' : 'zh'

  console.log('source:', source)
  console.log('target:', target)
  console.log('text:', text)

  const translatedText = await translate(text, source, target)

  return {
    source,
    target,
    original: text,
    translated: translatedText
  }
}