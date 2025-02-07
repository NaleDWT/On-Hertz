<script setup lang="ts">
import { ref, watch, onMounted, nextTick } from "vue";
import * as d3 from "d3";
import { interpolateString } from "d3-interpolate";
import interact from "interactjs";
const props = defineProps<{
  instantLUFS: number | null;
  instantRMS: number | null;
  audioSrc: string;
}>();

const smoothedLUFS = ref(0);
const smoothedRMS = ref(0);
const smoothingFactor = 0.2;

const data = ref<{ time: number; lufs: number; rms: number }[]>([]);
const chartRef = ref<SVGSVGElement | null>(null);
const timeScale = ref(10);
const width = 400,
  height = 300;

const timelineDuration = ref(120);
const viewOffset = ref(0);
const isAutoScrolling = ref(true);
const tooltip = ref<HTMLElement | null>(null);
const histogramRef = ref<SVGSVGElement | null>(null);
const levelMeterRef = ref<SVGSVGElement | null>(null);
const momentaryMax = ref(0);
const shortTermMax = ref(0);
const truePeakMax = ref(0);
const liveLoudnessContainer = ref<HTMLDivElement | null>(null);

let svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
let xScale: d3.ScaleLinear<number, number>;
let yScale: d3.ScaleLinear<number, number>;
let lineLUFS: d3.Line<{ time: number; lufs: number }>;
let lineRMS: d3.Line<{ time: number; rms: number }>;
let areaRMS: d3.Area<{ time: number; rms: number }>;

let xAxis: d3.Axis<d3.NumberValue>;
let yAxis: d3.Axis<d3.NumberValue>;
let xAxisGroup: d3.Selection<SVGGElement, unknown, null, undefined>;
let yAxisGroup: d3.Selection<SVGGElement, unknown, null, undefined>;

let internalTime = 0;
let lastUpdateTime = 0;
let intervalId: ReturnType<typeof setInterval> | null = null;
let animationFrameId: number | null = null;
let isAnimating = false;

const smoothValue = (
  current: number,
  newValue: number | null,
  factor: number
) => {
  return newValue !== null
    ? current * (1 - factor) + newValue * factor
    : current;
};

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
};

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
  if (!histogramRef.value || internalTime < timeScale.value * 1000) return;

  const containerWidth = histogramRef.value.clientWidth || 400;
  const rect = d3.select(histogramRef.value).select(".draggable-rect");
  const rectWidth = parseFloat(rect.attr("width"));

  const clickX = event.offsetX;
  let newX = clickX - rectWidth / 2;

  newX = Math.max(0, Math.min(newX, containerWidth - rectWidth));

  rect.attr("x", newX);

  const proportion = newX / (containerWidth - rectWidth);
  viewOffset.value = proportion * (internalTime - timeScale.value * 1000);

  isAutoScrolling.value = false;
};

const dragOffset = ref(0);

const dragStarted = (
  event: d3.D3DragEvent<SVGRectElement, unknown, unknown>
) => {
  if (internalTime < timeScale.value * 1000) return;

  isAutoScrolling.value = false;
  const rect = d3.select(event.sourceEvent.target as SVGRectElement);

  const rectX = parseFloat(rect.attr("x"));
  dragOffset.value = event.x - rectX;

  rect.attr("cursor", "grabbing");
};

