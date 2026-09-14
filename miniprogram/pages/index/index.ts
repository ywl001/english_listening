import { callCloudFunction } from "../../services/cloud-client";

// pages/index/index.ts
Page({

  /**
   * 页面的初始数据
   */
  data: {

  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad() {
    this.testGetFavoriteSentences()
  },

  async testGetFavoriteSentences() {
    try {
      const res = await callCloudFunction('getFavoriteSentences', {
        bookId: 'fav_oLhr065b5ezFkXzJtwt4gqi5jc_0', // 或传入你 ensureUserBook 返回的 favoriteBookId
        targetCount: 40
      });
      
      console.log('--- 收藏句子列表 ---', res.list);
      console.log('--- 下页游标 ---', res.nextCursor);
      console.log('--- 是否还有更多 ---', res.hasMore);
    } catch (err) {
      console.error('测试失败:', err);
    }
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