<script setup lang="ts">
import { ref, watch, onMounted, nextTick } from "vue";
import * as d3 from "d3";
import { interpolateString } from "d3-interpolate";

// Props depuis `App.vue`
const props = defineProps<{
  instantLUFS: number | null;
  instantRMS: number | null;
  audioSrc: string;
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
const histogramRef = ref<SVGSVGElement | null>(null);
const levelMeterRef = ref<SVGSVGElement | null>(null);
const momentaryMax = ref(0);
const shortTermMax = ref(0);
const truePeakMax = ref(0);

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
const moveRectangleToClick = (event: MouseEvent) => {
  if (!histogramRef.value || internalTime < timeScale.value * 1000) return; // 🔥 Bloque l'interaction avant 5s, 10s ou 30s

  const containerWidth = histogramRef.value.clientWidth || 400;
  const rect = d3.select(histogramRef.value).select(".draggable-rect");
  const rectWidth = parseFloat(rect.attr("width"));

  const clickX = event.offsetX;
  let newX = clickX - rectWidth / 2; // ✅ Centrer correctement

  newX = Math.max(0, Math.min(newX, containerWidth - rectWidth));

  rect.attr("x", newX);

  // ✅ Synchroniser le scroll avec le rectangle après le clic
  const proportion = newX / (containerWidth - rectWidth);
  viewOffset.value = proportion * (internalTime - timeScale.value * 1000);

  isAutoScrolling.value = false; // ✅ Activer le mode pause & scroll au clic
};

const dragOffset = ref(0); // 🔥 Stocker l'offset pour bien centrer le curseur

const dragStarted = (
  event: d3.D3DragEvent<SVGRectElement, unknown, unknown>
) => {
  if (internalTime < timeScale.value * 1000) return; // 🔥 Bloque le début du drag

  isAutoScrolling.value = false; // ✅ Désactiver l'auto-scroll
  const rect = d3.select(event.sourceEvent.target as SVGRectElement);

  // 🔥 Calculer l'offset entre le curseur et le bord gauche du rectangle
  const rectX = parseFloat(rect.attr("x"));
  dragOffset.value = event.x - rectX;

  rect.attr("cursor", "grabbing");
};

const dragged = (event: d3.D3DragEvent<SVGRectElement, unknown, unknown>) => {
  if (!histogramRef.value) return; // ✅ Évite l'erreur si l'élément n'est pas encore monté
  if (internalTime < timeScale.value * 1000) return; // 🔥 Bloque le déplacement

  const rect = d3.select(event.sourceEvent.target as SVGRectElement);
  const containerWidth = histogramRef.value.clientWidth || 400;
  const rectWidth = parseFloat(rect.attr("width"));

  let newX = event.x - dragOffset.value;
  newX = Math.max(0, Math.min(newX, containerWidth - rectWidth));

  rect.attr("x", newX);

  const proportion = newX / (containerWidth - rectWidth);
  viewOffset.value = proportion * (internalTime - timeScale.value * 1000);
};

const dragEnded = (event: d3.D3DragEvent<SVGRectElement, unknown, unknown>) => {
  d3.select(event.sourceEvent.target).attr("cursor", "grab");
};

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
  // ✅ Ajouter une ligne verticale qui suit la souris
  const verticalLine = svg
    .append("line")
    .attr("class", "cursor-line")
    .attr("x1", 0)
    .attr("x2", 0)
    .attr("y1", 0)
    .attr("y2", height)
    .attr("stroke", "#05c17f") // 🎨 Couleur semi-transparente
    .attr("stroke-width", 1.2)
    .attr("display", "none"); // ❌ Cachée par défaut

  startAnimation();
};

