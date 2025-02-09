<script setup lang="ts">
import { ref } from "vue";
import "@/components/lit/audio-player/AudioPlayer";
import LiveLoudnessChart from "@/components/LiveLoudnessChart.vue";

const audioContext = ref<AudioContext | null>(null);
const instantRMS = ref<number | null>(null);
const instantLUFS = ref<number | null>(null);
const currentIndex = ref(3);

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
  {
    name: "Minor Swing",
    author: "Django Reinhardt",
    path: "audio/minorswing.mp3",
  },
  {
    name: "Lithium",
    author: "Nirvana",
    path: "audio/lithium.mp3",
  },
];

const startAudioContext = () => {
  audioContext.value = new AudioContext();
};

const nextTrack = () => {
  currentIndex.value = (currentIndex.value + 1) % audioFiles.length;
  instantRMS.value = null;
  instantLUFS.value = null;
};

const prevTrack = () => {
  currentIndex.value =
    (currentIndex.value - 1 + audioFiles.length) % audioFiles.length;
  instantRMS.value = null;
  instantLUFS.value = null;
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
      <h2>{{ audioFiles[currentIndex].name }}</h2>
      <h3>{{ audioFiles[currentIndex].author }}</h3>
      <div class="audioselect">
        <oh-audio-player
          :audioContext="audioContext"
          :src="audioFiles[currentIndex].path"
          @volume-change="onVolumeChange"
        ></oh-audio-player>

        <div>
          <button @click="prevTrack">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path
                d="M1.40898 0.125488V12.1255H0.208984V0.125488H1.40898ZM12.209 0.125488L2.60898 6.12549L12.209 12.1255V0.125488Z"
                fill="#161726"
              />
            </svg>
          </button>
          <button class="prev" @click="nextTrack">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path
                d="M11.4567 12.144V0.144043H12.6567V12.144H11.4567ZM0.656738 12.144L10.2567 6.14404L0.656738 0.144043V12.144Z"
                fill="#161726"
              />
            </svg>
          </button>
        </div>
      </div>

      <div class="comment">
        <div>// RMS: {{ instantRMS }}</div>
        <div>// LUFS: {{ instantLUFS }}</div>
        <div>
          // I really enjoyed this test, thanks On-Hertz for giving me a chance
          :&#x29;
        </div>
        <div>// &#x2B07;&#x2B07;DRAG THE TOOL WINDOW&#x2B07;&#x2B07;</div>
      </div>

      <LiveLoudnessChart
        :instantLUFS="instantLUFS"
        :instantRMS="instantRMS"
        :audioSrc="audioFiles[currentIndex].path"
      />
    </template>

    <template v-else>
      <button class="startButton" @click="startAudioContext">Start</button>
    </template>
  </main>
</template>
