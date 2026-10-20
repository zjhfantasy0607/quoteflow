import * as ElementPlusIcons from '@element-plus/icons-vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import { setUnauthenticatedHandler } from './api/http';
import { vPerm } from './directives/perm';
import { i18n } from './i18n';
import { router } from './router';
import { useAuthStore } from './stores/auth';
import './styles/main.css';

const app = createApp(App);
for (const [name, component] of Object.entries(ElementPlusIcons)) {
  app.component(name, component);
}
app.directive('perm', vPerm);
app.use(createPinia()).use(i18n).use(router).use(ElementPlus);

// 会话失效时回到登录页，登录后回到原页面
setUnauthenticatedHandler(() => {
  useAuthStore().reset();
  const current = router.currentRoute.value;
  if (current.name !== 'login') void router.push({ name: 'login', query: { redirect: current.fullPath } });
});

app.mount('#app');
