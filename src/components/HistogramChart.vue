<template>
  <div>
    <button @click="togglePower" class="power-button">
      {{ isRunning ? "Stop" : "Start" }}
    </button>
    <apexchart
      type="line"
      height="350"
      width="550"
      ref="chart"
      :options="chartOptions"
      :series="series"
    ></apexchart>
  </div>
</template>

<script>
import VueApexCharts from "vue3-apexcharts";

export default {
  components: {
    apexchart: VueApexCharts,
  },
  props: {
    instantLUFS: {
      required: false,
    },
  },
  data() {
    return {
      isRunning: false,
      elapsedTime: 0, // Temps écoulé en secondes
      elapsedMs: 0, // Temps écoulé en millisecondes
      interval: null,
      series: [{ data: [] }],
      chartOptions: {
        chart: {
          id: "realtime",
          height: 350,
          type: "line",
          animations: {
            enabled: true,
            easing: "linear",
            dynamicAnimation: { speed: 200 }, // Animation fluide de 200ms
          },
          toolbar: { show: false },
          zoom: { enabled: true },
        },
        dataLabels: { enabled: false },
        stroke: { curve: "smooth" },
        title: { text: "LUFS Real-Time Chart", align: "left" },
        markers: { size: 0 },
        xaxis: {
          type: "numeric",
          range: 10, // Affichage sur 10 secondes
          tickAmount: 10, // 10 ticks = 1 tick par seconde
          labels: {
            formatter: (value) => `${Math.floor(value)}s`, // Afficher seulement les secondes entières
          },
        },
        yaxis: {
          max: 30,
          min: -30,
          labels: {
            formatter: (value) => Math.round(value), // ✅ Arrondi à l'unité
          },
        },
        legend: { show: false },
      },
    };
  },
  methods: {
    togglePower() {
      if (this.isRunning) {
        clearInterval(this.interval);
        this.isRunning = false;
      } else {
        this.isRunning = true;
        this.elapsedTime = 0;
        this.elapsedMs = 0;
        this.series[0].data = []; // Reset des données
        this.startUpdating();
      }
    },
    startUpdating() {
      this.interval = setInterval(() => {
        this.updateChart(this.instantLUFS);
      }, 500); // Mise à jour toutes les 0.2s

      // Réinitialisation des données toutes les 60 secondes pour éviter les fuites mémoire
      setInterval(() => {
        this.series[0].data = [];
        if (this.$refs.chart) {
          this.$refs.chart.updateSeries(
            [{ data: this.series[0].data }],
            false,
            true
          );
        }
      }, 60000);
    },
    updateChart(newLUFS) {
      if (!this.isRunning) return;

      this.elapsedMs += 200; // Augmente de 200ms
      this.elapsedTime = this.elapsedMs / 1000; // Convertit en secondes

      this.series[0].data.push({ x: this.elapsedTime, y: newLUFS });

      // Garder uniquement les 10 dernières secondes
      this.series[0].data = this.series[0].data.filter(
        (point) => point.x >= this.elapsedTime - 10
      );

      if (this.$refs.chart && this.$refs.chart.updateSeries) {
        this.$refs.chart.updateSeries([{ data: this.series[0].data }]);
      }
    },
  },
};
</script>

<style>
.power-button {
  padding: 10px 20px;
  font-size: 16px;
  background-color: #007bff;
  color: white;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  margin-bottom: 10px;
}

.power-button:hover {
  background-color: #0056b3;
}
</style>
