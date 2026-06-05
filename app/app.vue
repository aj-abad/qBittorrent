<template>
  <div class="h-screen flex flex-col select-none bg-neutral-900 text-white">
    <GlobalTitleBar />

    <!-- Main content -->
    <main class="flex-1 relative overflow-hidden">
      <ScrollArea>
        <div class="h-full flex flex-col items-center justify-center gap-4 opacity-60 px-6 text-center">
          <PhCloudArrowDown class="size-20" />
          <p class="text-lg">qBittorrent desktop frontend</p>
          <p :class="cn('text-sm', statusColor)">{{ statusLabel }}</p>
          <p v-if="apiVersion" class="text-xs opacity-60">
            Web API reports qBittorrent {{ apiVersion }}
          </p>
          <p class="text-xs opacity-60">
            Electron {{ versions?.electron ?? "—" }} · Chrome {{ versions?.chrome ?? "—" }} ·
            Node {{ versions?.node ?? "—" }}
          </p>
        </div>
      </ScrollArea>
    </main>

    <!-- Status bar -->
    <footer
      class="bg-black/60 px-4 py-0.5 text-xs opacity-40 shrink-0 flex items-center gap-3 border-t border-white/5">
      <span>backend: {{ backend?.status ?? "unknown" }}</span>
      <span class="grow" />
      <span>qBittorrent v{{ appVersion }}</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { PhCloudArrowDown } from "@phosphor-icons/vue";
import type { BackendInfo } from "~~/shared/ipc";

const versions = ref<{ node: string; chrome: string; electron: string } | null>(null);
const appVersion = ref("—");
const apiVersion = ref<string | null>(null);
const backend = ref<BackendInfo | null>(null);

let unsubscribe: (() => void) | null = null;

const statusLabel = computed(() => {
  const info = backend.value;
  if (!info) return "Waiting for Electron bridge…";
  switch (info.status) {
    case "ready":
      return "Backend ready";
    case "starting":
      return "Starting qbittorrent-nox…";
    case "not-found":
      return "qbittorrent-nox not found — build it or set QBT_NOX_PATH";
    case "error":
      return "Backend failed to start";
  }
});

const statusColor = computed(() => {
  switch (backend.value?.status) {
    case "ready":
      return "text-green-400";
    case "starting":
      return "text-sky-400";
    default:
      return "text-amber-400";
  }
});

// Once the backend is ready, prove the IPC API proxy end-to-end.
async function loadApiVersion() {
  if (backend.value?.status !== "ready" || !window.qbt) return;
  const res = await window.qbt.api<string>({ path: "app/version" });
  if (res.ok) apiVersion.value = String(res.data);
}

watch(() => backend.value?.status, loadApiVersion);

onMounted(async () => {
  if (typeof window === "undefined" || !window.qbt) return;
  versions.value = window.qbt.versions;
  appVersion.value = await window.qbt.getVersion();
  backend.value = await window.qbt.getBackend();
  unsubscribe = window.qbt.onBackendStatus((info) => {
    backend.value = info;
  });
  await loadApiVersion();
});

onUnmounted(() => unsubscribe?.());
</script>
