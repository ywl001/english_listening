import { cloudFunctionName } from "./enums/app-enums"
import { callCloudFunction } from "./services/cloud-client"
import { initSentenceEventListeners } from "./services/sentence-listener"
import sync from "./utils/sync"

// app.ts
App<IAppOption>({
  globalData: {
  },

  openidReady: Promise.resolve(),
  
  async onLaunch() {
    // 初始化云环境
    wx.cloud.init({
      env: 'cloud1-d0gyvvq93ab34b8b7',
      traceUser: true
    })

    this.openidReady = this.initOpenid() as any
    // 运行期间屏幕亮
    wx.setKeepScreenOn({
      keepScreenOn: true
    })

    // // ========== 第一步：确保拿到 _openid（缓存或云端，只此一处） ==========
    // let _openid: string | '' = wx.getStorageSync('_openid');
    // if (!_openid) {
    //   try {
    //     const res = await wx.cloud.callFunction({ name: 'getOpenId' });
    //     _openid = (res.result as { _openid: string })._openid;
    //     wx.setStorageSync('_openid', _openid);
    //   } catch (e) {
    //     console.error('获取 _openid 失败', e);
    //     // 这里可以选择 return，或继续启动（同步会失败，本地缓存兜底）
    //   }
    // }
    // this.globalData._openid = _openid;
    // console.log(this.globalData._openid)

    // 确保用户的默认词书（"用户句子"）存在。
    // 云函数内部是幂等的，这里不用 await 阻塞启动，失败了也不影响正常使用——
    // 后续录入句子等操作里如果发现默认库缺失，会再次兜底触发。
    await this.openidReady
    this.ensureUserBook()

    sync.startSync()

    // 启动eventBus监听程序
    initSentenceEventListeners();

  },

  async ensureUserBook() {
    // 直接拿到 callCloudFunction 解包后的对象
    const userBooks = await callCloudFunction<UserDefaultBooks>(
      cloudFunctionName.ensureUserBook,
      {}
    );

    console.log('默认词书信息:', userBooks);
    console.log('录入词书ID:', userBooks.originBookId);
    console.log('收藏词书ID:', userBooks.favoriteBookId);

    // 缓存到 globalData 或 Storage
    this.globalData.originBookId = userBooks.originBookId;
    this.globalData.favoriteBookId = userBooks.favoriteBookId;
  },

  getPlayConfig() {
    if (!this.globalData.playConfig) {
      this.globalData.playConfig = {
        repeatCount: 1,
        gapMs: 1000,
        playOrder: 'zh_first',
        limitCount: 0,
        bookId: '',
        bookName: '',
        playMode: 'sequence',
        startId: ''
      }
    }

    return this.globalData.playConfig
  },
  async initOpenid():Promise<void> {
    const res = await wx.cloud.callFunction({ name: 'getOpenId' });
    const _openid = (res.result as { _openid: string })._openid;
    console.log('get openid',_openid)
    this.globalData._openid = _openid
  },
  updatePlayConfig(config) {
    Object.assign(this.getPlayConfig(), config)
  }

})