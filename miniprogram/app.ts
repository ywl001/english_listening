import { cloudFunctionName, LocalStorageKey } from "./enums/app-enums"
import { callCloudFunction } from "./utils/cloud-client"
import sync from "./utils/sync"
import appController from "./services/app-controller"
import appStore from "./services/app-store"

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

    console.log('cloud init success')

    await appStore.init()
    await appController.init()

    console.log('appStore instance:', appStore)
    console.log('appController instance:', appController)


    this.openidReady = this.initOpenid() as any
    // 运行期间屏幕亮
    wx.setKeepScreenOn({
      keepScreenOn: true
    })

    await this.openidReady
    this.ensureUserBook()

    sync.startSync()

    // 启动eventBus监听程序
  },

  async ensureUserBook() {
    // 直接拿到 callCloudFunction 解包后的对象
    const userBooks = await callCloudFunction<UserDefaultBooks>(
      cloudFunctionName.ensureUserBook,
      {}
    );
    
    if(!wx.getStorageSync(LocalStorageKey.CURRENT_FAVORITE_BOOK)){
      wx.setStorageSync(LocalStorageKey.CURRENT_FAVORITE_BOOK,userBooks.favoriteBook)
      appStore.currentFavoriteBook.value = userBooks.favoriteBook
    }else{
      appStore.currentFavoriteBook.value = wx.getStorageSync(LocalStorageKey.CURRENT_FAVORITE_BOOK)
    }
    

    // console.log('默认词书信息:', userBooks);
    // console.log('录入词书ID:', userBooks.originBookId);
    // console.log('收藏词书ID:', userBooks.favoriteBookId);

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
  async initOpenid(): Promise<void> {
    const res = await wx.cloud.callFunction({ name: 'getOpenId' });
    const _openid = (res.result as { _openid: string })._openid;
    console.log('get openid', _openid)
    appStore._openid.value = _openid
    this.globalData._openid = _openid
  },
  updatePlayConfig(config) {
    Object.assign(this.getPlayConfig(), config)
  }

})