const initHistogram = async () => {
  await nextTick();
  if (!histogramRef.value) return;

  // Récupérer la largeur et hauteur du parent
  const containerWidth = histogramRef.value.parentElement?.clientWidth || 400;
  const containerHeight = 32;

  histogramRef.value.setAttribute("width", `${containerWidth}`);
  histogramRef.value.setAttribute("height", `${containerHeight}`);

  const histogramSvg = d3
    .select(histogramRef.value)
    .attr("width", containerWidth)
    .attr("height", containerHeight);

  const histogramXScale = d3.scaleLinear().range([0, containerWidth]);
  const histogramYScale = d3
    .scaleLinear()
    .domain([-30, 30])
    .range([containerHeight, 0]);

  const histogramXAxis = d3.axisBottom(histogramXScale).ticks(5);
  histogramSvg
    .append("g")
    .attr("transform", `translate(0, ${containerHeight})`)
    .call(histogramXAxis);

  histogramSvg
    .append("path")
    .attr("class", "histogram-area")
    .attr("fill", "#b030b080");

  histogramSvg
    .append("path")
    .attr("class", "histogram-line")
    .attr("fill", "none")
    .attr("stroke", "#f2f2f3")
    .attr("stroke-width", 2);

  // ✅ Ajout du rectangle draggable
  histogramSvg
    .append("rect")
    .attr("class", "draggable-rect")
    .attr("x", 0) // Position initiale au centre
    .attr("y", 0)
    .attr("width", 50)
    .attr("height", containerHeight)
    .attr("fill", "rgba(255, 255, 255, 0.3)")
    .attr("cursor", "grab")
    .call(
      d3
        .drag<SVGRectElement, unknown>()
        .on("start", dragStarted)
        .on("drag", dragged)
        .on("end", dragEnded)
    );
};
const initLevelMeter = async () => {
  await nextTick();
  if (!levelMeterRef.value) return;

  const meterWidth = 45; // Largeur du rectangle
  const meterHeight = 200;
  const barWidth = 15;
  const spacing = 5;
  const labelOffset = 0; // Décalage des labels à l'extérieur

  const svg = d3
    .select(levelMeterRef.value)
    .attr("width", meterWidth + 50) // Augmenté pour inclure la graduation
    .attr("height", meterHeight);

  // Échelle Y pour représenter les valeurs LUFS et RMS
  const yScale = d3.scaleLinear().domain([-38, 27]).range([meterHeight, 0]);

  // 📌 Valeurs des graduations en Y
  const tickValues = [-30, -15, 0, 10, 20, 25];

  // 📌 Ajout des labels de graduation
  svg
    .selectAll(".tick-label")
    .data(tickValues)
    .enter()
    .append("text")
    .attr("class", "tick-label")
    .attr("x", 16) // Placé à gauche du rectangle
    .attr("y", (d) => yScale(d) + 5) // Centré verticalement
    .attr("text-anchor", "end") // Aligné à droite
    .attr("font-size", "12px")
    .attr("fill", "#ffffff")
    .text((d) => `${d}`);

  // 📌 Ajout des barres horizontales pour chaque graduation
  svg
    .selectAll(".grid-line")
    .data(tickValues)
    .enter()
    .append("line")
    .attr("class", "grid-line")
    .attr("x1", 24) // Position de départ avant la graduation
    .attr("x2", 36) // Jusqu’au bout du rectangle
    .attr("y1", (d) => yScale(d))
    .attr("y2", (d) => yScale(d))
    .attr("stroke", "#ffffff33") // Couleur semi-transparente
    .attr("stroke-width", 1);

  // 📌 Fond des barres (grand rectangle)
  svg
    .append("rect")
    .attr("class", "meter-bg")
    .attr("x", 50) // Placé après la graduation
    .attr("y", 0)
    .attr("width", meterWidth)
    .attr("height", meterHeight)
    .attr("fill", "#10111d");

  // 📌 Barre LUFS (orange) à gauche
  svg
    .append("rect")
    .attr("class", "lufs-bar")
    .attr("x", 55) // Décalé après la graduation
    .attr("y", meterHeight)
    .attr("width", barWidth)
    .attr("height", 0)
    .attr("fill", "#05c17f");

  // 📌 Barre RMS (bleu) à droite
  svg
    .append("rect")
    .attr("class", "rms-bar")
    .attr("x", 55 + barWidth + spacing) // Décalé après la graduation
    .attr("y", meterHeight)
    .attr("width", barWidth)
    .attr("height", 0)
    .attr("fill", "#b030b0");
};

