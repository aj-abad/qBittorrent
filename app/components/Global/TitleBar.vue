<template>
  <header
    class="text-white pl-20 pr-4 py-2 flex items-center gap-4 select-none"
    style="-webkit-app-region: drag">
    <span class="text-sm">qBittorrent v{{ appVersion }}</span>
  </header>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";

const versions = ref<{ node: string; chrome: string; electron: string } | null>(null);
const appVersion = ref("—");

onMounted(async () => {
  if (typeof window === "undefined" || !window.qbt) return;
  versions.value = window.qbt.versions;
  appVersion.value = await window.qbt.getVersion();
});
</script>
