const screen = document.querySelector("#screen");
const fieldStatus = document.querySelector("#field-status");
const entityStatus = document.querySelector("#entity-status");
const scanButton = document.querySelector("#scan-button");
const menuButton = document.querySelector("#menu-button");
const clock = document.querySelector("#clock");

let latestPayload = null;
let analysisRunning = false;

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

function updateFooter() {
  const field = link().link_detected ? "LOCKED" : "COLLAPSED";
  const entity = ping("remote_ping")?.reachable ? "RE-01" : "UNRESOLVED";
  fieldStatus.textContent = field;
  entityStatus.textContent = entity;
}

function bootScreen() {
  screen.innerHTML = `
    <div class="boot">
      <section class="boot-mark">
        <h1>SPECTER</h1>
        <p>ES-01<br>PORTABLE ETHERNETIC<br>SPECTROMETER</p>
      </section>
      <section class="boot-list">
        <h2 class="screen-title">SYSTEM INITIALIZATION</h2>
        <div class="boot-row"><span>ETHERNETIC INTERFACE</span><span>READY</span></div>
        <div class="boot-row"><span>DIAGNOSTIC CORE</span><span>READY</span></div>
        <div class="boot-row"><span>SPECTRAL PROCESSOR</span><span>READY</span></div>
        <div class="boot-row"><span>FIELD SENSOR ARRAY</span><span>READY</span></div>
        <div class="boot-row"><span>LOCAL ENTITY</span><span>ES-01</span></div>
        <p class="screen-subtitle">CALIBRATING...</p>
      </section>
    </div>
  `;
}

function idleScreen() {
  screen.innerHTML = `
    <div class="idle">
      <section>
        <h1>NO ETHERNETIC ACTIVITY</h1>
        <p>CONNECT TEST SUBJECT TO ETH0</p>
        <div class="trace" aria-hidden="true"></div>
      </section>
    </div>
  `;
}

function readyScreen() {
  const stateClass = severity() === "warn" ? "anomaly" : severity() === "fail" ? "critical" : "";
  screen.innerHTML = `
    <div class="grid">
      <section class="panel">
        <h2 class="screen-title">ETHERNETIC FIELD STATUS</h2>
        <div class="metrics">
          <div class="metric-row"><span class="label">LINK RESONANCE</span><strong>${formatResonance()}</strong></div>
          <div class="metric-row"><span class="label">LOCAL ENTITY</span><strong>${formatAddress()}</strong></div>
          <div class="metric-row"><span class="label">GATEWAY</span><strong>${formatLatency(ping("gateway_ping"))}</strong></div>
          <div class="metric-row"><span class="label">REMOTE ENTITY</span><strong>${ping("remote_ping")?.reachable ? "SPECTER RE-01" : "NOT ACQUIRED"}</strong></div>
          <div class="metric-row"><span class="label">ECHO RESPONSE</span><strong>${formatLatency(ping("remote_ping"))}</strong></div>
        </div>
      </section>
      <aside class="panel">
        <p class="label">FIELD CONDITION</p>
        <div class="condition ${stateClass}">
          <span class="label">GLOBAL STATUS</span>
          <strong>${conditionText()}</strong>
        </div>
        <div class="actions">
          <button class="action" type="button" data-action="analysis">INITIATE ANALYSIS</button>
          <button class="action secondary" type="button" data-action="entity">ENTITY SCAN</button>
        </div>
      </aside>
    </div>
  `;
}

function analysisScreen() {
  screen.innerHTML = `
    <div class="grid">
      <section class="panel">
        <h2 class="screen-title">ETHERNETIC ANALYSIS</h2>
        <div class="step-row"><span>LINK INTEGRITY</span><span>COMPLETE</span></div>
        <div class="step-row"><span>GATEWAY RESPONSE</span><span>COMPLETE</span></div>
        <div class="step-row"><span>ENTITY ECHO</span><span>COMPLETE</span></div>
        <div class="step-row"><span>PACKET INTEGRITY</span><span>COMPLETE</span></div>
        <div class="step-row"><span>FIELD CAPACITY</span><span>RUNNING</span></div>
        <div class="progress"><span></span></div>
      </section>
      <aside class="panel">
        <p class="label">CURRENT CAPACITY</p>
        <div class="hero-value">...</div>
        <div class="hero-unit">Mbps</div>
      </aside>
    </div>
  `;
}

function resultScreen() {
  const capacity = formatCapacity();
  const capacityNumber = capacity.includes("Mbps") ? capacity.replace(" Mbps", "") : capacity;
  const stateClass = severity() === "warn" ? "anomaly" : severity() === "fail" ? "critical" : "";
  screen.innerHTML = `
    <div class="grid">
      <section class="panel">
        <h2 class="screen-title">ANALYSIS COMPLETE</h2>
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
          <strong>${conditionText()}</strong>
        </div>
      </aside>
    </div>
  `;
}

function errorScreen() {
  screen.innerHTML = `
    <div class="idle">
      <section>
        <h1>UNKNOWN PHENOMENON</h1>
        <p>ANALYSIS INCONCLUSIVE</p>
        <div class="error-code">REFERENCE E-042</div>
      </section>
    </div>
  `;
}

function render() {
  if (!latestPayload) return;
  updateFooter();
  const state = value(["ui", "state"], "system_error");
  if (state === "no_link") {
    idleScreen();
  } else if (state === "system_error") {
    errorScreen();
  } else if (state === "result") {
    resultScreen();
  } else {
    readyScreen();
  }
}

async function fetchScan(full = false) {
  const response = await fetch(`/api/scan${full ? "?full=1" : ""}`, { cache: "no-store" });
  latestPayload = await response.json();
  render();
}

async function runAnalysis() {
  if (analysisRunning) return;
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

screen.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.action === "analysis" || button.dataset.action === "entity") {
    runAnalysis();
  }
});

scanButton.addEventListener("click", runAnalysis);
menuButton.addEventListener("click", () => fetchScan(false));

setClock();
setInterval(setClock, 1000);
bootScreen();
setTimeout(() => fetchScan(false), 2600);
setInterval(() => {
  if (!analysisRunning) fetchScan(false);
}, 30000);
