//程序初始化时创建两本用户默认书籍 我的句子和我的收藏
const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

const DEFAULT_BOOKS = [
  {
    role: 'origin',
    prefix: 'origin',
    name: '我的录入',
    type: 'sentence',
  },
  {
    role: 'favorite',
    prefix: 'fav',
    name: '我的收藏',
    type: 'sentence',
  }
];

// 2. 替换 export 为 exports.main
exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const now = Date.now();

  try {
    const bookPromises = DEFAULT_BOOKS.map(async (config) => {
      const bookId = `${config.prefix}_${OPENID}`;
      const bookRef = db.collection('book').doc(bookId);

      const { data } = await bookRef.get().catch(() => ({ data: null }));

      if (data) {
        return data;
      }

      const newBook = {
        name: config.name,
        type: config.type,
        role: config.role,
        openid: OPENID,
        itemCount: 0,
        createdAt: now,
        updatedAt: now,
      };

      await bookRef.set({
        data: newBook
      });

      return newBook;
    });

    const resultBooks = await Promise.all(bookPromises);

    const originBook = resultBooks.find(b => b.role === 'origin');
    const favoriteBook = resultBooks.find(b => b.role === 'favorite');

    return {
      code: 0,
      msg: 'User default books ensured successfully',
      data: {
        originBook,
        favoriteBook,
        originBookId: originBook?._id,
        favoriteBookId: favoriteBook?._id,
      }
    };

  } catch (err) {
    console.error('[ensureUserBook Error]:', err);
    return {
      code: -1,
      msg: 'Failed to ensure user default books',
      error: err
    };
  }
};