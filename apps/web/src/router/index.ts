import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { setPageTitle } from '@/utils/title';
import { routes } from './routes';

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
});

/** 登录状态、用户类型、功能权限三道检查（docs/01 §5.2） */
router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.loaded) await auth.fetchMe();

  if (to.name === 'login') return auth.isLoggedIn ? auth.homePath : true;
  const userType = to.meta.userType ?? 'INTERNAL';
  if (userType === 'PUBLIC') return true;
  if (!auth.isLoggedIn) return { name: 'login', query: { redirect: to.fullPath } };
  if (userType !== auth.userType) return auth.homePath;
  if (!auth.hasPerm(to.meta.perm)) return { name: 'forbidden' };
  return true;
});

router.afterEach((to) => setPageTitle(to.meta.titleKey));
