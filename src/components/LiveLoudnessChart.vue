<script setup lang="ts">
import { ref, watch, onMounted, nextTick } from "vue";
import * as d3 from "d3";
import { interpolateString } from "d3-interpolate";

// Props depuis `App.vue`
const props = defineProps<{
  instantLUFS: number | null;
  instantRMS: number | null;
}>();

// Stockage des valeurs lissées
const smoothedLUFS = ref(0);
const smoothedRMS = ref(0);
const smoothingFactor = 0.2;

// Stockage des données
const data = ref<{ time: number; lufs: number; rms: number }[]>([]);
const chartRef = ref<SVGSVGElement | null>(null);
const timeScale = ref(10);
const width = 400,
  height = 300;

const timelineDuration = ref(120); // ⏳ Durée totale de la timeline (par ex. 120s)
const viewOffset = ref(0); // 🔄 Déplacement indépendant (scroll de la timeline)
const isAutoScrolling = ref(true); // 🛑 Indique si on suit en temps réel ou si on navigue
const tooltip = ref<HTMLElement | null>(null);

// D3.js
let svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
let xScale: d3.ScaleLinear<number, number>;
let yScale: d3.ScaleLinear<number, number>;
let lineLUFS: d3.Line<{ time: number; lufs: number }>;
let lineRMS: d3.Line<{ time: number; rms: number }>;
let areaRMS: d3.Area<{ time: number; rms: number }>;

// Déclaration des variables globales pour éviter les erreurs TypeScript
let xAxis: d3.Axis<d3.NumberValue>;
let yAxis: d3.Axis<d3.NumberValue>;
let xAxisGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
let yAxisGroup: d3.Selection<SVGGElement, unknown, null, undefined>;

// Gestion du temps
let internalTime = 0;
let lastUpdateTime = 0;
let intervalId: ReturnType<typeof setInterval> | null = null;
let animationFrameId: number | null = null;
let isAnimating = false;

// Fonction de lissage (moyenne exponentielle)
const smoothValue = (
  current: number,
  newValue: number | null,
  factor: number
) => {
  return newValue !== null
    ? current * (1 - factor) + newValue * factor
    : current;
};

// Ajouter une mesure LUFS & RMS
const addDataPoint = () => {
  if (props.instantLUFS === null && props.instantRMS === null) {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    stopAnimation();
    return;
  }

  const now = performance.now();
  const elapsed = now - lastUpdateTime;
  lastUpdateTime = now;

  if (internalTime === 0) {
    internalTime = elapsed;
  } else {
    internalTime += elapsed;
  }

  if (!isAnimating) {
    startAnimation();
  }

  smoothedLUFS.value = smoothValue(
    smoothedLUFS.value,
    props.instantLUFS,
    smoothingFactor
  );
  smoothedRMS.value = smoothValue(
    smoothedRMS.value,
    props.instantRMS,
    smoothingFactor
  );

  data.value.push({
    time: internalTime,
    lufs: smoothedLUFS.value,
    rms: smoothedRMS.value,
  });

  // const cutoff = internalTime - timeScale.value * 1000;
  // data.value = data.value.filter((d) => d.time >= cutoff);
};

// Démarrer ou stopper `setInterval()` en fonction de LUFS/RMS
watch(
  [() => props.instantLUFS, () => props.instantRMS],
  ([newLUFS, newRMS]) => {
    if (newLUFS !== null || newRMS !== null) {
      if (!intervalId) {
        lastUpdateTime = performance.now();
        intervalId = setInterval(addDataPoint, 100);
      }
    } else {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }
  }
);

