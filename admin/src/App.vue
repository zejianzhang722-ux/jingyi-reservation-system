<template>
  <router-view />
</template>

<script setup>
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body, #app {
  width: 100%;
  height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial,
    'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', sans-serif;
  background-color: var(--jy-bg, #F5F6FA);
  color: var(--jy-text-regular, #4A4A5A);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

a {
  color: var(--jy-primary, #0066CC);
  text-decoration: none;
}

a:hover {
  color: var(--jy-primary-light, #3399FF);
}
</style>
