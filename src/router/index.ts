import { createRouter, createWebHistory } from 'vue-router';

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      redirect: '/ai-review/page',
    },
    {
      // 驻场迁移时只需把这两个业务路由合并到客户路由表，不替换其Router实例。
      path: '/ai-review/progress',
      name: 'ai-review-progress',
      component: () => import('@/pages/ReviewProgressPage.vue'),
    },
    {
      path: '/ai-review/page',
      name: 'ai-review-page',
      component: () => import('@/pages/ReviewPage.vue'),
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/ai-review/page',
    },
  ],
});

export default router;