// Initialisation du graphique D3.js
const initChart = async () => {
  await nextTick();
  if (!chartRef.value) return;

  svg = d3.select(chartRef.value).attr("width", width).attr("height", height);
  // Définition du clipPath pour masquer les bords gauche et droit
  svg
    .append("defs")
    .append("clipPath")
    .attr("id", "clip")
    .append("rect")
    .attr("width", width - 10) // Ajuste pour masquer le début et la fin
    .attr("height", height)
    .attr("x", 5) // Décale pour éviter de cacher trop au début
    .attr("y", 0);

  xAxisGroup = svg
    .append("g")
    .attr("class", "x-axis axisRed")

    .attr("transform", `translate(5, ${height + 16})`);

  yAxisGroup = svg
    .append("g")
    .attr("class", "y-axis")
    .attr("transform", `translate(-10, 0)`);

  xScale = d3
    .scaleLinear()
    .domain([0, timelineDuration.value * 1000])
    .range([0, width * (timelineDuration.value / timeScale.value)]); // 🔍 Ajuste à la plage visible

  xScale = d3
    .scaleLinear()
    .domain([internalTime - timeScale.value * 1000, internalTime])
    .range([0, width]); // ✅ Utilise toute la largeur

  yScale = d3.scaleLinear().domain([-30, 30]).range([height, 0]);

  xAxis = d3
    .axisBottom(xScale)
    .ticks(timeScale.value / 2)
    .tickSize(0)
    .tickFormat((d) =>
      (Number(d) / 1000) % 2 === 0 ? `${Math.round(Number(d) / 1000)}s` : ""
    );

  yAxis = d3
    .axisLeft(yScale)
    .ticks(10)
    .tickSize(0)
    .tickFormat((d) => {
      const allowedTicks = [25, 20, 10, 0, -15, -30]; // ✅ Valeurs autorisées
      return allowedTicks.includes(Number(d))
        ? `${Math.round(Number(d))} dB`
        : "";
    });

  // ✅ Ajouter une ligne verticale qui suit la souris
  const verticalLine = svg
    .append("line")
    .attr("class", "cursor-line")
    .attr("x1", 0)
    .attr("x2", 0)
    .attr("y1", 0)
    .attr("y2", height)
    .attr("stroke", "#61c7db") // 🎨 Couleur semi-transparente
    .attr("stroke-width", 1.2)
    .attr("display", "none"); // ❌ Cachée par défaut

  xAxisGroup.select(".domain").style("display", "none");

  xAxisGroup.call(xAxis);
  xAxisGroup.select(".domain").style("stroke", "none");

  yAxisGroup.call(yAxis);

  // Sélectionner les ticks visibles et ajouter une ligne horizontale
  yAxisGroup
    .selectAll(".tick")
    .filter(function () {
      const tickText = d3.select(this).select("text").text();
      return tickText !== ""; // ✅ Ne prend que les ticks qui ont du texte visible
    })
    .append("line")
    .attr("x1", 15)
    .attr("x2", width) // 🔥 Étend sur toute la largeur
    .attr("stroke", "#ffffff1e") // 🎨 Couleur des lignes
    .attr("stroke-width", 1);

  yAxisGroup.select(".domain").style("stroke", "none");
  yAxisGroup
    .selectAll("text")
    .style("font-size", "12px") // ✅ Change la taille ici
    .style("fill", "white"); // ✅ Facultatif : changer la couleur
  xAxisGroup
    .selectAll("text")
    .style("font-size", "12px") // ✅ Change la taille ici
    .style("fill", "white");

  areaRMS = d3
    .area<{ time: number; rms: number }>()
    .x((d) => xScale(d.time))
    .y0(height)
    .y1((d) => yScale(d.rms))
    .curve(d3.curveMonotoneX);

  lineLUFS = d3
    .line<{ time: number; lufs: number }>()
    .x((d) => xScale(d.time))
    .y((d) => yScale(d.lufs))
    .curve(d3.curveMonotoneX);

  lineRMS = d3
    .line<{ time: number; rms: number }>()
    .x((d) => xScale(d.time))
    .y((d) => yScale(d.rms))
    .curve(d3.curveMonotoneX);
  svg
    .append("path")
    .attr("class", "rms-area")
    .attr("fill", "#b030b080")
    .attr("clip-path", "url(#clip)"); // 🔥 Applique le clipPath

  svg
    .append("path")
    .attr("class", "lufs-line")
    .attr("fill", "none")
    .attr("stroke", "#f2f2f3")
    .attr("stroke-width", 2)
    .attr("clip-path", "url(#clip)"); // 🔥 Applique le clipPath

  svg
    .append("path")
    .attr("class", "rms-line")
    .attr("fill", "none")
    .attr("stroke", "#b030b0")
    .attr("stroke-width", 2)
    .attr("clip-path", "url(#clip)"); // 🔥 Applique le clipPath

  startAnimation();
};
// Fonction pour démarrer l'animation `requestAnimationFrame()`
const startAnimation = () => {
  if (isAnimating) return; // ✅ Éviter les appels multiples
  isAnimating = true;
  animateGraph();
};

// Fonction pour stopper l'animation `requestAnimationFrame()`
const stopAnimation = () => {
  if (!isAnimating) return; // ✅ Ne rien faire si déjà stoppé
  isAnimating = false;
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
};

// Animation fluide
const animateGraph = () => {
  if (!isAnimating) return;

  const now = performance.now();
  const deltaTime = now - lastUpdateTime;
  lastUpdateTime = now;

  if (props.instantLUFS !== null || props.instantRMS !== null) {
    internalTime += deltaTime;
  }

  if (isAutoScrolling.value) {
    viewOffset.value = internalTime - timeScale.value * 1000;
  }

  animationFrameId = requestAnimationFrame(animateGraph);

  if (data.value.length === 0) return;

  // ✅ L'axe X suit `viewOffset`
  xScale.domain([viewOffset.value, viewOffset.value + timeScale.value * 1000]);

  xAxisGroup.transition().duration(0).ease(d3.easeLinear).call(xAxis);
  xAxisGroup
    .selectAll("text")
    .style("font-size", "12px") // ✅ Change la taille ici
    .style("fill", "white");
  svg.select(".rms-area").datum(data.value).attr("d", areaRMS);
  svg.select(".lufs-line").datum(data.value).attr("d", lineLUFS);
  svg.select(".rms-line").datum(data.value).attr("d", lineRMS);
};
const togglePause = () => {
  isAutoScrolling.value = !isAutoScrolling.value;
  if (isAutoScrolling.value) {
    viewOffset.value = internalTime - timeScale.value * 1000; // 🔄 Reprend la vue en temps réel
  }
};