const dragged = (event: d3.D3DragEvent<SVGRectElement, unknown, unknown>) => {
  if (!histogramRef.value) return;
  if (internalTime < timeScale.value * 1000) return;

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

const initChart = async () => {
  await nextTick();
  if (!chartRef.value) return;

  svg = d3.select(chartRef.value).attr("width", width).attr("height", height);
  svg
    .append("defs")
    .append("clipPath")
    .attr("id", "clip")
    .append("rect")
    .attr("width", width - 10)
    .attr("height", height)
    .attr("x", 5)
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
    .range([0, width * (timelineDuration.value / timeScale.value)]);

  xScale = d3
    .scaleLinear()
    .domain([internalTime - timeScale.value * 1000, internalTime])
    .range([0, width]);

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
      const allowedTicks = [25, 20, 10, 0, -15, -30];
      return allowedTicks.includes(Number(d))
        ? `${Math.round(Number(d))} dB`
        : "";
    });

  xAxisGroup.select(".domain").style("display", "none");

  xAxisGroup.call(xAxis);
  xAxisGroup.select(".domain").style("stroke", "none");

  yAxisGroup.call(yAxis);

  yAxisGroup
    .selectAll(".tick")
    .filter(function () {
      const tickText = d3.select(this).select("text").text();
      return tickText !== "";
    })
    .append("line")
    .attr("x1", 15)
    .attr("x2", width)
    .attr("stroke", "#ffffff1e")
    .attr("stroke-width", 1);

  yAxisGroup.select(".domain").style("stroke", "none");
  yAxisGroup
    .selectAll("text")
    .style("font-size", "12px")
    .style("fill", "white");
  xAxisGroup
    .selectAll("text")
    .style("font-size", "12px")
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
    .attr("clip-path", "url(#clip)");

  svg
    .append("path")
    .attr("class", "lufs-line")
    .attr("fill", "none")
    .attr("stroke", "#f2f2f3")
    .attr("stroke-width", 2)
    .attr("clip-path", "url(#clip)");

  svg
    .append("path")
    .attr("class", "rms-line")
    .attr("fill", "none")
    .attr("stroke", "#b030b0")
    .attr("stroke-width", 2)
    .attr("clip-path", "url(#clip)");

  const verticalLine = svg
    .append("line")
    .attr("class", "cursor-line")
    .attr("x1", 0)
    .attr("x2", 0)
    .attr("y1", 0)
    .attr("y2", height)
    .attr("stroke", "#05c17f")
    .attr("stroke-width", 1.2)
    .attr("display", "none");

  startAnimation();
};

