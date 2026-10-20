<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, type RouteRecordRaw } from 'vue-router';
import { buildMenu } from '@/router/menu';
import { useAuthStore } from '@/stores/auth';

const props = defineProps<{ layout: RouteRecordRaw; collapsed: boolean }>();

const { t } = useI18n();
const route = useRoute();
const auth = useAuthStore();

// 菜单按功能权限过滤（权限变化后随 auth.me 自动刷新）
const items = computed(() => buildMenu(props.layout, (r) => auth.hasPerm(r.meta?.perm)));
</script>

<template>
  <el-menu router :default-active="route.path" :collapse="collapsed" class="app-menu">
    <template v-for="item in items" :key="item.key">
      <el-sub-menu v-if="item.children" :index="item.key">
        <template #title>
          <el-icon v-if="item.icon"><component :is="item.icon" /></el-icon>
          <span>{{ t(item.titleKey) }}</span>
        </template>
        <el-menu-item v-for="child in item.children" :key="child.key" :index="child.path!">
          <el-icon v-if="child.icon"><component :is="child.icon" /></el-icon>
          <span>{{ t(child.titleKey) }}</span>
        </el-menu-item>
      </el-sub-menu>
      <el-menu-item v-else :index="item.path!">
        <el-icon v-if="item.icon"><component :is="item.icon" /></el-icon>
        <template #title>{{ t(item.titleKey) }}</template>
      </el-menu-item>
    </template>
  </el-menu>
</template>

<style scoped>
.app-menu {
  height: 100%;
  border-right: none;
}
</style>