const updateLevelMeter = () => {
  if (!levelMeterRef.value) return;

  const meterHeight = 200;
  const yScale = d3.scaleLinear().domain([-30, 30]).range([meterHeight, 0]);

  const lufsHeight = Math.max(0, meterHeight - yScale(smoothedLUFS.value));
  const rmsHeight = Math.max(0, meterHeight - yScale(smoothedRMS.value));

  d3.select(levelMeterRef.value)
    .select(".lufs-bar")
    .transition()
    .duration(0)
    .attr("y", yScale(smoothedLUFS.value))
    .attr("height", lufsHeight);

  d3.select(levelMeterRef.value)
    .select(".rms-bar")
    .transition()
    .duration(0)
    .attr("y", yScale(smoothedRMS.value))
    .attr("height", rmsHeight);
};
let lastMetricUpdate = performance.now();
const METRIC_UPDATE_INTERVAL = 2000; // Met à jour toutes les 2 secondes

const updateLoudnessMetrics = () => {
  const now = performance.now();
  if (now - lastMetricUpdate < METRIC_UPDATE_INTERVAL) return; // Attendre 2 secondes avant MAJ
  lastMetricUpdate = now;

  if (props.instantLUFS === null) return;

  // Génération de valeurs réalistes avec variations plus lentes
  momentaryMax.value += Math.random() * 1.5 - 0.75; // Petit ajustement progressif ±0.75 LUFS
  shortTermMax.value += Math.random() * 1 - 0.5; // Petit ajustement ±0.5 LUFS
  truePeakMax.value += Math.random() * 1 - 0.5; // Petit ajustement ±0.5 dBTP

  // Limiter les valeurs minimales et maximales pour éviter les écarts irréalistes
  momentaryMax.value = Math.min(Math.max(momentaryMax.value, -35), -10);
  shortTermMax.value = Math.min(Math.max(shortTermMax.value, -40), -12);
  truePeakMax.value = Math.min(Math.max(truePeakMax.value, -8), 0);
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

const updateHistogram = () => {
  if (!histogramRef.value || data.value.length === 0) return;

  const containerWidth = histogramRef.value.clientWidth || 400;
  const containerHeight = histogramRef.value.clientHeight || 100; // 🔥 Adapter à la taille réelle du SVG

  const histogramSvg = d3.select(histogramRef.value);

  const firstTime = data.value[0]?.time ?? 0;
  const lastTime = data.value[data.value.length - 1]?.time ?? 1;

  // 🔥 Assurer que l’échelle X prend bien toute la largeur de l'histogramme
  const histogramXScale = d3
    .scaleLinear()
    .domain([firstTime, lastTime])
    .range([0, containerWidth]);

  // 🔥 Adapter l'échelle Y à la hauteur réelle du SVG
  const histogramYScale = d3
    .scaleLinear()
    .domain([-30, 30]) // Garde la même plage de valeurs
    .range([containerHeight, 0]); // 🔥 Ajusté à la taille réelle du SVG

  // 🔥 Met à jour l'affichage des données pour qu'elles remplissent bien tout l'histogramme
  histogramSvg
    .select(".histogram-area")
    .datum(data.value)
    .attr(
      "d",
      d3
        .area<{ time: number; rms: number }>()
        .x((d) => histogramXScale(d.time)) // Étend les points sur toute la largeur
        .y0(containerHeight) // 🔥 Ajuste la base des valeurs à la hauteur du SVG
        .y1((d) => histogramYScale(d.rms)) // 🔥 Ajuste la hauteur des valeurs
        .curve(d3.curveMonotoneX)
    );

  histogramSvg
    .select(".histogram-line")
    .datum(data.value)
    .attr(
      "d",
      d3
        .line<{ time: number; lufs: number }>()
        .x((d) => histogramXScale(d.time)) // Étend les points sur toute la largeur
        .y((d) => histogramYScale(d.lufs)) // 🔥 Ajuste la hauteur des valeurs
        .curve(d3.curveMonotoneX)
    );
};

// Animation fluide
const animateGraph = () => {
  if (!isAnimating) return;

  const now = performance.now();
  const deltaTime = now - lastUpdateTime;
  lastUpdateTime = now;
  const histogramSvg = d3.select(histogramRef.value);
  const histogramXScale = d3
    .scaleLinear()
    .domain([viewOffset.value, viewOffset.value + timeScale.value * 1000])
    .range([0, width]);

  histogramSvg.select(".histogram-bar").datum(data.value).attr("d", areaRMS);

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

  updateLoudnessMetrics();
  updateLevelMeter();
  updateHistogram();
};
const togglePause = () => {
  isAutoScrolling.value = !isAutoScrolling.value;

  if (isAutoScrolling.value) {
    viewOffset.value = internalTime - timeScale.value * 1000;

    if (!histogramRef.value) return; // ✅ Vérification ajoutée

    const rect = d3.select(histogramRef.value).select(".draggable-rect");
    const containerWidth = histogramRef.value.clientWidth || 400;
    const rectWidth = parseFloat(rect.attr("width"));

    const proportion =
      viewOffset.value / (internalTime - timeScale.value * 1000);
    const newX = proportion * (containerWidth - rectWidth);

    rect.attr("x", newX);
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
onMounted(initHistogram);

onMounted(() => {
  if (!histogramRef.value) return;

  d3.select(histogramRef.value).on("click", moveRectangleToClick);
});
onMounted(initLevelMeter);
onMounted(initChart);
</script>

<template>
  <div class="liveloudnesscontainer">
    <div class="chartContainer">
      <svg
        class="chart"
        ref="chartRef"
        @mousemove="handleMouseMove"
        @mouseleave="handleMouseLeave"
      ></svg>
      <svg class="histogram" ref="histogramRef"></svg>

      <!-- ✅ Tooltip FIXE en haut à droite -->
      <div ref="tooltip" class="tooltip">
        <p id="tooltip-time">POS: --s</p>
        <p id="tooltip-lufs">S: --</p>
        <p id="tooltip-rms">TP: --</p>
      </div>
    </div>
    <div class="controls">
      <label class="custom-select-container">
        <div class="custom-select-wrapper">
          <select v-model="timeScale" class="custom-select">
            <option :value="5">5s</option>
            <option :value="10">10s</option>
            <option :value="30">30s</option>
          </select>
        </div>
      </label>

      <input
        type="range"
        min="5"
        max="60"
        v-model="timeScale"
        style="display: none"
      />
      <div class="tools__button">
        <button @click="data = []">
          <svg width="18" height="16" viewBox="0 0 18 16" fill="none">
            <path
              class="buttonfill"
              fill-rule="evenodd"
              clip-rule="evenodd"
              d="M4.11782 16L0.213091 12.0982C0.0712727 11.9564 0 11.7709 0 11.584C0 11.3978 0.0712727 11.2116 0.213091 11.0698L11.0705 0.213091C11.2124 0.072 11.3985 0 11.5847 0C11.7702 0 11.9571 0.072 12.0989 0.213091L17.2415 5.35709C17.384 5.49891 17.4545 5.68509 17.4545 5.872C17.4545 6.05818 17.384 6.24364 17.2415 6.38618L9.08436 14.5455H13.0945V16H4.11782ZM6.77745 14.5455L2.78764 10.5556L1.75564 11.584L4.72 14.5455H6.77745ZM7.10909 6.23345L3.816 9.52655L7.93091 13.6422L11.2233 10.3476L7.10909 6.23345Z"
              fill="#161726"
            />
          </svg>
        </button>
        <button @click="togglePause" :class="{ disabled: !isAutoScrolling }">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              class="buttonfill"
              d="M12.6 14V0H14V14H12.6ZM0 14L11.2 7L0 0V14Z"
              fill="#161726"
            />
          </svg>
        </button>
      </div>
    </div>
    <div class="mastercontainer">
      <svg class="level-meter" ref="levelMeterRef"></svg>
      <ul class="loudness-metrics">
        <li>
          <span>{{ momentaryMax.toFixed(1) }} LUFS</span>Momentary Max
        </li>
        <li>
          <span>{{ shortTermMax.toFixed(1) }} LUFS</span>Short Term Max
        </li>
        <li>
          <span>{{ truePeakMax.toFixed(1) }} dB</span>True Peak Max
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.liveloudnesscontainer {
  display: grid;
  grid-template-columns: auto auto;
  grid-template-rows: auto auto;
}
.chartContainer {
  position: relative;
  overflow: hidden;
  background-color: #23253a;
  border-radius: 8px 8px 0 0;
}
svg.chart {
  margin: 0 12px 40px 64px;
  overflow: visible;
  position: relative;
  display: flex;
  flex-direction: column;
}
svg.histogram {
  width: 100%;
  padding: 0 16px;
}

.controls {
  display: flex;
  justify-content: space-between;
  padding: 0 16px 16px;
  background: #23253a;
  border-radius: 0 0 8px 8px;
  grid-column: 1;
}
button {
  height: 32px;
  width: 32px;
  margin-left: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 4px;
  background: #e1e1e4;
  color: white;
  cursor: pointer;
}
button:hover {
  background: #7f819e;
}
button.disabled {
  background: #2fb5d0;
}
button.disabled .buttonfill {
  fill: #f2f2f3;
}

.tools__button {
  display: flex;
  align-items: center;
}
.tooltip {
  position: absolute;
  background: #161726d8;

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

.draggable-rect {
  stroke: white;
  stroke-width: 1;
}
.draggable-rect.disabled {
  pointer-events: none;
  opacity: 0;
}

.custom-select-container {
  display: flex;
  flex-direction: column;
  font-family: "Arial", sans-serif;
  font-size: 14px;
  color: #ccc;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-top: 8px;
}

.custom-select-wrapper {
  position: relative;
  width: 120px;
}

.custom-select {
  appearance: none; /* Supprime le style natif */
  background: #1c1e30;
  border: none;
  color: #ffffff;
  font-size: 14px;
  padding: 8px 12px;
  width: 100%;
  border-radius: 4px;
  cursor: pointer;
  outline: none;
  transition: all 0.1s ease-in-out;
}

/* Ajout d'une icône de dropdown (flèche vers le bas) */
.custom-select-wrapper::after {
  content: "▼";
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 12px;
  color: #afafaf;
  pointer-events: none;
}

/* Effet au survol */
.custom-select:hover {
  border-color: #05c17f;
  box-shadow: 0 0 5px #05c17f;
}

/* Effet au focus */
.custom-select:focus {
  border-color: #05c17f;
  box-shadow: 0 0 5px #05c17f;
}

/* Style des options */
.custom-select option {
  background: #1c1e30;
  color: #fff;
  padding: 5px;
  font-size: 14px;
}

.mastercontainer {
  display: flex;
  flex-direction: column-reverse;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  background: #161726d8;
  border-radius: 0 8px 8px 0;
  grid-row: 1 / span 2;
  grid-column: 2;
}

svg.level-meter {
  /* background: #1c1e30; */
  border-radius: 4px;
  padding: 8px 0;
  overflow-x: visible;
}

.lufs-bar {
  opacity: 0.7; /* Légère transparence pour voir RMS au-dessus */
}

.loudness-metrics {
  list-style: none;
  margin: 0;
  padding: 0;
  color: #ffffff;
  font-size: 14px;
  text-align: left;
}

.loudness-metrics li {
  text-transform: uppercase;
  text-align: justify;
  align-items: center;
  width: 100%;
  font-size: 12px;
  margin-bottom: 12px;
  display: flex;
  flex-direction: column;
}
.loudness-metrics span {
  background-color: #23253a;
  color: white;

  text-align: center;
  width: 100%;
  border-radius: 4px;
  margin-bottom: 8px;
  padding: 6px 12px;
}
</style>
