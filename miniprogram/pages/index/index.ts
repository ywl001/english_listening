import { cloudFunctionName } from "../../enums/app-enums"
import sentencePlayList from "../../services/sentence-play-list"
import { callCloudFunction } from "../../utils/cloud-client"

Page({

  /**
   * 页面的初始数据
   */
  data: {

  },

  cursor : null,
  limit : 20,
  bookId:'',

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad() {

  },

  async test(){
    const res = await sentencePlayList.getPlayList('f9ecc4af6a98d6fa05ab454f5e9f84fc',this.limit,this.cursor)
    console.log(res.cursor)
    console.log(res.list.map(item=>item.zh))
    console.log('-----------------------------------------------------------------')
    this.cursor = res.cursor
  },



  /**
   * 生命周期函数--监听页面初次渲染完成
   */
  onReady() {

  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {

  },

  /**
   * 生命周期函数--监听页面隐藏
   */
  onHide() {

  },

  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload() {

  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh() {

  },

  /**
   * 页面上拉触底事件的处理函数
   */
  onReachBottom() {

  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {

  }
})