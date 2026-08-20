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
const BLUETOOTH_REFRESH_MS = Number(params.get("bluetooth")) || 1000;
const BLUETOOTH_BEEP_MIN_MS = 180;
const BLUETOOTH_BEEP_MAX_MS = 1800;
const BLUETOOTH_TARGET_MAX_AGE_SECONDS = 3;

const uiState = {
  latestPayload: null,
  activeView: "boot",
  operation: "idle",
  scanPromise: null,
  scanFullAnalysis: false,
  scanRequestId: 0,
  screensaverActive: false,
  wifi: null,
  wifiError: null,
  wifiConfirmOff: false,
  wifiRequest: null,
  wifiControlRequest: null,
  wifiScrollTop: 0,
  bluetooth: null,
  bluetoothError: null,
  bluetoothTarget: null,
  bluetoothRequest: null,
  bluetoothControlRequest: null,
  bluetoothUpdatedAtMs: 0,
  bluetoothScrollTop: 0,
  bluetoothRenderPending: false,
  pointerActive: false,
  beeper: null,
  beeperError: null,
};
let analysisProgressTimer = null;
let screensaverTimer = null;
let bluetoothBeeperTimer = null;
let echoSamples = [];

function setClock() {
  const now = new Date();
  clock.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function value(path, fallback = null) {
  return path.reduce((current, key) => current && current[key] !== undefined ? current[key] : null, uiState.latestPayload) ?? fallback;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function scan() {
  return uiState.latestPayload?.scan ?? {};
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
  uiState.activeView = view;
  if (view !== "bluetooth") stopBluetoothBeeper();
  updateFooter();
  applyControlState();
}

function setOperation(operation) {
  uiState.operation = operation;
  applyControlState();
}

function applyControlState() {
  document.querySelectorAll("button").forEach((button) => {
    const action = button.dataset.action;
    const requiresWifi = button.dataset.requiresWifi === "true";
    const requiresBeeper = button.dataset.requiresBeeper === "true";
    const busy = (["analysis", "entity", "refresh"].includes(action) && uiState.scanPromise !== null)
      || (["wifi-rescan", "wifi-toggle"].includes(action) && (uiState.wifiRequest !== null || uiState.wifiControlRequest !== null))
      || (action === "bluetooth-scan" && uiState.bluetoothControlRequest !== null)
      || (action === "beeper-mute" && uiState.operation === "beeper");
    button.disabled = busy
      || (requiresWifi && uiState.wifi?.radio_enabled !== true)
      || (requiresBeeper && uiState.beeper?.available !== true);
    button.setAttribute("aria-busy", busy ? "true" : "false");
  });
}

function updateFooter() {
  const field = link().link_detected ? "LOCKED" : "COLLAPSED";
  const entity = ping("remote_ping")?.reachable ? "RE-01" : "UNRESOLVED";
  fieldStatus.textContent = field;
  entityStatus.textContent = entity;
  menuButton.hidden = uiState.activeView === "boot" || uiState.activeView === "screensaver";
  menuButton.textContent = uiState.activeView === "menu" ? "HOME" : "MENU";
  modeStatus.textContent =
    uiState.activeView === "analysis" ? "ANALYSIS" :
    uiState.activeView === "result" ? "RESULT" :
    uiState.activeView === "interlock" ? "INTERLOCK" :
    uiState.activeView === "menu" ? "MENU" :
    uiState.activeView === "diagnostics" ? "REGISTER" :
    uiState.activeView === "wifi" ? "WLAN" :
    uiState.activeView === "bluetooth" ? "BT FINDER" :
    uiState.activeView === "beeper" ? "ACOUSTIC" :
    uiState.activeView === "plate" ? "HOME" :
    uiState.activeView === "boot" ? "BOOT" :
    uiState.activeView === "screensaver" ? "STANDBY" :
    "READY";
  updateHomeStatus();
}

function updateHomeStatus() {
  const homeField = document.querySelector("#home-field-status");
  const homeEntity = document.querySelector("#home-entity-status");
  if (homeField) homeField.textContent = link().link_detected ? "LOCKED" : uiState.latestPayload ? "COLLAPSED" : "CALIBRATING";
  if (homeEntity) homeEntity.textContent = ping("remote_ping")?.reachable ? "RE-01 ACQUIRED" : uiState.latestPayload ? "UNRESOLVED" : "CALIBRATING";
}

function wifiFieldLabel(signal) {
  if (signal === null || signal === undefined) return "FIELD UNKNOWN";
  if (signal >= 80) return "FIELD INTENSE";
  if (signal >= 60) return "FIELD STRONG";
  if (signal >= 40) return "FIELD PRESENT";
  return "FIELD FAINT";
}

function bluetoothFieldLabel(rssi) {
  if (rssi === null || rssi === undefined) return "FIELD UNKNOWN";
  if (rssi >= -55) return "FIELD INTENSE";
  if (rssi >= -67) return "FIELD STRONG";
  if (rssi >= -78) return "FIELD PRESENT";
  return "FIELD FAINT";
}

function bluetoothBeepIntervalMs(rssi) {
  const normalized = Math.max(0, Math.min(1, (Number(rssi) + 100) / 65));
  const ratio = BLUETOOTH_BEEP_MIN_MS / BLUETOOTH_BEEP_MAX_MS;
  return Math.round(BLUETOOTH_BEEP_MAX_MS * Math.pow(ratio, normalized));
}

function currentBluetoothTarget() {
  return uiState.bluetooth?.devices?.find((device) => device.address === uiState.bluetoothTarget) ?? null;
}

function bluetoothTargetAgeSeconds(target) {
  const snapshotAge = Number(target?.age_seconds);
  const elapsedSinceUpdate = uiState.bluetoothUpdatedAtMs
    ? Math.max(0, Date.now() - uiState.bluetoothUpdatedAtMs) / 1000
    : 0;
  return (Number.isFinite(snapshotAge) ? snapshotAge : Infinity) + elapsedSinceUpdate;
}

function stopBluetoothBeeper() {
  if (bluetoothBeeperTimer !== null) clearTimeout(bluetoothBeeperTimer);
  bluetoothBeeperTimer = null;
}

function scheduleBluetoothBeeper() {
  if (bluetoothBeeperTimer !== null) return;
  const target = currentBluetoothTarget();
  const canTrack = uiState.activeView === "bluetooth"
    && uiState.bluetooth?.running === true
    && target !== null
    && bluetoothTargetAgeSeconds(target) <= BLUETOOTH_TARGET_MAX_AGE_SECONDS;
  if (!canTrack) return;

  bluetoothBeeperTimer = setTimeout(() => {
    bluetoothBeeperTimer = null;
    const currentTarget = currentBluetoothTarget();
    if (!currentTarget || bluetoothTargetAgeSeconds(currentTarget) > BLUETOOTH_TARGET_MAX_AGE_SECONDS) return;
    pulseBluetoothSonar(bluetoothBeepIntervalMs(currentTarget.smoothed_rssi));
    triggerBeeper("scan_tick");
    scheduleBluetoothBeeper();
  }, bluetoothBeepIntervalMs(target.smoothed_rssi));
}

function updateSonarSignal(sonar, signalLevel) {
  if (!sonar) return;
  sonar.style.setProperty("--signal-level", `${Math.round((1 - signalLevel) * 100)}%`);
}

function pulseBluetoothSonar(intervalMs) {
  const sonar = uiState.activeView === "bluetooth" ? screen.querySelector(".sonar") : null;
  if (!sonar) return;
  const durationMs = Math.max(90, Math.min(600, intervalMs * 0.6));
  const ringDelayMs = Math.min(80, intervalMs * 0.12);
  sonar.style.setProperty("--finder-pulse-duration", `${Math.round(durationMs)}ms`);
  sonar.style.setProperty("--finder-ring-delay-2", `${Math.round(ringDelayMs)}ms`);
  sonar.style.setProperty("--finder-ring-delay-3", `${Math.round(ringDelayMs * 2)}ms`);
  sonar.classList.remove("pulse");
  void sonar.offsetWidth;
  sonar.classList.add("pulse");
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
        </div>
      </aside>
    </div>
  `;
}

function analysisInterlockScreen() {
  setActiveView("interlock");
  screen.innerHTML = `
    <div class="fault-layout">
      <section class="fault-panel">
        <p class="typeplate">ANALYSIS INTERLOCK</p>
        <h1>REMOTE ENTITY REQUIRED</h1>
        <p>FULL ANALYSIS INHIBITED — ACQUIRE RE-01 BEFORE ENERGIZING THE TEST SEQUENCE</p>
        <div class="error-code">REFERENCE R-031</div>
      </section>
      <aside class="panel panel-compact">
        <p class="label">ACQUISITION CONTROL</p>
        <div class="actions">
          <button class="action" type="button" data-action="entity">RUN ENTITY SCAN</button>
        </div>
      </aside>
    </div>
  `;
  applyControlState();
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
          <span class="section-code">OPERATOR CONTROL BUS / MANUAL SELECT</span>
          <h2 class="screen-title">SUBSYSTEM ROUTING MATRIX</h2>
        </div>
        <div class="menu-grid" aria-label="Available functions" tabindex="0">
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
          <button class="menu-tile" type="button" data-action="wifi">
            <span>03</span>
            <strong>WLAN SPECTRUM</strong>
            <em>Survey nearby radio fields</em>
          </button>
          <button class="menu-tile" type="button" data-action="bluetooth">
            <span>04</span>
            <strong>BT FIELD FINDER</strong>
            <em>Track live BLE field strength</em>
          </button>
          <button class="menu-tile" type="button" data-action="beeper">
            <span>05</span>
            <strong>ACOUSTIC SIGNALS</strong>
            <em>Piezo status, mute and test</em>
          </button>
          <button class="menu-tile" type="button" data-action="diagnostics">
            <span>06</span>
            <strong>DIAGNOSTICS</strong>
            <em>Technical register view</em>
          </button>
        </div>
      </section>
      <aside class="panel panel-compact">
        <p class="label">UNIT STATUS</p>
        <div class="readout">
          <span>FIELD</span>
          <strong id="home-field-status">${link().link_detected ? "LOCKED" : uiState.latestPayload ? "COLLAPSED" : "CALIBRATING"}</strong>
        </div>
        <div class="readout">
          <span>ENTITY</span>
          <strong id="home-entity-status">${ping("remote_ping")?.reachable ? "RE-01 ACQUIRED" : uiState.latestPayload ? "UNRESOLVED" : "CALIBRATING"}</strong>
        </div>
      </aside>
    </div>
  `;
}

function plateScreen() {
  setActiveView("plate");
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
}

async function runEntityScan() {
  if (uiState.scanPromise || uiState.screensaverActive) return;
  entityScanScreen();
  try {
    await requestScan(false, { forceRender: true });
  } catch {
    errorScreen();
  }
}

function diagnosticsScreen() {
  setActiveView("diagnostics");
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
        <p class="label">REGISTER SOURCE</p>
        <div class="readout">
          <span>RECORD</span>
          <strong>${uiState.latestPayload ? "CURRENT SCAN" : "NO SCAN DATA"}</strong>
        </div>
      </aside>
    </div>
  `;
}

function wifiScreen() {
  const previousList = screen.querySelector(".wifi-list");
  if (previousList) uiState.wifiScrollTop = previousList.scrollTop;
  setActiveView("wifi");
  const wifi = uiState.wifi;
  const radioText = wifi?.radio_enabled === true ? "ENABLED" : wifi?.radio_enabled === false ? "DISABLED" : "UNKNOWN";
  const radioClass = wifi?.radio_enabled === true ? "" : "anomaly";
  const accessPoints = wifi?.access_points ?? [];
  const rows = accessPoints.length
    ? accessPoints.slice(0, 10).map((accessPoint) => {
      const signal = accessPoint.signal_percent;
      const signalText = signal === null || signal === undefined ? "--" : `${signal}%`;
      const fieldLabel = wifiFieldLabel(signal);
      const identity = accessPoint.ssid || "<HIDDEN SSID>";
      return `
        <div class="wifi-row ${accessPoint.in_use ? "connected" : ""}">
          <div class="wifi-identity">
            <strong>${escapeHtml(identity)}</strong>
            <span>${escapeHtml(accessPoint.bssid)} · ${escapeHtml(accessPoint.band ?? "unknown band")} · CH ${escapeHtml(accessPoint.channel ?? "--")}</span>
          </div>
          <div class="wifi-security">${escapeHtml(accessPoint.security || "OPEN")}</div>
          <div class="wifi-signal" aria-label="${escapeHtml(fieldLabel)}, signal ${escapeHtml(signalText)}">
            <span style="width: ${signal ?? 0}%"></span>
            <strong>${escapeHtml(fieldLabel.replace("FIELD ", ""))} / ${escapeHtml(signalText)}</strong>
          </div>
        </div>
      `;
    }).join("")
    : `<div class="wifi-empty">${wifi ? "NO ACCESS POINTS MEASURED" : "READING WLAN INSTRUMENT..."}</div>`;
  const error = uiState.wifiError || wifi?.error;
  const scanning = uiState.wifiRequest !== null;
  const switching = uiState.wifiControlRequest !== null;
  const toggleLabel = switching
    ? "CALIBRATING RADIO..."
    : wifi?.radio_enabled === true
      ? (uiState.wifiConfirmOff ? "CONFIRM WIFI OFF" : "TURN WIFI OFF")
      : "TURN WIFI ON";
  const toggleButton = wifi?.adapter_available || wifi?.radio_enabled !== null
    ? `<button class="action secondary" type="button" data-action="wifi-toggle">${toggleLabel}</button>`
    : "";

  screen.innerHTML = `
    <div class="wifi-layout">
      <section class="panel wifi-panel">
        <div class="panel-heading">
          <span class="section-code">RADIO FIELD SURVEY / ${escapeHtml(wifi?.interface ?? "NO ADAPTER")}</span>
          <h2 class="screen-title">WLAN SPECTRUM</h2>
        </div>
        ${error ? `<div class="inline-error">${escapeHtml(error)}</div>` : ""}
        ${scanning ? `<div class="activity-line"><span></span>RADIO FIELD SWEEP ACTIVE</div>` : ""}
        <div class="wifi-list">${rows}</div>
      </section>
      <aside class="panel panel-compact wifi-controls">
        <div class="condition ${radioClass}">
          <span class="label">RADIO STATE</span>
          <strong>${radioText}</strong>
        </div>
        <div class="readout">
          <span>CONNECTION</span>
          <strong>${escapeHtml(wifi?.connection ?? "NOT CONNECTED")}</strong>
        </div>
        <div class="readout">
          <span>MEASURED FIELDS</span>
          <strong>${accessPoints.length}</strong>
        </div>
        <button class="action" type="button" data-action="wifi-rescan" data-requires-wifi="true">${scanning ? "SCANNING..." : "SCAN WLAN FIELDS"}</button>
        ${toggleButton}
      </aside>
    </div>
  `;
  const list = screen.querySelector(".wifi-list");
  if (list) list.scrollTop = uiState.wifiScrollTop;
  applyControlState();
}

async function requestWifi({ rescan = false } = {}) {
  if (uiState.wifiRequest) return uiState.wifiRequest;
  uiState.wifiError = null;
  const pending = (async () => {
    const response = await fetch(rescan ? "/api/wifi/scan" : "/api/wifi", {
      method: rescan ? "POST" : "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const payload = await response.json();
    uiState.wifi = payload.wifi ?? null;
    if (!response.ok) uiState.wifiError = payload.error ?? `WLAN request failed (${response.status})`;
    return payload;
  })();
  uiState.wifiRequest = pending;
  if (uiState.activeView === "wifi") wifiScreen();
  try {
    return await pending;
  } catch (error) {
    uiState.wifiError = error instanceof Error ? error.message : "WLAN request failed";
    return null;
  } finally {
    if (uiState.wifiRequest === pending) uiState.wifiRequest = null;
    if (uiState.activeView === "wifi") wifiScreen();
  }
}

async function setWifiRadio(enabled) {
  if (uiState.wifiControlRequest || uiState.wifiRequest) return;
  uiState.wifiError = null;
  const pending = (async () => {
    const response = await fetch("/api/wifi/radio", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ enabled }),
    });
    const payload = await response.json();
    uiState.wifi = payload.wifi ?? uiState.wifi;
    if (!response.ok) uiState.wifiError = payload.error ?? `WLAN change failed (${response.status})`;
    return payload;
  })();
  uiState.wifiControlRequest = pending;
  if (uiState.activeView === "wifi") wifiScreen();
  try {
    return await pending;
  } catch (error) {
    uiState.wifiError = error instanceof Error ? error.message : "WLAN change failed";
    return null;
  } finally {
    if (uiState.wifiControlRequest === pending) uiState.wifiControlRequest = null;
    uiState.wifiConfirmOff = false;
    if (uiState.activeView === "wifi") wifiScreen();
  }
}

function toggleWifiRadio() {
  if (!uiState.wifi) return;
  if (uiState.wifi.radio_enabled === true && !uiState.wifiConfirmOff) {
    uiState.wifiConfirmOff = true;
    wifiScreen();
    return;
  }
  setWifiRadio(uiState.wifi.radio_enabled !== true);
}

function openWifiScreen() {
  uiState.wifiConfirmOff = false;
  wifiScreen();
  requestWifi();
}

function bluetoothScreen() {
  const previousList = screen.querySelector(".bluetooth-list");
  if (previousList) uiState.bluetoothScrollTop = previousList.scrollTop;
  const existingLayout = uiState.activeView === "bluetooth"
    ? screen.querySelector(".bluetooth-layout")
    : null;
  setActiveView("bluetooth");
  const bluetooth = uiState.bluetooth;
  const devices = bluetooth?.devices ?? [];
  const target = devices.find((device) => device.address === uiState.bluetoothTarget) ?? null;
  const targetSignal = target?.smoothed_rssi ?? -100;
  const normalizedSignal = Math.max(0, Math.min(1, (targetSignal + 100) / 65));
  const deviceRows = devices.length
    ? devices.map((device) => {
      const fieldLabel = bluetoothFieldLabel(device.smoothed_rssi);
      return `
      <button class="bluetooth-row ${device.address === uiState.bluetoothTarget ? "target" : ""}" type="button" data-action="bluetooth-target" data-address="${escapeHtml(device.address)}">
        <span class="bluetooth-device">
          <strong>${escapeHtml(device.name || `BLE ENTITY · ${device.address.slice(-8)}`)}</strong>
          <em>${escapeHtml(device.address)} · ${Number(device.age_seconds).toFixed(1)}s ago</em>
        </span>
        <span class="bluetooth-trend">${escapeHtml(fieldLabel.replace("FIELD ", ""))}</span>
        <span class="bluetooth-rssi"><strong>${Math.round(device.rssi)} dBm</strong><em>AVG ${Number(device.smoothed_rssi).toFixed(1)}</em></span>
      </button>
    `;
    }).join("")
    : `<div class="wifi-empty">${bluetooth?.running ? "LISTENING FOR BLE ADVERTISEMENTS..." : "SCANNER STANDBY"}</div>`;
  const error = uiState.bluetoothError || bluetooth?.error;
  const switching = uiState.bluetoothControlRequest !== null;
  const finderName = target?.name || (uiState.bluetoothTarget ? "TARGET NOT SEEN" : "NO TARGET");
  const finderValue = target ? `${Number(target.smoothed_rssi).toFixed(1)} dBm` : "-- dBm";
  const finderField = target ? bluetoothFieldLabel(target.smoothed_rssi) : "FIELD NOT ACQUIRED";
  const scanLabel = switching ? "CALIBRATING..." : bluetooth?.running ? "STOP FIELD SWEEP" : "START FIELD SWEEP";

  if (!existingLayout) screen.innerHTML = `
    <div class="bluetooth-layout">
      <section class="panel bluetooth-panel">
        <div class="panel-heading">
          <span class="section-code bluetooth-adapter">BLE ADVERTISEMENT RECEIVER / ${escapeHtml(bluetooth?.adapter ?? "hci0")}</span>
          <h2 class="screen-title">ENTITY FINDER</h2>
        </div>
        <div class="inline-error bluetooth-error" ${error ? "" : "hidden"}>${escapeHtml(error ?? "")}</div>
        <div class="bluetooth-list">${deviceRows}</div>
      </section>
      <aside class="panel finder-panel">
        <span class="label">SELECTED ENTITY</span>
        <strong class="finder-name">${escapeHtml(finderName)}</strong>
        <div class="sonar" style="--signal-level: 0%">
          <span></span><span></span><span></span>
          <i></i>
        </div>
        <div class="finder-reading">
          <strong>${escapeHtml(finderValue)}</strong>
          <span>${escapeHtml(finderField)}</span>
        </div>
        <button class="action" type="button" data-action="bluetooth-scan">${scanLabel}</button>
      </aside>
    </div>
  `;

  const layout = screen.querySelector(".bluetooth-layout");
  const adapter = layout?.querySelector(".bluetooth-adapter");
  const errorPanel = layout?.querySelector(".bluetooth-error");
  const list = layout?.querySelector(".bluetooth-list");
  const name = layout?.querySelector(".finder-name");
  const reading = layout?.querySelector(".finder-reading strong");
  const field = layout?.querySelector(".finder-reading span");
  const scanButton = layout?.querySelector('[data-action="bluetooth-scan"]');
  if (adapter) adapter.textContent = `BLE ADVERTISEMENT RECEIVER / ${bluetooth?.adapter ?? "hci0"}`;
  if (errorPanel) {
    errorPanel.textContent = error ?? "";
    errorPanel.hidden = !error;
  }
  if (list) list.innerHTML = deviceRows;
  if (name) name.textContent = finderName;
  if (reading) reading.textContent = finderValue;
  if (field) field.textContent = finderField;
  if (scanButton) scanButton.textContent = scanLabel;
  updateSonarSignal(layout?.querySelector(".sonar"), normalizedSignal);
  if (list) list.scrollTop = uiState.bluetoothScrollTop;
  applyControlState();
}

function renderBluetoothWhenIdle() {
  if (uiState.activeView !== "bluetooth") return;
  if (uiState.pointerActive) {
    uiState.bluetoothRenderPending = true;
    return;
  }
  uiState.bluetoothRenderPending = false;
  bluetoothScreen();
}

async function requestBluetooth({ background = false } = {}) {
  if (uiState.bluetoothRequest) return uiState.bluetoothRequest;

  const pending = (async () => {
    try {
      const response = await fetch("/api/bluetooth", { cache: "no-store", headers: { Accept: "application/json" } });
      const payload = await response.json();
      uiState.bluetooth = payload.bluetooth ?? null;
      uiState.bluetoothUpdatedAtMs = Date.now();
      uiState.bluetoothError = response.ok ? null : payload.error ?? `Bluetooth request failed (${response.status})`;
      scheduleBluetoothBeeper();
      renderBluetoothWhenIdle();
      return payload;
    } catch (error) {
      uiState.bluetoothError = error instanceof Error ? error.message : "Bluetooth request failed";
      renderBluetoothWhenIdle();
      return null;
    }
  })();
  uiState.bluetoothRequest = pending;
  try {
    return await pending;
  } finally {
    if (uiState.bluetoothRequest === pending) uiState.bluetoothRequest = null;
    applyControlState();
  }
}

async function setBluetoothScanning(enabled) {
  if (uiState.bluetoothControlRequest) return uiState.bluetoothControlRequest;
  uiState.bluetoothError = null;
  const pending = (async () => {
    const response = await fetch("/api/bluetooth/scan", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ enabled }),
    });
    const payload = await response.json();
    uiState.bluetooth = payload.bluetooth ?? uiState.bluetooth;
    uiState.bluetoothUpdatedAtMs = Date.now();
    if (!response.ok) uiState.bluetoothError = payload.error ?? `Bluetooth change failed (${response.status})`;
    if (uiState.bluetooth?.running) scheduleBluetoothBeeper();
    else stopBluetoothBeeper();
    return payload;
  })();
  uiState.bluetoothControlRequest = pending;
  if (uiState.activeView === "bluetooth") bluetoothScreen();
  try {
    return await pending;
  } catch (error) {
    uiState.bluetoothError = error instanceof Error ? error.message : "Bluetooth change failed";
    return null;
  } finally {
    if (uiState.bluetoothControlRequest === pending) uiState.bluetoothControlRequest = null;
    renderBluetoothWhenIdle();
  }
}

function openBluetoothScreen() {
  bluetoothScreen();
  requestBluetooth();
}

function beeperScreen() {
  setActiveView("beeper");
  const beeper = uiState.beeper;
  const state = beeper?.available ? "READY" : beeper?.configured ? "FAULT" : "NOT CONFIGURED";
  const stateClass = beeper?.available ? "" : "anomaly";
  const error = uiState.beeperError || beeper?.last_error;
  screen.innerHTML = `
    <div class="beeper-layout">
      <section class="panel">
        <div class="panel-heading">
          <span class="section-code">GPIO ACOUSTIC TRANSDUCER / BCM ${escapeHtml(beeper?.pin ?? "--")}</span>
          <h2 class="screen-title">ACOUSTIC SIGNALS</h2>
        </div>
        ${error ? `<div class="inline-error">${escapeHtml(error)}</div>` : ""}
        <div class="beeper-tests">
          <button class="menu-tile" type="button" data-action="beeper-test" data-pattern="boot" data-requires-beeper="true"><span>01</span><strong>BOOT</strong><em>Initialization sequence</em></button>
          <button class="menu-tile" type="button" data-action="beeper-test" data-pattern="scan_tick" data-requires-beeper="true"><span>02</span><strong>SCAN TICK</strong><em>Finder pulse</em></button>
          <button class="menu-tile" type="button" data-action="beeper-test" data-pattern="acquired" data-requires-beeper="true"><span>03</span><strong>ACQUIRED</strong><em>Positive target lock</em></button>
          <button class="menu-tile" type="button" data-action="beeper-test" data-pattern="warning" data-requires-beeper="true"><span>04</span><strong>WARNING</strong><em>Operator attention</em></button>
          <button class="menu-tile" type="button" data-action="beeper-test" data-pattern="error" data-requires-beeper="true"><span>05</span><strong>ERROR</strong><em>Critical failure</em></button>
        </div>
      </section>
      <aside class="panel panel-compact beeper-controls">
        <div class="condition ${stateClass}"><span class="label">BEEPER STATE</span><strong>${state}</strong></div>
        <div class="readout"><span>OUTPUT</span><strong>${beeper?.muted ? "MUTED" : "ACTIVE"}</strong></div>
        <div class="readout"><span>QUEUED PATTERNS</span><strong>${beeper?.queued_patterns ?? 0}</strong></div>
        <button class="action" type="button" data-action="beeper-mute">${beeper?.muted ? "UNMUTE" : "MUTE"}</button>
      </aside>
    </div>
  `;
  applyControlState();
}

async function requestBeeper({ background = false } = {}) {
  if (!background && uiState.operation !== "idle") return;
  if (!background) setOperation("beeper");
  try {
    const response = await fetch("/api/beeper", { cache: "no-store", headers: { Accept: "application/json" } });
    const payload = await response.json();
    uiState.beeper = payload.beeper ?? null;
    uiState.beeperError = response.ok ? null : payload.error ?? `Beeper request failed (${response.status})`;
  } catch (error) {
    uiState.beeperError = error instanceof Error ? error.message : "Beeper request failed";
  } finally {
    if (!background) setOperation("idle");
    if (uiState.activeView === "beeper") beeperScreen();
  }
}

async function triggerBeeper(pattern) {
  if (!uiState.beeper?.available || uiState.beeper.muted) return;
  try {
    const response = await fetch("/api/beeper/trigger", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ pattern }),
    });
    const payload = await response.json();
    if (payload.beeper) uiState.beeper = payload.beeper;
    if (!response.ok) uiState.beeperError = payload.error ?? payload.beeper?.last_error ?? "Beeper trigger failed";
    if (uiState.activeView === "beeper") beeperScreen();
  } catch {
    // Acoustic feedback must never block or break the primary UI action.
  }
}

async function setBeeperMuted(muted) {
  if (uiState.operation !== "idle") return;
  setOperation("beeper");
  try {
    const response = await fetch("/api/beeper/mute", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ muted }),
    });
    const payload = await response.json();
    uiState.beeper = payload.beeper ?? uiState.beeper;
    uiState.beeperError = response.ok ? null : payload.error ?? "Beeper mute change failed";
  } catch (error) {
    uiState.beeperError = error instanceof Error ? error.message : "Beeper mute change failed";
  } finally {
    setOperation("idle");
    if (uiState.activeView === "beeper") beeperScreen();
  }
}

function openBeeperScreen() {
  beeperScreen();
  requestBeeper();
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
  uiState.screensaverActive = true;
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
  if (!uiState.latestPayload || uiState.screensaverActive) return;
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

function shouldRenderBackgroundScan() {
  return ["boot", "idle", "ready", "fault"].includes(uiState.activeView);
}

async function requestScan(full = false, { forceRender = false } = {}) {
  if (uiState.scanPromise) {
    if (!full || uiState.scanFullAnalysis) return uiState.scanPromise;
    try {
      await uiState.scanPromise;
    } catch {
      // A requested full scan still gets its own attempt after a failed status scan.
    }
  }

  const requestId = ++uiState.scanRequestId;
  const requestedFromView = uiState.activeView;
  uiState.scanFullAnalysis = full;
  setOperation(full ? "analysis" : "scan");

  const pending = (async () => {
    const response = await fetch(`/api/scan${full ? "?full=1" : ""}`, {
      method: "POST",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error ?? `Scan failed (${response.status})`);
    if (requestId !== uiState.scanRequestId) return payload;

    uiState.latestPayload = payload;
    updateFooter();
    if ((forceRender && uiState.activeView === requestedFromView) || shouldRenderBackgroundScan()) render();
    return payload;
  })();
  uiState.scanPromise = pending;

  try {
    return await pending;
  } finally {
    if (uiState.scanPromise === pending) {
      uiState.scanPromise = null;
      uiState.scanFullAnalysis = false;
      setOperation("idle");
    }
  }
}

async function fetchEcho() {
  if (!uiState.latestPayload || uiState.scanPromise || uiState.screensaverActive || uiState.activeView !== "ready") return;
  try {
    const response = await fetch("/api/echo", { cache: "no-store" });
    const payload = await response.json();
    const remotePing = payload?.echo?.remote_ping;
    if (!remotePing) return;
    uiState.latestPayload.scan.remote_ping = remotePing;
    render();
  } catch {
    // The full scan loop will surface persistent network errors.
  }
}

async function runAnalysis() {
  if (uiState.scanPromise || uiState.screensaverActive) return;
  if (ping("remote_ping")?.reachable !== true) {
    triggerBeeper("warning");
    analysisInterlockScreen();
    return;
  }
  analysisScreen();
  try {
    const payload = await requestScan(true, { forceRender: true });
    if (payload?.ui?.state === "entity_not_found") {
      triggerBeeper("warning");
      analysisInterlockScreen();
      return;
    }
    triggerBeeper("acquired");
  } catch {
    triggerBeeper("error");
    errorScreen();
  }
}

function resetScreensaverTimer() {
  clearTimeout(screensaverTimer);
  if (!uiState.screensaverActive) {
    screensaverTimer = setTimeout(screensaverScreen, SCREENSAVER_DELAY_MS);
  }
}

function wakeFromScreensaver() {
  if (!uiState.screensaverActive) return;
  uiState.screensaverActive = false;
  app.classList.remove("screensaver-mode");
  bootScreen();
  setTimeout(showHomeAndRefresh, BOOT_DELAY_MS);
}

function showHomeAndRefresh() {
  plateScreen();
  requestScan(false).catch(() => {
    // HOME remains usable even when the background Ethernet status refresh fails.
  });
}

function registerActivity() {
  if (uiState.screensaverActive) {
    wakeFromScreensaver();
  }
  resetScreensaverTimer();
}

screen.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.action !== "beeper-test") triggerBeeper("input");
  if (button.dataset.action === "analysis") {
    runAnalysis();
  } else if (button.dataset.action === "entity") {
    runEntityScan();
  } else if (button.dataset.action === "refresh") {
    requestScan(false, { forceRender: true }).catch(errorScreen);
  } else if (button.dataset.action === "menu") {
    menuScreen();
  } else if (button.dataset.action === "diagnostics") {
    diagnosticsScreen();
  } else if (button.dataset.action === "wifi") {
    openWifiScreen();
  } else if (button.dataset.action === "wifi-rescan") {
    requestWifi({ rescan: true });
  } else if (button.dataset.action === "wifi-toggle") {
    toggleWifiRadio();
  } else if (button.dataset.action === "bluetooth") {
    openBluetoothScreen();
  } else if (button.dataset.action === "bluetooth-scan") {
    setBluetoothScanning(uiState.bluetooth?.running !== true);
  } else if (button.dataset.action === "bluetooth-target") {
    uiState.bluetoothTarget = button.dataset.address;
    bluetoothScreen();
    stopBluetoothBeeper();
    scheduleBluetoothBeeper();
  } else if (button.dataset.action === "beeper") {
    openBeeperScreen();
  } else if (button.dataset.action === "beeper-test") {
    triggerBeeper(button.dataset.pattern);
  } else if (button.dataset.action === "beeper-mute") {
    setBeeperMuted(uiState.beeper?.muted !== true);
  }
});

menuButton.addEventListener("click", () => {
  if (uiState.activeView === "menu") {
    plateScreen();
  } else {
    menuScreen();
  }
});

window.addEventListener("pointerdown", () => {
  uiState.pointerActive = true;
  registerActivity();
}, { passive: true });
window.addEventListener("keydown", registerActivity, { passive: true });
["pointerup", "pointercancel"].forEach((eventName) => {
  window.addEventListener(eventName, () => {
    uiState.pointerActive = false;
    if (uiState.bluetoothRenderPending) {
      setTimeout(renderBluetoothWhenIdle, 0);
    }
  }, { passive: true });
});

setClock();
setInterval(setClock, 1000);
bootScreen();
resetScreensaverTimer();
setTimeout(showHomeAndRefresh, BOOT_DELAY_MS);
setTimeout(() => requestBeeper({ background: true }), 250);
setInterval(() => {
  if (!uiState.scanPromise && ["plate", "menu"].includes(uiState.activeView) && !uiState.screensaverActive) {
    requestScan(false).catch(() => {
      // A background status refresh must not replace or block HOME.
    });
  }
}, 30000);
setInterval(fetchEcho, ECHO_REFRESH_MS);
setInterval(() => {
  if (uiState.activeView === "bluetooth" && uiState.bluetooth?.running) {
    requestBluetooth({ background: true });
  }
}, BLUETOOTH_REFRESH_MS);