const initHistogram = async () => {
  await nextTick();
  if (!histogramRef.value) return;

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

  histogramSvg
    .append("rect")
    .attr("class", "draggable-rect")
    .attr("x", 0)
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

  const meterWidth = 45;
  const meterHeight = 200;
  const barWidth = 15;
  const spacing = 5;
  const labelOffset = 0;

  const svg = d3
    .select(levelMeterRef.value)
    .attr("width", meterWidth + 50)
    .attr("height", meterHeight);

  const yScale = d3.scaleLinear().domain([-38, 27]).range([meterHeight, 0]);

  const tickValues = [-30, -15, 0, 10, 20, 25];

  svg
    .selectAll(".tick-label")
    .data(tickValues)
    .enter()
    .append("text")
    .attr("class", "tick-label")
    .attr("x", 16)
    .attr("y", (d) => yScale(d) + 5)
    .attr("text-anchor", "end")
    .attr("font-size", "12px")
    .attr("fill", "#ffffff")
    .text((d) => `${d}`);

  svg
    .selectAll(".grid-line")
    .data(tickValues)
    .enter()
    .append("line")
    .attr("class", "grid-line")
    .attr("x1", 24)
    .attr("x2", 36)
    .attr("y1", (d) => yScale(d))
    .attr("y2", (d) => yScale(d))
    .attr("stroke", "#ffffff33")
    .attr("stroke-width", 1);

  svg
    .append("rect")
    .attr("class", "meter-bg")
    .attr("x", 50)
    .attr("y", 0)
    .attr("width", meterWidth)
    .attr("height", meterHeight)
    .attr("fill", "#10111d");

  svg
    .append("rect")
    .attr("class", "lufs-bar")
    .attr("x", 55)
    .attr("y", meterHeight)
    .attr("width", barWidth)
    .attr("height", 0)
    .attr("fill", "#05c17f");

  svg
    .append("rect")
    .attr("class", "rms-bar")
    .attr("x", 55 + barWidth + spacing)
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
const METRIC_UPDATE_INTERVAL = 2000;

const updateLoudnessMetrics = () => {
  const now = performance.now();
  if (now - lastMetricUpdate < METRIC_UPDATE_INTERVAL) return;
  lastMetricUpdate = now;

  if (props.instantLUFS === null) return;

  momentaryMax.value += Math.random() * 1.5 - 0.75;
  shortTermMax.value += Math.random() * 1 - 0.5;
  truePeakMax.value += Math.random() * 1 - 0.5;
  momentaryMax.value = Math.min(Math.max(momentaryMax.value, -35), -10);
  shortTermMax.value = Math.min(Math.max(shortTermMax.value, -40), -12);
  truePeakMax.value = Math.min(Math.max(truePeakMax.value, -8), 0);
};

const startAnimation = () => {
  if (isAnimating) return;
  isAnimating = true;
  animateGraph();
};

const stopAnimation = () => {
  if (!isAnimating) return;
  isAnimating = false;
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
};

const updateHistogram = () => {
  if (!histogramRef.value || data.value.length === 0) return;

  const containerWidth = histogramRef.value.clientWidth || 400;
  const containerHeight = histogramRef.value.clientHeight || 100;

  const histogramSvg = d3.select(histogramRef.value);

  const firstTime = data.value[0]?.time ?? 0;
  const lastTime = data.value[data.value.length - 1]?.time ?? 1;

  const histogramXScale = d3
    .scaleLinear()
    .domain([firstTime, lastTime])
    .range([0, containerWidth]);

  const histogramYScale = d3
    .scaleLinear()
    .domain([-30, 30])
    .range([containerHeight, 0]);

  histogramSvg
    .select(".histogram-area")
    .datum(data.value)
    .attr(
      "d",
      d3
        .area<{ time: number; rms: number }>()
        .x((d) => histogramXScale(d.time))
        .y0(containerHeight)
        .y1((d) => histogramYScale(d.rms))
        .curve(d3.curveMonotoneX)
    );

  histogramSvg
    .select(".histogram-line")
    .datum(data.value)
    .attr(
      "d",
      d3
        .line<{ time: number; lufs: number }>()
        .x((d) => histogramXScale(d.time))
        .y((d) => histogramYScale(d.lufs))
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

  xScale.domain([viewOffset.value, viewOffset.value + timeScale.value * 1000]);

  xAxisGroup.transition().duration(0).ease(d3.easeLinear).call(xAxis);
  xAxisGroup
    .selectAll("text")
    .style("font-size", "12px")
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

    if (!histogramRef.value) return;

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
    viewOffset.value += event.deltaY * 10;
    viewOffset.value = Math.max(
      0,
      Math.min(viewOffset.value, internalTime - timeScale.value * 1000)
    );
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

  const svgRect = chartRef.value.getBoundingClientRect();
  const mouseX = event.clientX - svgRect.left;

  const timeAtCursor = xScale.invert(mouseX);

  if (data.value.length === 0) return;

  const closestData =
    data.value.length > 1
      ? data.value.reduce((prev, curr) =>
          Math.abs(curr.time - timeAtCursor) <
          Math.abs(prev.time - timeAtCursor)
            ? curr
            : prev
        )
      : data.value[0];

  document.getElementById("tooltip-time")!.innerText = `POS: ${(
    timeAtCursor / 1000
  ).toFixed(1)}s`;
  document.getElementById(
    "tooltip-lufs"
  )!.innerText = `S: ${closestData.lufs.toFixed(2)}`;
  document.getElementById(
    "tooltip-rms"
  )!.innerText = `TP: ${closestData.rms.toFixed(2)}`;

  tooltip.value.style.opacity = "1";

  svg
    .select(".cursor-line")
    .attr("x1", mouseX)
    .attr("x2", mouseX)
    .attr("display", "block");
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

onMounted(() => {
  if (!liveLoudnessContainer.value) return;

  interact(".windowheader").draggable({
    listeners: {
      start(event) {},
      move(event) {
        const target = liveLoudnessContainer.value;
        if (!target) return;

        // Récupérer les positions actuelles
        const x =
          (parseFloat(target.getAttribute("data-x") || "0") || 0) + event.dx;
        const y =
          (parseFloat(target.getAttribute("data-y") || "0") || 0) + event.dy;

        // Appliquer la transformation CSS pour déplacer le conteneur
        target.style.transform = `translate(${x}px, ${y}px)`;

        // Stocker la position pour l'utiliser lors des prochains déplacements
        target.setAttribute("data-x", `${x}`);
        target.setAttribute("data-y", `${y}`);
      },
      end(event) {},
    },
  });
});
</script>

<template>
  <div ref="liveLoudnessContainer" class="liveloudnesscontainer">
    <div class="windowheader">Live Loudness Analyser</div>
    <div class="chartContainer">
      <svg
        class="chart"
        ref="chartRef"
        @mousemove="handleMouseMove"
        @mouseleave="handleMouseLeave"
      ></svg>
      <svg class="histogram" ref="histogramRef"></svg>

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
