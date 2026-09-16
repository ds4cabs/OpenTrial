/* The chart displays engine output; all statistics are computed in Python. */
function drawPowerChart(container, result) {
  const { grid, design, recommendation } = result;
  if (!grid.length) { container.textContent = "No operating characteristics available."; return; }
  const padding = getComputedStyle(container);
  const width = Math.max(280, container.clientWidth - parseFloat(padding.paddingLeft) - parseFloat(padding.paddingRight));
  const height = width < 450 ? 290 : 320;
  const left = 43, right = 18, top = 30, bottom = 48;
  const xMin = grid[0].n_per_arm, xMax = grid.at(-1).n_per_arm;
  const x = n => left + (n - xMin) / (xMax - xMin || 1) * (width - left - right);
  const y = p => top + (1 - p) * (height - top - bottom);
  const path = key => grid.map((point, i) => `${i ? "L" : "M"}${x(point.n_per_arm).toFixed(2)},${y(point[key]).toFixed(2)}`).join(" ");
  const horizontal = [0, .2, .4, .6, .8, 1].map(value => `<line class="grid-line" x1="${left}" x2="${width - right}" y1="${y(value)}" y2="${y(value)}"/><text x="${left - 10}" y="${y(value) + 4}" text-anchor="end">${Math.round(value * 100)}%</text>`).join("");
  const tickCount = width < 450 ? 4 : 6;
  const tickIndices = [...new Set(Array.from({length: tickCount}, (_, i) => Math.round(i * (grid.length - 1) / (tickCount - 1))))];
  const ticks = tickIndices.map(i => `<text x="${x(grid[i].n_per_arm)}" y="${height - bottom + 22}" text-anchor="middle">${grid[i].n_per_arm}</text>`).join("");
  const rec = recommendation;
  const recX = rec ? x(rec.n_per_arm) : 0;
  const recRight = recX < width / 2;
  const recMarkup = rec ? `<line class="rec-line" x1="${recX}" x2="${recX}" y1="${top}" y2="${height - bottom}"/><circle class="rec-dot" cx="${recX}" cy="${y(rec.power)}" r="5"/><text class="rec-text" x="${recX + (recRight ? 9 : -9)}" y="17" text-anchor="${recRight ? "start" : "end"}">Recommended N = ${rec.n_per_arm}</text>` : "";
  container.innerHTML = `<div class="chart-legend"><span><i class="legend-line"></i>Power</span><span><i class="legend-line assurance"></i>Bayesian assurance</span><span><i class="legend-line target"></i>Target power</span></div>
    <svg class="power-svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="chart-title chart-description"><title id="chart-title">Power and Bayesian assurance by sample size</title><desc id="chart-description">Target power is ${Math.round(design.desired_power * 100)} percent. ${rec ? `Recommended enrollment is ${rec.n_per_arm} per arm.` : `The target is not reached by ${design.max_n_per_arm} per arm.`} The table below contains every value.</desc>${horizontal}${ticks}<line class="target-line" x1="${left}" x2="${width - right}" y1="${y(design.desired_power)}" y2="${y(design.desired_power)}"/><line class="alpha-line" x1="${left}" x2="${width - right}" y1="${y(design.alpha)}" y2="${y(design.alpha)}"/><path class="curve power-line" d="${path("power")}"/><path class="curve assurance-line" d="${path("assurance")}"/>${recMarkup}<text x="${width - right - 3}" y="${y(design.desired_power) - 7}" text-anchor="end">Target ${Math.round(design.desired_power * 100)}%</text><text x="${width - right - 3}" y="${y(design.alpha) - 6}" text-anchor="end">α = ${design.alpha.toFixed(3)}</text><text x="${width / 2}" y="${height - 4}" text-anchor="middle">Participants enrolled per arm</text><line class="inspect-line rec-line" id="inspect-line" x1="0" x2="0" y1="${top}" y2="${height - bottom}" hidden/></svg>
    <div class="chart-inspector"><label for="inspect-n">Explore sample sizes</label><input id="inspect-n" type="range" min="0" max="${grid.length - 1}" step="1" value="0"></div><output class="chart-readout" id="chart-readout" for="inspect-n"></output>`;
  const slider = container.querySelector("#inspect-n");
  const readout = container.querySelector("#chart-readout");
  const line = container.querySelector("#inspect-line");
  function inspect(index) {
    const point = grid[index];
    slider.value = index;
    slider.setAttribute("aria-valuetext", `${point.n_per_arm} participants per arm`);
    line.removeAttribute("hidden");
    line.setAttribute("x1", x(point.n_per_arm));
    line.setAttribute("x2", x(point.n_per_arm));
    readout.textContent = `N = ${point.n_per_arm} per arm · Power ${(point.power * 100).toFixed(1)}% · Assurance ${(point.assurance * 100).toFixed(1)}% · Beta ${(point.beta * 100).toFixed(1)}%`;
  }
  inspect(Math.max(0, grid.findIndex(p => p.n_per_arm === rec?.n_per_arm)));
  slider.addEventListener("input", () => inspect(Number(slider.value)));
  container.querySelector("svg").addEventListener("pointermove", event => {
    if (event.pointerType === "touch") return;
    const rect = event.currentTarget.getBoundingClientRect();
    const sampleN = xMin + ((event.clientX - rect.left) / rect.width * width - left) / (width - left - right) * (xMax - xMin);
    let closest = 0;
    grid.forEach((point, index) => { if (Math.abs(point.n_per_arm - sampleN) < Math.abs(grid[closest].n_per_arm - sampleN)) closest = index; });
    inspect(closest);
  });
}

window.renderPowerChart = (container, result) => {
  container.chartObserver?.disconnect();
  let lastWidth = 0;
  const redraw = () => {
    // Hidden views have no width. Draw when the Results view becomes visible.
    if (container.clientWidth && container.clientWidth !== lastWidth) {
      lastWidth = container.clientWidth;
      drawPowerChart(container, result);
    }
  };
  container.chartObserver = new ResizeObserver(redraw);
  container.chartObserver.observe(container);
  redraw();
};