const handleScroll = (event: WheelEvent) => {
  if (!isAutoScrolling.value) {
    event.preventDefault();
    viewOffset.value += event.deltaY * 10; // 🔄 Scroll plus rapide
    viewOffset.value = Math.max(
      0,
      Math.min(viewOffset.value, internalTime - timeScale.value * 1000)
    ); // 🛑 Limite aux données existantes
  }
};

onMounted(() => {
  document.addEventListener("wheel", handleScroll, { passive: false });
});
onMounted(() => {
  if (!chartRef.value || !tooltip.value) return;

  chartRef.value.addEventListener("mouseover", (event) => {
    if (!tooltip.value) return;
    tooltip.value.style.display = "block";
  });

  chartRef.value.addEventListener("mouseleave", () => {
    if (!tooltip.value) return;
    tooltip.value.style.display = "none";
  });
});
const handleMouseMove = (event: MouseEvent) => {
  if (!tooltip.value || !chartRef.value || data.value.length === 0) return;

  // ✅ Récupérer la position X dans le SVG
  const svgRect = chartRef.value.getBoundingClientRect();
  const mouseX = event.clientX - svgRect.left;

  // ✅ Convertir en secondes basées sur la timeline
  const timeAtCursor = xScale.invert(mouseX);

  // ✅ Vérifier qu'il y a bien des données
  if (data.value.length === 0) return;

  // ✅ Trouver les valeurs LUFS et RMS les plus proches
  const closestData =
    data.value.length > 1
      ? data.value.reduce((prev, curr) =>
          Math.abs(curr.time - timeAtCursor) <
          Math.abs(prev.time - timeAtCursor)
            ? curr
            : prev
        )
      : data.value[0];

  // ✅ Mettre à jour le contenu du tooltip
  document.getElementById("tooltip-time")!.innerText = `POS: ${(
    timeAtCursor / 1000
  ).toFixed(1)}s`;
  document.getElementById(
    "tooltip-lufs"
  )!.innerText = `S: ${closestData.lufs.toFixed(2)}`;
  document.getElementById(
    "tooltip-rms"
  )!.innerText = `TP: ${closestData.rms.toFixed(2)}`;

  // ✅ Afficher le tooltip
  tooltip.value.style.opacity = "1";

  // ✅ Déplacer la ligne verticale
  svg
    .select(".cursor-line")
    .attr("x1", mouseX)
    .attr("x2", mouseX)
    .attr("display", "block"); // 🔥 Rendre visible
};

const handleMouseLeave = () => {
  if (!tooltip.value) return;
  tooltip.value.style.opacity = "0"; // Cache le tooltip

  // ✅ Cacher la ligne verticale
  svg.select(".cursor-line").attr("display", "none");
};

onMounted(initChart);
</script>

<template>
  <div class="chartContainer">
    <svg
      ref="chartRef"
      @mousemove="handleMouseMove"
      @mouseleave="handleMouseLeave"
    ></svg>

    <!-- ✅ Tooltip FIXE en haut à droite -->
    <div ref="tooltip" class="tooltip">
      <p id="tooltip-time">POS: --s</p>
      <p id="tooltip-lufs">S: --</p>
      <p id="tooltip-rms">TP: --</p>
    </div>

    <div class="controls">
      <button @click="togglePause">
        {{ isAutoScrolling ? "Pause & Scroll" : "Reprendre" }}
      </button>
      <label>
        Time Scale:
        <select v-model="timeScale">
          <option :value="5">5s</option>
          <option :value="10">10s</option>
          <option :value="30">30s</option>
        </select>
      </label>

      <input
        type="range"
        min="5"
        max="60"
        v-model="timeScale"
        style="display: none"
      />

      <button @click="data = []">Reset</button>
    </div>
  </div>
</template>

<style scoped>
.chartContainer {
  position: relative;
  overflow: hidden;
  background-color: #1c1e30;
  border-radius: 2.4px;
}
svg {
  margin: 0 0 40px 64px;
  overflow: visible;
  position: relative;
}

.controls {
  display: flex;
  justify-content: space-between;
  margin: 16px;
}
button {
  padding: 5px 10px;
  border: none;
  border-radius: 2.4px;
  background: #05c17f;
  color: white;
  cursor: pointer;
}

.tooltip {
  position: absolute;
  background: #161726;
  top: 16px;
  right: 16px;
  color: white;
  padding: 5px 15px;
  border-radius: 5px;
  font-size: 12px;
  pointer-events: none;
  opacity: 1;

  z-index: 100;
  transition: opacity 0.2s ease-in-out;
}
.x-axis path.domain {
  stroke: none !important;
  display: none !important;
  d: none !important;
}
.axisRed path {
  stroke: red;
}
</style>
