// Public sample data only. Connect a real data source through authorized service-side code.
export const products = [
  ['👜', '通勤轻量托特包', '云感系列 · 奶油白', '服饰箱包', 289, 1286, 371654, 18.6],
  ['🎧', '无线降噪蓝牙耳机', 'Sound Pro · 午夜黑', '数码家电', 399, 892, 355908, 12.3],
  ['🧴', '氨基酸温和洁面乳', '净润系列 · 150ml', '美妆个护', 89, 3241, 288449, 24.8],
  ['☕', '陶瓷随行咖啡杯', '日常系列 · 350ml', '家居生活', 129, 1876, 242004, 8.2],
  ['👟', '轻跑透气运动鞋', 'Air Flow · 云雾灰', '服饰箱包', 359, 632, 226888, -3.5]
];
export const PERIODS = ['今日', '近7天', '近30天'];
export const SHOPS = ['全部店铺', '天猫旗舰店', '淘宝品牌店'];
export const CATEGORIES = ['全部品类', ...new Set(products.map(p => p[3]))];
export function dashboardData(period, shop) {
  const factor = (period === '近7天' ? .27 : period === '今日' ? .035 : 1) * (shop === '全部店铺' ? 1 : .64);
  return {
    period, shop,
    products: products.map(p => p.map((value, index) => index === 5 || index === 6 ? Math.round(value * factor) : value)),
    metrics: { paymentAmount: Math.round(1286590 * factor), orders: Math.round(8462 * factor), visitors: Math.round(126842 * factor), conversionRate: 6.67 }
  };
}
