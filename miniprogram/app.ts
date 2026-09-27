import { cloudFunctionName, LocalStorageKey } from "./enums/app-enums"
import { callCloudFunction } from "./utils/cloud-client"
import sync from "./utils/sync"
import appController from "./services/app-controller"
import appStore from "./services/app-store"
import eventBus from "./services/EventBus"
import { AppEvent } from "./services/event-type"

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

    // 【关键】同步注册事件监听，不能放在 await 之后：
    // async onLaunch 一旦 await 就会让出事件循环，页面 onLoad/onShow 会趁这个空档执行，
    // 此时 GET_BOOKS 事件没有监听器，book 列表就永远不会加载（真机冷启动偶发空列表的根因）
    appStore.init()
    appController.init()

    console.log('appStore instance:', appStore)
    console.log('appController instance:', appController)

    this.openidReady = this.initOpenid() as any
    // 运行期间屏幕亮
    wx.setKeepScreenOn({
      keepScreenOn: true
    })

    await this.openidReady
    // 默认书（我的句子/我的收藏）就绪后，主动拉一次书列表兜底：
    // 即使页面 onShow 的事件因时序丢失，这里也会把数据灌进 appStore.books
    this.ensureUserBook().then(() => {
      eventBus.emit(AppEvent.GET_BOOKS)
    })
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