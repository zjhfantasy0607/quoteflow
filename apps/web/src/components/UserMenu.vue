<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import ChangePasswordDialog from '@/components/ChangePasswordDialog.vue';
import { useAuthStore } from '@/stores/auth';
import { pickName } from '@/utils/format';

const { t, locale } = useI18n();
const auth = useAuthStore();
const router = useRouter();
const showPassword = ref(false);

const subtitle = computed(() => {
  const me = auth.me;
  if (!me) return '';
  if (me.user.supplier) return pickName(me.user.supplier, locale.value);
  return me.roles.map((r) => pickName(r, locale.value)).join(' / ');
});

async function onCommand(command: string): Promise<void> {
  if (command === 'password') {
    showPassword.value = true;
  } else if (command === 'logout') {
    await auth.logout();
    await router.push({ name: 'login' });
  }
}
</script>

<template>
  <el-dropdown v-if="auth.me" trigger="click" @command="onCommand">
    <div class="user-menu">
      <el-icon :size="20"><UserFilled /></el-icon>
      <div class="names">
        <div class="name">{{ auth.me.user.name }}</div>
        <div class="sub">{{ subtitle }}</div>
      </div>
      <el-icon><ArrowDown /></el-icon>
    </div>
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item command="password" :icon="'Lock'">{{ t('auth.menu.changePassword') }}</el-dropdown-item>
        <el-dropdown-item command="logout" :icon="'SwitchButton'" divided>{{ t('auth.menu.logout') }}</el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
  <ChangePasswordDialog v-model="showPassword" />
</template>

<style scoped>
.user-menu {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #fff;
  cursor: pointer;
  outline: none;
}
.names {
  line-height: 1.2;
}
.name {
  font-size: 14px;
}
.sub {
  max-width: 220px;
  overflow: hidden;
  font-size: 12px;
  white-space: nowrap;
  text-overflow: ellipsis;
  opacity: 0.75;
}
</style>
