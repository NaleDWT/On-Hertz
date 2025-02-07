<script setup lang="ts">
import { ref } from "vue";

import "@/components/lit/audio-player/AudioPlayer";
import LiveLoudnessChart from "@/components/LiveLoudnessChart.vue";

const audioContext = ref<AudioContext | null>(null);
const instantRMS = ref<number | null>(null);
const instantLUFS = ref<number | null>(null);

const audioFiles = [
  { name: "Verano Sensual", author: "Kevin McLeod", path: "audio/verano.mp3" },
  {
    name: "Monkeys spinning monkeys",
    author: "Kevin McLeod",
    path: "audio/monkeys.mp3",
  },
  {
    name: "Canon in D",
    author: "Kevin McLeod/Johann Pachelbel",
    path: "audio/canon.mp3",
  },
];

const startAudioContext = () => {
  audioContext.value = new AudioContext();
};
const onVolumeChange = (
  e: CustomEvent<{ rms: number | null; lufs: number | null }>
) => {
  instantRMS.value = e.detail.rms;
  instantLUFS.value = e.detail.lufs;
};
</script>

<template>
  <main>
    <template v-if="audioContext">
      <h2>{{ audioFiles[1].name }}</h2>
      <h3>{{ audioFiles[1].author }}</h3>
      <oh-audio-player
        :audioContext="audioContext"
        :src="audioFiles[1].path"
        @volume-change="onVolumeChange"
      ></oh-audio-player>

      <div>
        <div>RMS: {{ instantRMS }}</div>
        <div>LUFS: {{ instantLUFS }}</div>
      </div>
      <LiveLoudnessChart
        :instantLUFS="instantLUFS"
        :instantRMS="instantRMS"
        :audioSrc="audioFiles[1].path"
      />
    </template>
    <template v-else>
      <button @click="startAudioContext">
        <svg width="13" height="14" viewBox="0 0 13 14" fill="none">
          <path d="M0 14V0L12.6 7L0 14Z" fill="#161726" />
        </svg>
      </button>
    </template>
  </main>
</template>
