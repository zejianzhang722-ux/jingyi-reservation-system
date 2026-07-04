<template>
  <div class="forbidden-page">
    <el-result icon="warning" title="无权访问" sub-title="当前账号没有权限访问该页面，请切换账号或联系超级管理员调整权限。">
      <template #extra>
        <el-button type="primary" @click="$router.push('/dashboard')">返回工作台</el-button>
      </template>
    </el-result>
  </div>
</template>

<style scoped>
.forbidden-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--jy-bg, #F5F6FA);
}
</style>
