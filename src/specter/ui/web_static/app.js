const app = document.querySelector("#app");
const screen = document.querySelector("#screen");
const fieldStatus = document.querySelector("#field-status");
const entityStatus = document.querySelector("#entity-status");
const modeStatus = document.querySelector("#mode-status");
const menuButton = document.querySelector("#menu-button");
const clock = document.querySelector("#clock");

const params = new URLSearchParams(window.location.search);
const BOOT_DELAY_MS = 2600;
const SCREENSAVER_DELAY_MS = Number(params.get("screensaver")) || 120000;
const ECHO_REFRESH_MS = Number(params.get("echo")) || 5000;

let latestPayload = null;
let analysisRunning = false;
let activeView = "boot";
let analysisProgressTimer = null;
let screensaverTimer = null;
let screensaverActive = false;
let echoSamples = [];

function setClock() {
  const now = new Date();
  clock.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function value(path, fallback = null) {
  return path.reduce((current, key) => current && current[key] !== undefined ? current[key] : null, latestPayload) ?? fallback;
}

function scan() {
  return latestPayload?.scan ?? {};
}

function link() {
  return scan().link ?? {};
}

function ping(name) {
  return scan()[name] ?? null;
}

function throughput() {
  return scan().throughput ?? null;
}

function severity() {
  return scan().severity ?? "unknown";
}

function formatResonance() {
  const speed = link().speed_mbps;
  const duplex = link().duplex ? String(link().duplex).toUpperCase() : "UNKNOWN";
  if (!link().link_detected) return "FIELD COLLAPSE";
  if (speed >= 1000) return `1000BASE-T / ${duplex}`;
  if (speed === 100) return `100BASE-TX / ${duplex}`;
  if (speed) return `${speed} Mbps / ${duplex}`;
  return "UNKNOWN";
}

function formatAddress() {
  const config = scan().ip_config;
  if (!config) return "not assigned";
  if (config.primary_ipv4) return config.primary_ipv4;
  const ipv4 = (config.addresses ?? []).find((entry) => entry.family === "inet");
  return ipv4?.address ?? "not assigned";
}

function formatTarget() {
  return ping("remote_ping")?.target ?? "specter-re01.local";
}

function formatLatency(result) {
  if (!result || !result.reachable) return "unreachable";
  return result.avg_latency_ms === null ? "unknown" : `${Number(result.avg_latency_ms).toFixed(2)} ms`;
}

function currentEchoMs() {
  const result = ping("remote_ping");
  if (!result || !result.reachable || result.avg_latency_ms === null) return null;
  return Number(result.avg_latency_ms);
}

function formatLoss(result) {
  if (!result) return "unknown";
  return result.packet_loss_percent === null ? "unknown" : `${Number(result.packet_loss_percent).toFixed(2)} %`;
}

function formatCapacity() {
  const result = throughput();
  if (!result) return "not run";
  if (!result.success) return "failed";
  return result.mbps === null ? "unknown" : `${Math.round(result.mbps)} Mbps`;
}

function conditionText() {
  const current = severity();
  if (current === "pass") return "STABLE";
  if (current === "warn") return "ANOMALY";
  if (current === "fail") return "CRITICAL";
  return "UNKNOWN PHENOMENON";
}

function setActiveView(view) {
  activeView = view;
  updateFooter();
}

function updateFooter() {
  const field = link().link_detected ? "LOCKED" : "COLLAPSED";
  const entity = ping("remote_ping")?.reachable ? "RE-01" : "UNRESOLVED";
  fieldStatus.textContent = field;
  entityStatus.textContent = entity;
  modeStatus.textContent =
    activeView === "analysis" ? "ANALYSIS" :
    activeView === "result" ? "RESULT" :
    activeView === "menu" ? "MENU" :
    activeView === "info" ? "INFO" :
    activeView === "boot" ? "BOOT" :
    activeView === "screensaver" ? "STANDBY" :
    "READY";
}

function subsystemRows() {
  return `
    <div class="boot-row"><span>ETHERNETIC INTERFACE</span><span>READY</span></div>
    <div class="boot-row"><span>DIAGNOSTIC CORE</span><span>READY</span></div>
    <div class="boot-row"><span>SPECTRAL PROCESSOR</span><span>READY</span></div>
    <div class="boot-row"><span>FIELD SENSOR ARRAY</span><span>READY</span></div>
    <div class="boot-row"><span>LOCAL ENTITY</span><span>ES-01</span></div>
  `;
}

function bootScreen() {
  app.classList.remove("screensaver-mode");
  setActiveView("boot");
  screen.innerHTML = `
    <div class="boot">
      <section class="boot-mark">
        <div class="typeplate">SPECTRAL PACKET & ETHERNETIC COMMUNICATION TEST AND EVALUATION RIG</div>
        <h1><span>◈</span>SPECTER</h1>
        <p>ES-01<br>PORTABLE ETHERNETIC<br>SPECTROMETER</p>
        <div class="plate-grid">
          <span>CAL REF 01</span>
          <span>CH-A / ETH0</span>
          <span>FIELD UNIT</span>
        </div>
      </section>
      <section class="boot-list">
        <h2 class="screen-title">SYSTEM INITIALIZATION</h2>
        ${subsystemRows()}
        <p class="screen-subtitle">CALIBRATING FIELD INTERFACE...</p>
      </section>
    </div>
  `;
}

function idleScreen() {
  setActiveView("idle");
  screen.innerHTML = `
    <div class="idle">
      <section>
        <div class="status-symbol amber">△</div>
        <h1>NO ETHERNETIC ACTIVITY</h1>
        <p>CONNECT TEST SUBJECT TO ETH0</p>
        <div class="trace" aria-hidden="true"></div>
      </section>
    </div>
  `;
}

function faultScreen(title, message, reference, action = "RETRY") {
  setActiveView("fault");
  screen.innerHTML = `
    <div class="fault-layout">
      <section class="fault-panel">
        <p class="typeplate">ANOMALY REGISTER</p>
        <h1>${title}</h1>
        <p>${message}</p>
        <div class="error-code">REFERENCE ${reference}</div>
      </section>
      <aside class="panel panel-compact">
        <p class="label">CORRECTIVE ACTION</p>
        <div class="actions">
          <button class="action" type="button" data-action="refresh">${action}</button>
          <button class="action secondary" type="button" data-action="menu">OPEN MENU</button>
        </div>
      </aside>
    </div>
  `;
}

function readyScreen() {
  setActiveView("ready");
  const stateClass = severity() === "warn" ? "anomaly" : severity() === "fail" ? "critical" : "";
  screen.innerHTML = `
    <div class="ready-layout">
      <section class="panel">
        <div class="panel-heading">
          <span class="section-code">FIELD ANALYSIS SECTION / CH-A</span>
          <h2 class="screen-title">ETHERNETIC FIELD STATUS</h2>
        </div>
        <div class="metrics">
          <div class="metric-row"><span class="label">LINK RESONANCE<br><span class="code">ETHERNET LINK</span></span><strong>${formatResonance()}</strong></div>
          <div class="metric-row"><span class="label">LOCAL ENTITY<br><span class="code">IP CONFIGURATION</span></span><strong>${formatAddress()}</strong></div>
          <div class="metric-row"><span class="label">GATEWAY RESPONSE<br><span class="code">PING RTT</span></span><strong>${formatLatency(ping("gateway_ping"))}</strong></div>
          <div class="metric-row"><span class="label">REMOTE ENTITY<br><span class="code">DISCOVERY TARGET</span></span><strong>${ping("remote_ping")?.reachable ? "SPECTER RE-01" : "NOT ACQUIRED"}</strong></div>
          <div class="metric-row"><span class="label">ECHO RESPONSE<br><span class="code">REMOTE PING RTT</span></span><strong>${formatLatency(ping("remote_ping"))}</strong></div>
        </div>
      </section>
      <aside class="panel control-panel">
        <div class="condition ${stateClass}">
          <span class="label">FIELD CONDITION</span>
          <strong><span class="status-symbol">●</span>${conditionText()}</strong>
        </div>
        <div class="readout">
          <span>TYPEPLATE</span>
          <strong>ES-01 / ETH0</strong>
        </div>
        <div class="echo-panel">
          <div class="echo-panel-header">
            <span class="label">ECHO RESPONSE TRACE</span>
            <strong>${formatLatency(ping("remote_ping"))}</strong>
          </div>
          ${echoCurveSvg()}
        </div>
        <button class="action action-primary" type="button" data-action="analysis">INITIATE ANALYSIS</button>
      </aside>
    </div>
  `;
}

function menuScreen() {
  setActiveView("menu");
  screen.innerHTML = `
    <div class="menu-layout">
      <section class="panel menu-panel">
        <div class="panel-heading">
          <span class="section-code">OPERATOR SELECTION MATRIX</span>
          <h2 class="screen-title">SPECTER MENU</h2>
        </div>
        <div class="menu-grid">
          <button class="menu-tile" type="button" data-action="analysis">
            <span>01</span>
            <strong>FULL ANALYSIS</strong>
            <em>Link, echo, loss, capacity</em>
          </button>
          <button class="menu-tile" type="button" data-action="entity">
            <span>02</span>
            <strong>ENTITY SCAN</strong>
            <em>Acquire RE-01 presence</em>
          </button>
          <button class="menu-tile" type="button" data-action="info">
            <span>03</span>
            <strong>UNIT PLATE</strong>
            <em>Boot and identity register</em>
          </button>
          <button class="menu-tile" type="button" data-action="diagnostics">
            <span>04</span>
            <strong>DIAGNOSTICS</strong>
            <em>Technical register view</em>
          </button>
        </div>
      </section>
      <aside class="panel panel-compact">
        <p class="label">UNIT STATUS</p>
        <div class="readout">
          <span>FIELD</span>
          <strong>${link().link_detected ? "LOCKED" : "COLLAPSED"}</strong>
        </div>
        <button class="action secondary" type="button" data-action="refresh">RETURN</button>
      </aside>
    </div>
  `;
}

function infoScreen() {
  setActiveView("info");
  screen.innerHTML = `
    <div class="boot info-plate">
      <section class="boot-mark">
        <div class="typeplate">SPECTRAL PACKET & ETHERNETIC COMMUNICATION TEST AND EVALUATION RIG</div>
        <h1><span>◈</span>SPECTER</h1>
        <p>ES-01<br>PORTABLE ETHERNETIC<br>SPECTROMETER</p>
        <div class="plate-grid">
          <span>MODEL ES-01</span>
          <span>REMOTE ENTITY CLASS RE-01</span>
          <span>CAL REF 01 / CH-A / ETH0</span>
        </div>
      </section>
      <section class="boot-list">
        <h2 class="screen-title">UNIT PLATE</h2>
        ${subsystemRows()}
        <button class="action secondary" type="button" data-action="menu">RETURN TO MENU</button>
      </section>
    </div>
  `;
}

function entityScanScreen() {
  setActiveView("analysis");
  screen.innerHTML = `
    <div class="entity-scan">
      <section class="panel scan-panel">
        <div class="panel-heading">
          <span class="section-code">ENTITY ACQUISITION / LOCAL SECTOR</span>
          <h2 class="screen-title">ENTITY SCAN</h2>
        </div>
        <div class="scan-reticle" aria-hidden="true">
          <span></span>
        </div>
        <p>SEARCHING FOR REMOTE ENTITY</p>
        <strong>${formatTarget()}</strong>
      </section>
    </div>
  `;
  setTimeout(() => fetchScan(false), 1400);
}

function diagnosticsScreen() {
  setActiveView("menu");
  screen.innerHTML = `
    <div class="fault-layout">
      <section class="panel">
        <div class="panel-heading">
          <span class="section-code">TECHNICAL REGISTER</span>
          <h2 class="screen-title">DIAGNOSTICS</h2>
        </div>
        <div class="metrics">
          <div class="metric-row"><span class="label">INTERFACE</span><strong>${scan().interface ?? "unknown"}</strong></div>
          <div class="metric-row"><span class="label">REMOTE TARGET</span><strong>${formatTarget()}</strong></div>
          <div class="metric-row"><span class="label">GATEWAY</span><strong>${scan().ip_config?.gateway ?? "not found"}</strong></div>
          <div class="metric-row"><span class="label">DNS</span><strong>${(scan().ip_config?.dns_servers ?? []).join(", ") || "not found"}</strong></div>
          <div class="metric-row"><span class="label">STATUS</span><strong>${severity().toUpperCase()}</strong></div>
        </div>
      </section>
      <aside class="panel panel-compact">
        <p class="label">REGISTER CONTROL</p>
        <button class="action" type="button" data-action="menu">MENU</button>
        <button class="action secondary" type="button" data-action="refresh">RETURN</button>
      </aside>
    </div>
  `;
}

function analysisScreen() {
  setActiveView("analysis");
  screen.innerHTML = `
    <div class="analysis-layout">
      <section class="panel">
        <div class="panel-heading">
          <span class="section-code">ANALYSIS SEQUENCE / ACTIVE</span>
          <h2 class="screen-title">ETHERNETIC ANALYSIS</h2>
        </div>
        <div class="step-row" data-step="0"><span>LINK INTEGRITY</span><span>QUEUED</span></div>
        <div class="step-row" data-step="1"><span>GATEWAY RESPONSE</span><span>QUEUED</span></div>
        <div class="step-row" data-step="2"><span>ENTITY ECHO</span><span>QUEUED</span></div>
        <div class="step-row" data-step="3"><span>PACKET INTEGRITY</span><span>QUEUED</span></div>
        <div class="step-row" data-step="4"><span>FIELD CAPACITY</span><span>RUNNING</span></div>
        <div class="progress"><span id="analysis-progress"></span></div>
      </section>
      <aside class="panel">
        <p class="label">CURRENT CAPACITY</p>
        <div class="hero-value" id="capacity-preview">000</div>
        <div class="hero-unit">Mbps</div>
      </aside>
    </div>
  `;
  animateAnalysisProgress();
}

function resultScreen() {
  setActiveView("result");
  const capacity = formatCapacity();
  const capacityNumber = capacity.includes("Mbps") ? capacity.replace(" Mbps", "") : capacity;
  const stateClass = severity() === "warn" ? "anomaly" : severity() === "fail" ? "critical" : "";
  screen.innerHTML = `
    <div class="result-layout">
      <section class="panel">
        <div class="panel-heading">
          <span class="section-code">ANALYSIS RECORD / FINAL</span>
          <h2 class="screen-title">ANALYSIS COMPLETE</h2>
        </div>
        <div class="metrics">
          <div class="metric-row"><span class="label">LINK RESONANCE<br><span class="code">ETHERNET LINK</span></span><strong>${formatResonance()}</strong></div>
          <div class="metric-row"><span class="label">ECHO RESPONSE<br><span class="code">PING RTT</span></span><strong>${formatLatency(ping("remote_ping"))}</strong></div>
          <div class="metric-row"><span class="label">SPECTRAL DISSIPATION<br><span class="code">PACKET LOSS</span></span><strong>${formatLoss(ping("remote_ping"))}</strong></div>
          <div class="metric-row"><span class="label">FIELD CAPACITY<br><span class="code">TCP THROUGHPUT</span></span><strong>${capacity}</strong></div>
          <div class="metric-row"><span class="label">REMOTE ENTITY</span><strong>${formatTarget()}</strong></div>
        </div>
      </section>
      <aside class="panel">
        <p class="label">FIELD CAPACITY</p>
        <div class="hero-value">${capacityNumber}</div>
        <div class="hero-unit">${capacity.includes("Mbps") ? "Mbps" : ""}</div>
        <div class="condition ${stateClass}">
          <span class="label">FIELD CONDITION</span>
          <strong><span class="status-symbol">●</span>${conditionText()}</strong>
        </div>
      </aside>
    </div>
  `;
}

function errorScreen() {
  setActiveView("fault");
  screen.innerHTML = `
    <div class="idle">
      <section>
        <div class="status-symbol critical">×</div>
        <h1>UNKNOWN PHENOMENON</h1>
        <p>ANALYSIS INCONCLUSIVE</p>
        <div class="error-code">REFERENCE E-042</div>
      </section>
    </div>
  `;
}

function screensaverScreen() {
  clearInterval(analysisProgressTimer);
  screensaverActive = true;
  app.classList.add("screensaver-mode");
  setActiveView("screensaver");
  screen.innerHTML = `
    <div class="screensaver">
      <div class="standby-reticle" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
      </div>
      <div class="screensaver-mark">
        <span>◈</span>
        <strong>SPECTER ES-01</strong>
        <em>FIELD UNIT STANDBY</em>
      </div>
      <div class="screensaver-trace"></div>
    </div>
  `;
}

function animateAnalysisProgress() {
  clearInterval(analysisProgressTimer);
  const rows = [...document.querySelectorAll(".step-row")];
  const bar = document.querySelector("#analysis-progress");
  const capacity = document.querySelector("#capacity-preview");
  let tick = 0;
  let lastCapacity = 0;
  analysisProgressTimer = setInterval(() => {
    tick += 1;
    rows.forEach((row, index) => {
      const status = row.querySelector("span:last-child");
      if (tick > index + 1) {
        status.textContent = "COMPLETE";
        row.classList.add("complete");
      } else if (tick === index + 1) {
        status.textContent = "RUNNING";
      }
    });
    if (bar) bar.style.width = `${Math.min(100, tick * 18)}%`;
    if (capacity && tick <= 5) {
      lastCapacity = 580 + tick * 51;
      capacity.textContent = String(lastCapacity);
    } else if (capacity) {
      capacity.textContent = String(lastCapacity);
    }
    if (tick >= 6) clearInterval(analysisProgressTimer);
  }, 700);
}

function updateEchoSamples() {
  const echo = currentEchoMs();
  if (echo === null) return;
  echoSamples.push(echo);
  echoSamples = echoSamples.slice(-28);
}

function echoCurveSvg() {
  updateEchoSamples();
  const samples = echoSamples.length ? echoSamples : [0.4, 0.45, 0.42, 0.48, 0.41];
  const max = Math.max(1, ...samples) + 0.5;
  const width = 360;
  const height = 88;
  const points = samples.map((sample, index) => {
    const x = samples.length === 1 ? 0 : (index / (samples.length - 1)) * width;
    const y = height - Math.min(height - 6, (sample / max) * (height - 12)) - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return `
    <svg class="echo-curve" viewBox="0 0 ${width} ${height}" role="img" aria-label="Echo response history">
      <line x1="0" y1="${height - 16}" x2="${width}" y2="${height - 16}"></line>
      <polyline points="${points}"></polyline>
    </svg>
  `;
}

function render() {
  if (!latestPayload || screensaverActive) return;
  const state = value(["ui", "state"], "system_error");
  if (state === "no_link") {
    idleScreen();
  } else if (state === "no_dhcp") {
    faultScreen("NO ADDRESS ACQUIRED", "DHCP RESPONSE ABSENT OR INCONCLUSIVE", "N-014");
  } else if (state === "entity_not_found") {
    faultScreen("REMOTE ENTITY NOT ACQUIRED", "VERIFY RE-01 POWER, LINK, AND LOCAL NETWORK PRESENCE", "R-027", "ENTITY SCAN");
  } else if (state === "system_error") {
    errorScreen();
  } else if (state === "result") {
    resultScreen();
  } else {
    readyScreen();
  }
  updateFooter();
}

async function fetchScan(full = false) {
  const response = await fetch(`/api/scan${full ? "?full=1" : ""}`, { cache: "no-store" });
  latestPayload = await response.json();
  render();
}

async function fetchEcho() {
  if (!latestPayload || analysisRunning || screensaverActive || activeView !== "ready") return;
  try {
    const response = await fetch("/api/echo", { cache: "no-store" });
    const payload = await response.json();
    const remotePing = payload?.echo?.remote_ping;
    if (!remotePing) return;
    latestPayload.scan.remote_ping = remotePing;
    render();
  } catch {
    // The full scan loop will surface persistent network errors.
  }
}

async function runAnalysis() {
  if (analysisRunning || screensaverActive) return;
  analysisRunning = true;
  analysisScreen();
  try {
    await fetchScan(true);
  } catch {
    errorScreen();
  } finally {
    analysisRunning = false;
  }
}

function resetScreensaverTimer() {
  clearTimeout(screensaverTimer);
  if (!screensaverActive) {
    screensaverTimer = setTimeout(screensaverScreen, SCREENSAVER_DELAY_MS);
  }
}

function wakeFromScreensaver() {
  if (!screensaverActive) return;
  screensaverActive = false;
  app.classList.remove("screensaver-mode");
  bootScreen();
  setTimeout(() => fetchScan(false), BOOT_DELAY_MS);
}

function registerActivity() {
  if (screensaverActive) {
    wakeFromScreensaver();
  }
  resetScreensaverTimer();
}

screen.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.action === "analysis") {
    runAnalysis();
  } else if (button.dataset.action === "entity") {
    entityScanScreen();
  } else if (button.dataset.action === "info") {
    infoScreen();
  } else if (button.dataset.action === "refresh") {
    fetchScan(false);
  } else if (button.dataset.action === "menu") {
    menuScreen();
  } else if (button.dataset.action === "diagnostics") {
    diagnosticsScreen();
  }
});

menuButton.addEventListener("click", menuScreen);

["pointerdown", "keydown"].forEach((eventName) => {
  window.addEventListener(eventName, registerActivity, { passive: true });
});

setClock();
setInterval(setClock, 1000);
bootScreen();
resetScreensaverTimer();
setTimeout(() => fetchScan(false), BOOT_DELAY_MS);
setInterval(() => {
  if (!analysisRunning && activeView !== "result" && activeView !== "menu" && activeView !== "info" && !screensaverActive) fetchScan(false);
}, 30000);
setInterval(fetchEcho, ECHO_REFRESH_MS);
