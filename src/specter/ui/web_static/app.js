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
  wifiConnection: null,
  wifiConnectionError: null,
  wifiConnectionRequest: null,
  wifiSelection: null,
  wifiPassword: "",
  wifiPasswordVisible: false,
  wifiKeyboardMode: "lower",
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
  internetSpeed: null,
  internetSpeedError: null,
  internetSpeedRequest: null,
  internetSpeedReview: false,
};
let analysisProgressTimer = null;
let screensaverTimer = null;
let bluetoothBeeperTimer = null;
let internetSpeedPollTimer = null;
let wifiConnectionPollTimer = null;
let screensaverAnimationFrame = null;
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
  if (view !== "screensaver") stopScreensaverAnimation();
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
    const unavailable = button.dataset.unavailable === "true";
    const wifiConnecting = uiState.wifiConnection?.request?.status === "running";
    const busy = (["analysis", "entity", "refresh"].includes(action) && uiState.scanPromise !== null)
      || (["wifi-rescan", "wifi-toggle"].includes(action) && (uiState.wifiRequest !== null || uiState.wifiControlRequest !== null))
      || (["wifi-connect-start", "wifi-key", "wifi-password-toggle", "wifi-password-clear"].includes(action)
        && (uiState.wifiConnectionRequest !== null || wifiConnecting))
      || (action === "bluetooth-scan" && uiState.bluetoothControlRequest !== null)
      || (["internet-speed-start", "internet-speed-cancel"].includes(action) && uiState.internetSpeedRequest !== null)
      || (action === "beeper-mute" && uiState.operation === "beeper");
    button.disabled = unavailable || busy
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
    uiState.activeView === "wifi-connect" ? "WLAN ACCESS" :
    uiState.activeView === "bluetooth" ? "BT FINDER" :
    uiState.activeView === "internet-speed" ? "EXTERNAL" :
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
          <button class="menu-tile" type="button" data-action="internet-speed">
            <span>05</span>
            <strong>EXTERNAL CAPACITY</strong>
            <em>Internet download, upload, ping</em>
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
      const unavailable = !accessPoint.ssid;
      return `
        <button
          class="wifi-row ${accessPoint.in_use ? "connected" : ""}"
          type="button"
          data-action="wifi-select"
          data-ssid="${escapeHtml(accessPoint.ssid ?? "")}"
          data-bssid="${escapeHtml(accessPoint.bssid)}"
          data-security="${escapeHtml(accessPoint.security ?? "OPEN")}"
          data-connected="${accessPoint.in_use ? "true" : "false"}"
          data-unavailable="${unavailable ? "true" : "false"}"
        >
          <div class="wifi-identity">
            <strong>${escapeHtml(identity)}</strong>
            <span>${escapeHtml(accessPoint.bssid)} · ${escapeHtml(accessPoint.band ?? "unknown band")} · CH ${escapeHtml(accessPoint.channel ?? "--")}</span>
          </div>
          <div class="wifi-security">${accessPoint.in_use ? "CONNECTED" : escapeHtml(accessPoint.security || "OPEN")}</div>
          <div class="wifi-signal" aria-label="${escapeHtml(fieldLabel)}, signal ${escapeHtml(signalText)}">
            <span style="width: ${signal ?? 0}%"></span>
            <strong>${escapeHtml(fieldLabel.replace("FIELD ", ""))} / ${escapeHtml(signalText)}</strong>
          </div>
        </button>
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
  uiState.wifiSelection = null;
  uiState.wifiPassword = "";
  wifiScreen();
  requestWifi();
}

const WIFI_KEYBOARD_LAYOUTS = {
  lower: [
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
    ["q", "w", "e", "r", "t", "z", "u", "i", "o", "p"],
    ["a", "s", "d", "f", "g", "h", "j", "k", "l", "BACKSPACE"],
    ["SHIFT", "y", "x", "c", "v", "b", "n", "m", "SYMBOLS", "SPACE"],
  ],
  upper: [
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
    ["Q", "W", "E", "R", "T", "Z", "U", "I", "O", "P"],
    ["A", "S", "D", "F", "G", "H", "J", "K", "L", "BACKSPACE"],
    ["SHIFT", "Y", "X", "C", "V", "B", "N", "M", "SYMBOLS", "SPACE"],
  ],
  symbols: [
    ["!", "\"", "#", "$", "%", "&", "'", "(", ")", "*"],
    ["+", ",", "-", ".", "/", ":", ";", "<", "=", ">"],
    ["?", "@", "[", "\\", "]", "^", "_", "`", "{", "BACKSPACE"],
    ["ABC", "|", "}", "~", "0", "1", "2", "3", "4", "SPACE"],
  ],
};

function wifiNetworkRequiresPassword(security) {
  return Boolean(security && !["OPEN", "--"].includes(String(security).trim().toUpperCase()));
}

function wifiEnterpriseSecurity(security) {
  const normalized = String(security ?? "").toUpperCase();
  return normalized.includes("802.1X") || normalized.includes("EAP");
}

function wifiKeyboard() {
  return WIFI_KEYBOARD_LAYOUTS[uiState.wifiKeyboardMode].map((row) => `
    <div class="wifi-keyboard-row">
      ${row.map((key) => {
        const label = key === "BACKSPACE" ? "⌫" : key === "SPACE" ? "SPACE" : key;
        const modifier = ["BACKSPACE", "SHIFT", "SYMBOLS", "ABC", "SPACE"].includes(key) ? " modifier" : "";
        return `<button class="wifi-key${modifier}" type="button" data-action="wifi-key" data-key="${escapeHtml(key)}">${escapeHtml(label)}</button>`;
      }).join("")}
    </div>
  `).join("");
}

function selectWifiNetwork(button) {
  if (button.dataset.connected === "true") return;
  uiState.wifiSelection = {
    ssid: button.dataset.ssid,
    bssid: button.dataset.bssid,
    security: button.dataset.security || "OPEN",
  };
  uiState.wifiPassword = "";
  uiState.wifiPasswordVisible = false;
  uiState.wifiKeyboardMode = "lower";
  uiState.wifiConnectionError = null;
  uiState.wifiConnection = null;
  wifiConnectScreen();
}

function wifiConnectScreen() {
  setActiveView("wifi-connect");
  const selection = uiState.wifiSelection;
  if (!selection) {
    openWifiScreen();
    return;
  }
  const status = uiState.wifiConnection?.request?.status ?? "idle";
  const result = uiState.wifiConnection?.result ?? null;
  const secured = wifiNetworkRequiresPassword(selection.security);
  const enterprise = wifiEnterpriseSecurity(selection.security);
  const connecting = status === "running";
  const connected = status === "completed" && result?.success;
  const error = uiState.wifiConnectionError || (status === "failed" ? result?.error : null);

  if (connecting || connected) {
    screen.innerHTML = `
      <div class="wifi-connect-layout">
        <section class="panel wifi-connect-status">
          <p class="typeplate">WLAN ACCESS CONTROL / ${escapeHtml(selection.bssid)}</p>
          <h1>${connected ? "WLAN FIELD LOCK ACQUIRED" : "WLAN FIELD ACQUISITION"}</h1>
          ${connecting ? `<div class="activity-line"><span></span>NETWORKMANAGER CONNECTION IN PROGRESS</div>` : ""}
          <div class="readout"><span>SSID</span><strong>${escapeHtml(selection.ssid)}</strong></div>
          <div class="readout"><span>SECURITY</span><strong>${escapeHtml(selection.security || "OPEN")}</strong></div>
          ${connected ? `<div class="condition"><span class="label">CONNECTION</span><strong><span class="status-symbol">●</span>STABLE</strong></div>` : ""}
          <button class="action" type="button" data-action="wifi-back">BACK TO WLAN SPECTRUM</button>
        </section>
      </div>
    `;
    applyControlState();
    return;
  }

  screen.innerHTML = `
    <div class="wifi-connect-layout">
      <section class="panel wifi-connect-panel">
        <div class="panel-heading wifi-connect-heading">
          <span class="section-code">WLAN ACCESS CONTROL / ${escapeHtml(selection.security || "OPEN")}</span>
          <h2 class="screen-title">${escapeHtml(selection.ssid)}</h2>
        </div>
        ${error ? `<div class="inline-error wifi-connect-error">${escapeHtml(error)}</div>` : ""}
        ${enterprise ? `
          <div class="external-notice">
            <strong>ENTERPRISE PROFILE REQUIRED</strong>
            <span>802.1X REQUIRES IDENTITY AND CERTIFICATE PARAMETERS</span>
          </div>
        ` : secured ? `
          <div class="wifi-password-field">
            <label for="wifi-password">NETWORK KEY / ${uiState.wifiPassword.length} CHAR</label>
            <input id="wifi-password" type="${uiState.wifiPasswordVisible ? "text" : "password"}" value="${escapeHtml(uiState.wifiPassword)}" readonly tabindex="-1">
            <button type="button" data-action="wifi-password-toggle">${uiState.wifiPasswordVisible ? "HIDE" : "SHOW"}</button>
          </div>
          <div class="wifi-keyboard" aria-label="On-screen network key keyboard">${wifiKeyboard()}</div>
        ` : `
          <div class="external-notice wifi-open-notice">
            <strong>OPEN NETWORK</strong>
            <span>NO LINK ENCRYPTION DETECTED</span>
          </div>
        `}
        <div class="wifi-connect-actions">
          <button class="action secondary" type="button" data-action="wifi-back">BACK TO WLAN SPECTRUM</button>
          ${secured && !enterprise ? `<button class="action secondary" type="button" data-action="wifi-password-clear">CLEAR KEY</button>` : ""}
          ${!enterprise ? `<button class="action action-primary" type="button" data-action="wifi-connect-start">ACQUIRE WLAN FIELD</button>` : ""}
        </div>
      </section>
    </div>
  `;
  applyControlState();
}

function handleWifiKey(key) {
  if (key === "BACKSPACE") uiState.wifiPassword = uiState.wifiPassword.slice(0, -1);
  else if (key === "SPACE") uiState.wifiPassword += " ";
  else if (key === "SHIFT") uiState.wifiKeyboardMode = uiState.wifiKeyboardMode === "upper" ? "lower" : "upper";
  else if (key === "SYMBOLS") uiState.wifiKeyboardMode = "symbols";
  else if (key === "ABC") uiState.wifiKeyboardMode = "lower";
  else if (uiState.wifiPassword.length < 64) uiState.wifiPassword += key;
  wifiConnectScreen();
}

function scheduleWifiConnectionPoll() {
  clearTimeout(wifiConnectionPollTimer);
  if (uiState.wifiConnection?.request?.status === "running") {
    wifiConnectionPollTimer = setTimeout(() => requestWifiConnectionStatus({ background: true }), 500);
  }
}

async function requestWifiConnectionStatus({ background = false } = {}) {
  if (uiState.wifiConnectionRequest) return uiState.wifiConnectionRequest;
  const previousStatus = uiState.wifiConnection?.request?.status;
  const pending = (async () => {
    try {
      const response = await fetch("/api/wifi/connection", { cache: "no-store", headers: { Accept: "application/json" } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? `Wi-Fi connection status failed (${response.status})`);
      uiState.wifiConnection = payload;
      const currentStatus = payload?.request?.status;
      if (previousStatus === "running" && currentStatus === "completed") {
        triggerBeeper("acquired");
        requestWifi();
      } else if (previousStatus === "running" && currentStatus === "failed") {
        triggerBeeper("error");
      }
    } catch (error) {
      uiState.wifiConnectionError = error instanceof Error ? error.message : "Wi-Fi connection status failed";
    } finally {
      if ((!background || uiState.activeView === "wifi-connect") && uiState.wifiSelection) wifiConnectScreen();
    }
    return uiState.wifiConnection;
  })();
  uiState.wifiConnectionRequest = pending;
  try {
    return await pending;
  } finally {
    if (uiState.wifiConnectionRequest === pending) uiState.wifiConnectionRequest = null;
    scheduleWifiConnectionPoll();
  }
}

async function startWifiConnection() {
  if (!uiState.wifiSelection || uiState.wifiConnectionRequest) return;
  uiState.wifiConnectionError = null;
  const selection = uiState.wifiSelection;
  const pending = (async () => {
    try {
      const response = await fetch("/api/wifi/connect", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ ...selection, password: uiState.wifiPassword || null }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? `Wi-Fi connection failed (${response.status})`);
      uiState.wifiConnection = payload;
      uiState.wifiPassword = "";
    } catch (error) {
      uiState.wifiConnectionError = error instanceof Error ? error.message : "Wi-Fi connection failed";
    } finally {
      if (uiState.activeView === "wifi-connect") wifiConnectScreen();
    }
  })();
  uiState.wifiConnectionRequest = pending;
  applyControlState();
  try {
    await pending;
  } finally {
    if (uiState.wifiConnectionRequest === pending) uiState.wifiConnectionRequest = null;
    applyControlState();
    scheduleWifiConnectionPoll();
  }
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

function formatInternetValue(value, unit, digits = 2) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(digits)} ${unit}` : "not measured";
}

function formatDataVolume(bytes) {
  const number = Number(bytes);
  if (!Number.isFinite(number)) return "not reported";
  if (number >= 1_000_000_000) return `${(number / 1_000_000_000).toFixed(2)} GB`;
  return `${(number / 1_000_000).toFixed(1)} MB`;
}

function formatElapsedDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  return `${String(minutes).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

const INTERNET_SPEED_PHASES = [
  ["server_selection", "SERVER"],
  ["latency", "PING"],
  ["download", "DOWNLOAD"],
  ["upload", "UPLOAD"],
  ["finalizing", "RESULT"],
];

function internetSpeedProgress(request, config) {
  const startedAt = Date.parse(request?.started_at ?? "");
  const elapsedSeconds = Number.isFinite(startedAt) ? Math.max(0, (Date.now() - startedAt) / 1000) : 0;
  const phaseIndex = Math.max(0, INTERNET_SPEED_PHASES.findIndex(([phase]) => phase === request?.phase));
  const completedPercent = Math.round((phaseIndex / INTERNET_SPEED_PHASES.length) * 100);
  return {
    elapsedSeconds,
    phaseIndex,
    phaseLabel: INTERNET_SPEED_PHASES[phaseIndex][1],
    completedPercent,
    limitSeconds: Math.max(1, Number(config?.process_timeout_seconds) || 60),
  };
}

function internetPingAssessment(value) {
  const pingMs = Number(value);
  if (!Number.isFinite(pingMs)) return { className: "", label: "NOT CLASSIFIED" };
  if (pingMs <= 30) return { className: "measurement-stable", label: "STABLE" };
  if (pingMs <= 80) return { className: "measurement-elevated", label: "ELEVATED" };
  return { className: "measurement-critical", label: "CRITICAL" };
}

function internetSpeedFailureTitle(code) {
  return {
    client_missing: "TEST CLIENT NOT AVAILABLE",
    client_failed: "TEST CLIENT START ANOMALY",
    no_interface: "FIELD INTERFACE OFFLINE",
    no_internet: "EXTERNAL NETWORK NOT ACQUIRED",
    timeout: "ANALYSIS TIME LIMIT EXCEEDED",
    server_error: "TEST SERVER ANOMALY",
    invalid_output: "RESULT FORMAT ANOMALY",
    cancelled: "ANALYSIS ABORTED",
    internal_error: "SYSTEM ERROR",
  }[code] ?? "EXTERNAL ANALYSIS INCONCLUSIVE";
}

function internetSpeedScreen() {
  setActiveView("internet-speed");
  const snapshot = uiState.internetSpeed;
  const request = snapshot?.request ?? { status: "idle" };
  const config = snapshot?.configuration ?? {};
  const result = snapshot?.result ?? null;
  const backend = config.backend ?? "LibreSpeed.org public server pool";
  const interfaceName = result?.interface ?? config.interface ?? "automatic selection";
  const duration = Number(config.duration_seconds) || 10;

  if (uiState.internetSpeedError) {
    screen.innerHTML = `
      <div class="internet-speed-layout">
        <section class="fault-panel">
          <p class="typeplate">EXTERNAL ANALYSIS / CONTROL CHANNEL</p>
          <h1>CONTROL CHANNEL ANOMALY</h1>
          <p>${escapeHtml(uiState.internetSpeedError)}</p>
          <div class="error-code">REFERENCE X-041</div>
        </section>
        <aside class="panel internet-speed-controls">
          <button class="action" type="button" data-action="internet-speed-refresh">RETRY STATUS ACQUISITION</button>
        </aside>
      </div>
    `;
  } else if (request.status === "running" || request.status === "cancelling") {
    const progress = internetSpeedProgress(request, config);
    const phaseSteps = INTERNET_SPEED_PHASES.map(([, label], index) => {
      const state = index < progress.phaseIndex ? "complete" : index === progress.phaseIndex ? "active" : "";
      return `<span class="${state}">${label}</span>`;
    }).join("");
    screen.innerHTML = `
      <div class="internet-speed-layout">
        <section class="panel">
          <div class="panel-heading">
            <span class="section-code">EXTERNAL NETWORK / LIBRESPEED</span>
            <h2 class="screen-title">EXTERNAL CAPACITY ANALYSIS</h2>
          </div>
          <div class="activity-line"><span></span>${request.status === "cancelling" ? "ABORT SEQUENCE IN PROGRESS" : `ANALYSIS IN PROGRESS / ${progress.phaseLabel}`}</div>
          <div class="external-progress-meta">
            <div><span>MEASUREMENT SEQUENCE</span><strong>${String(progress.phaseIndex + 1).padStart(2, "0")} / 05</strong></div>
            <div><span>ELAPSED / LIMIT</span><strong>${formatElapsedDuration(progress.elapsedSeconds)} / ${formatElapsedDuration(progress.limitSeconds)}</strong></div>
          </div>
          <div
            class="external-sweep"
            role="progressbar"
            aria-label="Completed measurement phases"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow="${progress.completedPercent}"
            aria-valuetext="Phase ${progress.phaseIndex + 1} of ${INTERNET_SPEED_PHASES.length}: ${progress.phaseLabel}"
          >
            <span class="external-progress-fill" style="width: ${progress.completedPercent}%"></span>
            <i
              class="external-scan-line"
              aria-hidden="true"
              style="--external-sweep-delay: -${(progress.elapsedSeconds % 1.6).toFixed(3)}s"
            ></i>
          </div>
          <div class="external-phase-labels" aria-hidden="true">${phaseSteps}</div>
          <div class="metrics compact-metrics">
            <div class="metric-row"><span class="label">FIELD INTERFACE</span><strong>${escapeHtml(interfaceName)}</strong></div>
            <div class="metric-row"><span class="label">MEASUREMENT SERVER</span><strong>${escapeHtml(backend)}</strong></div>
            <div class="metric-row"><span class="label">TEST WINDOW</span><strong>${duration} s DOWN / ${duration} s UP</strong></div>
          </div>
        </section>
        <aside class="panel internet-speed-controls">
          <div class="condition"><span class="label">EXTERNAL FIELD</span><strong>ACTIVE</strong></div>
          <p class="technical-note">DOWNLOAD AND UPLOAD CHANNELS MAY SATURATE THE SELECTED INTERFACE</p>
          <button class="action secondary" type="button" data-action="internet-speed-cancel" ${request.status === "cancelling" ? "disabled" : ""}>ABORT ANALYSIS</button>
        </aside>
      </div>
    `;
  } else if (request.status === "completed" && result?.success && !uiState.internetSpeedReview) {
    const pingAssessment = internetPingAssessment(result.ping_ms);
    const totalBytes = result.bytes_sent == null && result.bytes_received == null
      ? null
      : Number(result.bytes_sent ?? 0) + Number(result.bytes_received ?? 0);
    screen.innerHTML = `
      <div class="internet-speed-layout">
        <section class="panel">
          <div class="panel-heading">
            <span class="section-code">EXTERNAL ANALYSIS RECORD / LIBRESPEED</span>
            <h2 class="screen-title">EXTERNAL ANALYSIS COMPLETE</h2>
          </div>
          <div class="internet-result-grid">
            <div><span>DOWNLOAD CAPACITY</span><strong>${formatInternetValue(result.download_mbps, "Mbps")}</strong><em>INTERNET DOWNLOAD</em></div>
            <div><span>UPLOAD CAPACITY</span><strong>${formatInternetValue(result.upload_mbps, "Mbps")}</strong><em>INTERNET UPLOAD</em></div>
            <div class="${pingAssessment.className}"><span>ECHO RESPONSE</span><strong>${formatInternetValue(result.ping_ms, "ms")}</strong><em>LIBRESPEED PING / ${pingAssessment.label}</em></div>
            <div><span>FIELD INSTABILITY</span><strong>${formatInternetValue(result.jitter_ms, "ms")}</strong><em>JITTER</em></div>
          </div>
        </section>
        <aside class="panel internet-speed-controls">
          <div class="condition"><span class="label">EXTERNAL FIELD</span><strong><span class="status-symbol">●</span>STABLE</strong></div>
          <div class="readout"><span>FIELD INTERFACE</span><strong>${escapeHtml(interfaceName)}</strong></div>
          <div class="readout"><span>MEASUREMENT SERVER</span><strong>${escapeHtml(result.server_name ?? result.server_url ?? "unknown")}</strong></div>
          <div class="readout"><span>TRANSFER VOLUME</span><strong>${formatDataVolume(totalBytes)}</strong></div>
          <button class="action" type="button" data-action="internet-speed-review">REVIEW TEST PARAMETERS</button>
        </aside>
      </div>
    `;
  } else if (["failed", "cancelled"].includes(request.status) && !uiState.internetSpeedReview) {
    const code = result?.error_code ?? "server_error";
    screen.innerHTML = `
      <div class="internet-speed-layout">
        <section class="fault-panel">
          <p class="typeplate">EXTERNAL ANALYSIS / LIBRESPEED</p>
          <h1>${internetSpeedFailureTitle(code)}</h1>
          <p>${escapeHtml(result?.error ?? "LibreSpeed returned no valid measurement")}</p>
          <div class="error-code">REFERENCE X-${code === "client_missing" ? "012" : code === "timeout" ? "028" : "042"}</div>
        </section>
        <aside class="panel internet-speed-controls">
          <div class="readout"><span>FIELD INTERFACE</span><strong>${escapeHtml(interfaceName)}</strong></div>
          <div class="readout"><span>MEASUREMENT SERVER</span><strong>${escapeHtml(backend)}</strong></div>
          <button class="action" type="button" data-action="internet-speed-review">REVIEW TEST PARAMETERS</button>
        </aside>
      </div>
    `;
  } else {
    screen.innerHTML = `
      <div class="internet-speed-layout">
        <section class="panel">
          <div class="panel-heading">
            <span class="section-code">EXTERNAL NETWORK / LIBRESPEED</span>
            <h2 class="screen-title">EXTERNAL FIELD CAPACITY</h2>
          </div>
          <p class="external-summary">INTERNET DOWNLOAD, UPLOAD, PING AND JITTER. REMOTE ENTITY RE-01 NOT REQUIRED.</p>
          <div class="external-notice">
            <strong>EXTERNAL MEASUREMENT NOTICE</strong>
            <span>THE SELECTED TEST SERVER RECEIVES THE PUBLIC IP ADDRESS</span>
          </div>
          <div class="metrics compact-metrics">
            <div class="metric-row"><span class="label">DATA USE</span><strong>VARIABLE / CONNECTION CAPACITY</strong></div>
            <div class="metric-row"><span class="label">TEST WINDOW</span><strong>${duration} s DOWN / ${duration} s UP</strong></div>
            <div class="metric-row"><span class="label">TELEMETRY</span><strong>${escapeHtml(config.telemetry ?? "disabled").toUpperCase()}</strong></div>
          </div>
        </section>
        <aside class="panel internet-speed-controls">
          <div class="readout"><span>FIELD INTERFACE</span><strong>${escapeHtml(interfaceName)}</strong></div>
          <div class="readout"><span>MEASUREMENT SERVER</span><strong>${escapeHtml(backend)}</strong></div>
          <p class="technical-note">DOWNLOAD AND UPLOAD RUN AT AVAILABLE CONNECTION CAPACITY. TRANSFER VOLUME DEPENDS ON LINK SPEED.</p>
          <button class="action action-primary" type="button" data-action="internet-speed-start">INITIATE EXTERNAL ANALYSIS</button>
        </aside>
      </div>
    `;
  }
  applyControlState();
}

function scheduleInternetSpeedPoll() {
  clearTimeout(internetSpeedPollTimer);
  const status = uiState.internetSpeed?.request?.status;
  if (["running", "cancelling"].includes(status)) {
    internetSpeedPollTimer = setTimeout(() => requestInternetSpeed({ background: true }), 500);
  }
}

async function requestInternetSpeed({ background = false } = {}) {
  if (uiState.internetSpeedRequest) return uiState.internetSpeedRequest;
  const previousStatus = uiState.internetSpeed?.request?.status;
  const pending = (async () => {
    try {
      const response = await fetch("/api/internet-speed", { cache: "no-store", headers: { Accept: "application/json" } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? `Internet speed status failed (${response.status})`);
      uiState.internetSpeed = payload;
      uiState.internetSpeedError = null;
      const currentStatus = payload?.request?.status;
      if (["running", "cancelling"].includes(previousStatus) && currentStatus === "completed") triggerBeeper("acquired");
      if (["running", "cancelling"].includes(previousStatus) && currentStatus === "failed") triggerBeeper("error");
    } catch (error) {
      uiState.internetSpeedError = error instanceof Error ? error.message : "Internet speed status failed";
    } finally {
      if (!background || uiState.activeView === "internet-speed") internetSpeedScreen();
    }
    return uiState.internetSpeed;
  })();
  uiState.internetSpeedRequest = pending;
  applyControlState();
  try {
    return await pending;
  } finally {
    if (uiState.internetSpeedRequest === pending) uiState.internetSpeedRequest = null;
    applyControlState();
    scheduleInternetSpeedPoll();
  }
}

async function startInternetSpeed() {
  if (uiState.internetSpeedRequest) return;
  uiState.internetSpeedReview = false;
  const pending = (async () => {
    try {
      const response = await fetch("/api/internet-speed", {
        method: "POST",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const payload = await response.json();
      uiState.internetSpeed = payload;
      uiState.internetSpeedError = response.ok || response.status === 409 ? null : `Internet speed start failed (${response.status})`;
    } catch (error) {
      uiState.internetSpeedError = error instanceof Error ? error.message : "Internet speed start failed";
    } finally {
      if (uiState.activeView === "internet-speed") internetSpeedScreen();
    }
  })();
  uiState.internetSpeedRequest = pending;
  applyControlState();
  try {
    await pending;
  } finally {
    if (uiState.internetSpeedRequest === pending) uiState.internetSpeedRequest = null;
    applyControlState();
    scheduleInternetSpeedPoll();
  }
}

async function cancelInternetSpeed() {
  if (uiState.internetSpeedRequest) return;
  const pending = (async () => {
    try {
      const response = await fetch("/api/internet-speed", {
        method: "DELETE",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const payload = await response.json();
      uiState.internetSpeed = payload;
      uiState.internetSpeedError = response.ok || response.status === 409 ? null : `Internet speed abort failed (${response.status})`;
    } catch (error) {
      uiState.internetSpeedError = error instanceof Error ? error.message : "Internet speed abort failed";
    } finally {
      if (uiState.activeView === "internet-speed") internetSpeedScreen();
    }
  })();
  uiState.internetSpeedRequest = pending;
  applyControlState();
  try {
    await pending;
  } finally {
    if (uiState.internetSpeedRequest === pending) uiState.internetSpeedRequest = null;
    applyControlState();
    scheduleInternetSpeedPoll();
  }
}

function openInternetSpeedScreen() {
  uiState.internetSpeedReview = false;
  internetSpeedScreen();
  requestInternetSpeed();
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
        <div class="step-row" data-step="4"><span>FIELD CAPACITY</span><span>QUEUED</span></div>
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
      <svg class="containment-tunnel" viewBox="0 0 1024 600" role="img" aria-label="Moving passive containment tunnel">
        <defs>
          <filter id="containment-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2.4" result="blur"></feGaussianBlur>
            <feMerge><feMergeNode in="blur"></feMergeNode><feMergeNode in="SourceGraphic"></feMergeNode></feMerge>
          </filter>
        </defs>
        <g class="tunnel-frames">
          ${Array.from({ length: 8 }, (_, index) => `<rect data-frame="${index}" x="-50" y="-50" width="100" height="100"></rect>`).join("")}
        </g>
        <g class="containment-target" aria-hidden="true">
          <circle data-speed-ring r="27"></circle>
          <path class="target-cross" d="M -38 0 H 38 M 0 -38 V 38"></path>
          <path class="target-mark" d="M 0 -14 L 13 11 L -13 11 Z"></path>
        </g>
        <g class="tunnel-label tunnel-array-label">
          <text>PASSIVE CONTAINMENT / ARRAY 12</text>
          <text y="15" data-lock-readout>ENTITY ACQUISITION</text>
        </g>
        <g class="tunnel-label tunnel-target-label">
          <text data-entity-id>ENTITY VECTOR / CH-07</text>
          <text y="15" data-vector-readout>VECTOR RATE 000 px/s</text>
        </g>
      </svg>
    </div>
  `;
  startScreensaverAnimation();
}

function stopScreensaverAnimation() {
  if (screensaverAnimationFrame !== null) {
    cancelAnimationFrame(screensaverAnimationFrame);
    screensaverAnimationFrame = null;
  }
}

function startScreensaverAnimation() {
  stopScreensaverAnimation();
  const svg = screen.querySelector(".containment-tunnel");
  if (!svg) return;
  const frames = [...svg.querySelectorAll("[data-frame]")];
  const target = svg.querySelector(".containment-target");
  const targetRing = svg.querySelector("[data-speed-ring]");
  const targetCross = svg.querySelector(".target-cross");
  const arrayLabel = svg.querySelector(".tunnel-array-label");
  const targetLabel = svg.querySelector(".tunnel-target-label");
  const lockReadout = svg.querySelector("[data-lock-readout]");
  const entityIdReadout = svg.querySelector("[data-entity-id]");
  const vectorReadout = svg.querySelector("[data-vector-readout]");
  const startedAt = performance.now();
  let lastRenderedAt = 0;
  let lastTickAt = startedAt;
  let lockAmount = 0;
  let phase = "wander";
  let phaseStartedAt = startedAt;
  let respawnUntil = 0;
  let entityIndex = 0;
  let waypointIndex = 0;
  let captureFrameAngles = [];
  let captureTargetAngle = 0;
  let frameSizes = frames.map(() => 46);
  let wanderRepickUntil = 0;
  let wanderWaypointX = 512;
  let wanderWaypointY = 300;
  let swayPhase = Math.random() * Math.PI * 2;

  const entityIds = ["07", "12", "19", "31", "42", "58", "73"];
  const waypoints = [
    { x: 790, y: 122 },
    { x: 884, y: 448 },
    { x: 574, y: 512 },
    { x: 166, y: 432 },
    { x: 132, y: 142 },
    { x: 494, y: 86 },
    { x: 704, y: 326 },
    { x: 342, y: 294 },
  ];
  const targetState = { x: 268, y: 168, vx: 52, vy: 18 };
  const chaserState = { x: 724, y: 414, vx: -44, vy: -16 };
  const history = Array.from({ length: 96 }, (_, index) => ({
    x: Math.min(940, chaserState.x + index * 2.3),
    y: Math.min(532, chaserState.y + index * 1.05),
  }));
  let previousHeading = Math.atan2(chaserState.vy, chaserState.vx);
  let turnSmooth = 0;

  const clamp = (number, minimum, maximum) => Math.max(minimum, Math.min(maximum, number));
  const length = (x, y) => Math.hypot(x, y);
  const sampleHistory = (index) => {
    const lowerIndex = Math.min(history.length - 1, Math.floor(index));
    const upperIndex = Math.min(history.length - 1, lowerIndex + 1);
    const fraction = index - lowerIndex;
    return {
      x: history[lowerIndex].x + (history[upperIndex].x - history[lowerIndex].x) * fraction,
      y: history[lowerIndex].y + (history[upperIndex].y - history[lowerIndex].y) * fraction,
    };
  };

  const offScreenSpawn = (entry) => {
    const side = Math.floor(Math.random() * 4);
    const speed = 72;
    const drift = () => (Math.random() - 0.5) * 40;
    if (side === 0) return { x: -140, y: clamp(entry.y, 60, 540), vx: speed, vy: drift() };
    if (side === 1) return { x: 1164, y: clamp(entry.y, 60, 540), vx: -speed, vy: drift() };
    if (side === 2) return { x: clamp(entry.x, 60, 964), y: -140, vx: drift(), vy: speed };
    return { x: clamp(entry.x, 60, 964), y: 740, vx: drift(), vy: -speed };
  };

  const animate = (now) => {
    if (!uiState.screensaverActive || uiState.activeView !== "screensaver" || !svg.isConnected) {
      screensaverAnimationFrame = null;
      return;
    }
    if (now - lastRenderedAt < 32) {
      screensaverAnimationFrame = requestAnimationFrame(animate);
      return;
    }
    lastRenderedAt = now;
    const deltaSeconds = clamp((now - lastTickAt) / 1000, 0.001, 0.08);
    lastTickAt = now;
    const seconds = (now - startedAt) / 1000 + 5.4;
    const phaseSeconds = (now - phaseStartedAt) / 1000;
    const captureProgress = phase === "capture" ? clamp(phaseSeconds / 1.05, 0, 1) : phase === "destroy" ? 1 : 0;

    let waypoint = waypoints[waypointIndex];
    let targetToWaypointX = waypoint.x - targetState.x;
    let targetToWaypointY = waypoint.y - targetState.y;
    let targetToWaypointDistance = length(targetToWaypointX, targetToWaypointY);
    if (targetToWaypointDistance < 46) {
      waypointIndex = (waypointIndex + 1) % waypoints.length;
      waypoint = waypoints[waypointIndex];
      targetToWaypointX = waypoint.x - targetState.x;
      targetToWaypointY = waypoint.y - targetState.y;
      targetToWaypointDistance = length(targetToWaypointX, targetToWaypointY);
    }

    const desiredTargetSpeed = phase === "capture" ? 60 * (1 - captureProgress) : phase === "destroy" ? 0 : 60;
    const targetSteering = phase === "capture" ? 4.8 : phase === "destroy" ? 8 : 1.8;
    const desiredTargetVx = targetToWaypointX / Math.max(1, targetToWaypointDistance) * desiredTargetSpeed;
    const desiredTargetVy = targetToWaypointY / Math.max(1, targetToWaypointDistance) * desiredTargetSpeed;
    const targetBlend = Math.min(1, targetSteering * deltaSeconds);
    targetState.vx += (desiredTargetVx - targetState.vx) * targetBlend;
    targetState.vy += (desiredTargetVy - targetState.vy) * targetBlend;
    targetState.x = clamp(targetState.x + targetState.vx * deltaSeconds, -160, 1184);
    targetState.y = clamp(targetState.y + targetState.vy * deltaSeconds, -160, 760);

    const initialChaseDistance = length(targetState.x - chaserState.x, targetState.y - chaserState.y);
    let desiredChaserVx;
    let desiredChaserVy;
    let chaserBlend;
    if (phase === "wander") {
      const toWaypointX = wanderWaypointX - chaserState.x;
      const toWaypointY = wanderWaypointY - chaserState.y;
      const distanceToWaypoint = length(toWaypointX, toWaypointY);
      if (distanceToWaypoint < 96 || now >= wanderRepickUntil) {
        wanderRepickUntil = now + 6000 + Math.random() * 5000;
        wanderWaypointX = 130 + Math.random() * (1024 - 260);
        wanderWaypointY = 120 + Math.random() * (600 - 240);
      }
      const baseHeading = Math.atan2(toWaypointY, toWaypointX);
      swayPhase += deltaSeconds * 0.22;
      const swayAmount = Math.sin(seconds * 0.55 + swayPhase * 1.6) * 1.05;
      const heading = baseHeading + swayAmount;
      const travelSpeed = 40 + Math.sin(seconds * 0.6 + swayPhase * 1.7) * 10;
      const baseVx = Math.cos(heading) * travelSpeed;
      const baseVy = Math.sin(heading) * travelSpeed;

      const edgeMargin = 130;
      const edgePush = 34;
      let edgeVx = 0;
      let edgeVy = 0;
      if (chaserState.x < edgeMargin) edgeVx += (edgeMargin - chaserState.x) / edgeMargin * edgePush;
      if (chaserState.x > 1024 - edgeMargin) edgeVx -= (chaserState.x - (1024 - edgeMargin)) / edgeMargin * edgePush;
      if (chaserState.y < edgeMargin) edgeVy += (edgeMargin - chaserState.y) / edgeMargin * edgePush;
      if (chaserState.y > 600 - edgeMargin) edgeVy -= (chaserState.y - (600 - edgeMargin)) / edgeMargin * edgePush;

      desiredChaserVx = baseVx + edgeVx;
      desiredChaserVy = baseVy + edgeVy;
      chaserBlend = Math.min(1, 1.7 * deltaSeconds);
    } else {
      const predictionSeconds = phase === "pursuit" ? clamp(initialChaseDistance / 420, 0.1, 0.55) : 0;
      const pursuitX = targetState.x + targetState.vx * predictionSeconds;
      const pursuitY = targetState.y + targetState.vy * predictionSeconds;
      const chaseX = pursuitX - chaserState.x;
      const chaseY = pursuitY - chaserState.y;
      const pursuitDistance = length(chaseX, chaseY);
      const desiredChaserSpeed = phase === "pursuit"
        ? clamp(66 + pursuitDistance * 0.06, 66, 76)
        : clamp(pursuitDistance * 2.6, 0, 90);
      desiredChaserVx = chaseX / Math.max(1, pursuitDistance) * desiredChaserSpeed;
      desiredChaserVy = chaseY / Math.max(1, pursuitDistance) * desiredChaserSpeed;
      chaserBlend = Math.min(1, (phase === "pursuit" ? 2.4 : 5) * deltaSeconds);
    }
    chaserState.vx += (desiredChaserVx - chaserState.vx) * chaserBlend;
    chaserState.vy += (desiredChaserVy - chaserState.vy) * chaserBlend;
    chaserState.x = clamp(chaserState.x + chaserState.vx * deltaSeconds, 58, 966);
    chaserState.y = clamp(chaserState.y + chaserState.vy * deltaSeconds, 54, 546);

    const currentHeading = Math.atan2(chaserState.vy, chaserState.vx);
    const turnDelta = Math.atan2(
      Math.sin(currentHeading - previousHeading),
      Math.cos(currentHeading - previousHeading),
    );
    previousHeading = currentHeading;
    turnSmooth += (Math.abs(turnDelta) - turnSmooth) * Math.min(1, deltaSeconds * 2.6);

    const chaseDistance = length(targetState.x - chaserState.x, targetState.y - chaserState.y);
    const lockTarget = clamp(1 - chaseDistance / 120, 0, 1);
    lockAmount += (lockTarget - lockAmount) * Math.min(1, deltaSeconds * 3.2);

    if (phase === "wander" && chaseDistance < 200) {
      phase = "pursuit";
      phaseStartedAt = now;
    } else if (phase === "pursuit" && chaseDistance < 58) {
      phase = "capture";
      phaseStartedAt = now;
      captureFrameAngles = frames.map((frame) => {
        const rotation = /rotate\((-?[\d.]+)\)/.exec(frame.getAttribute("transform") || "");
        return rotation ? Number(rotation[1]) : 0;
      });
      captureTargetAngle = captureFrameAngles[0] || 0;
    } else if (phase === "capture" && phaseSeconds >= 1.05) {
      phase = "destroy";
      phaseStartedAt = now;
      targetState.vx = 0;
      targetState.vy = 0;
    } else if (phase === "destroy" && phaseSeconds >= 0.62) {
      entityIndex = (entityIndex + 1) % entityIds.length;
      waypointIndex = Math.floor(Math.random() * waypoints.length);
      const spawn = offScreenSpawn(waypoints[waypointIndex]);
      targetState.x = spawn.x;
      targetState.y = spawn.y;
      targetState.vx = spawn.vx;
      targetState.vy = spawn.vy;
      phase = "wander";
      phaseStartedAt = now;
      respawnUntil = now + 900;
      lockAmount = 0;
      captureFrameAngles = [];
    }

    history.unshift({ x: chaserState.x, y: chaserState.y });
    if (history.length > 96) history.pop();
    const turnFactor = clamp(turnSmooth / 0.55, 0, 1);
    let delayMultiplier = 1;
    if (phase === "wander") {
      delayMultiplier = 2.6;
    } else if (phase === "capture") {
      delayMultiplier = 1 - captureProgress * 0.88;
    } else if (phase === "destroy") {
      delayMultiplier = 0.12;
    }
    delayMultiplier *= 1 - turnFactor * 0.5;
    const delayStep = (0.38 + (1 - lockAmount) * 3.45) * delayMultiplier;
    const synchronization = phase === "destroy"
      ? 1
      : phase === "capture"
        ? captureProgress * captureProgress * (3 - 2 * captureProgress)
        : phase === "wander"
          ? 0
          : lockAmount * 0.28;
    const synchronizedAngle = seconds * 9;
    const trailPoints = frames.map((frame, index) => {
      const trailPoint = sampleHistory(index * delayStep);
      return {
        x: trailPoint.x + (targetState.x - trailPoint.x) * synchronization,
        y: trailPoint.y + (targetState.y - trailPoint.y) * synchronization,
      };
    });
    const frameGeometry = trailPoints.map((point, index) => {
      const chaseSpeed = length(chaserState.vx, chaserState.vy);
      const taper = index / Math.max(1, frames.length - 1);
      const sizeTarget = clamp(44 + chaseSpeed * 0.55 + taper * 60, 40, 210);
      frameSizes[index] += (sizeTarget - frameSizes[index]) * Math.min(1, deltaSeconds * 2.2);
      const size = frameSizes[index];

      const previous = trailPoints[Math.max(0, index - 1)];
      const next = trailPoints[Math.min(trailPoints.length - 1, index + 1)];
      const tangent = Math.atan2(next.y - previous.y, next.x - previous.x);
      const coherentWave = Math.sin(seconds * 1.6 + index * 0.55) * 10;
      const freeAngle = tangent * 180 / Math.PI + coherentWave;

      const synchronizedTurn = ((synchronizedAngle - freeAngle + 135) % 90) - 45;
      const captureStartAngle = captureFrameAngles[index] ?? freeAngle;
      const captureTurn = ((captureTargetAngle - captureStartAngle + 135) % 90) - 45;
      const angle = phase === "capture" || phase === "destroy"
        ? captureStartAngle + captureTurn * synchronization
        : freeAngle + synchronizedTurn * synchronization;
      const frame = frames[index];
      frame.setAttribute("transform", `translate(${point.x.toFixed(2)} ${point.y.toFixed(2)}) rotate(${angle.toFixed(2)})`);
      frame.setAttribute("x", (-size / 2).toFixed(2));
      frame.setAttribute("y", (-size / 2).toFixed(2));
      frame.setAttribute("width", size.toFixed(2));
      frame.setAttribute("height", size.toFixed(2));
      frame.style.opacity = String(0.94 - index * 0.055);
      return point;
    });

    const targetSpeed = length(targetState.vx, targetState.vy);
    const targetHeading = Math.atan2(targetState.vy, targetState.vx) * 180 / Math.PI + 90;
    const ringRadius = clamp(22 + targetSpeed * 0.16, 24, 78);
    const crossExtent = ringRadius + 10;
    target.setAttribute("transform", `translate(${targetState.x.toFixed(2)} ${targetState.y.toFixed(2)}) rotate(${targetHeading.toFixed(2)})`);
    targetRing.setAttribute("r", ringRadius.toFixed(2));
    targetCross.setAttribute("d", `M ${-crossExtent.toFixed(1)} 0 H ${crossExtent.toFixed(1)} M 0 ${-crossExtent.toFixed(1)} V ${crossExtent.toFixed(1)}`);
    const visualPhase = now < respawnUntil ? "respawn" : phase;
    svg.dataset.phase = visualPhase;
    svg.dataset.entityId = entityIds[entityIndex];

    const labelAnchor = frameGeometry[Math.min(5, frameGeometry.length - 1)];
    arrayLabel.setAttribute(
      "transform",
      `translate(${clamp(labelAnchor.x + 42, 24, 744).toFixed(1)} ${clamp(labelAnchor.y - 38, 28, 552).toFixed(1)})`,
    );
    targetLabel.setAttribute(
      "transform",
      `translate(${clamp(targetState.x + ringRadius + 18, 24, 814).toFixed(1)} ${clamp(targetState.y + ringRadius + 14, 38, 550).toFixed(1)})`,
    );
    lockReadout.textContent = phase === "destroy"
      ? "ENTITY DISSIPATION"
      : phase === "capture"
        ? "FIELD LOCK ACQUIRED"
        : phase === "pursuit"
          ? "ENTITY ACQUISITION"
          : now < respawnUntil
            ? "NEW ENTITY DETECTED"
            : "PASSIVE SWEEP";
    entityIdReadout.textContent = `ENTITY VECTOR / CH-${entityIds[entityIndex]}`;
    vectorReadout.textContent = `VECTOR RATE ${String(Math.round(targetSpeed)).padStart(3, "0")} px/s`;
    screensaverAnimationFrame = requestAnimationFrame(animate);
  };

  screensaverAnimationFrame = requestAnimationFrame(animate);
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
        row.classList.remove("running");
      } else if (tick === index + 1) {
        status.textContent = "RUNNING";
        row.classList.add("running");
      } else {
        row.classList.remove("running");
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
  } else if (button.dataset.action === "wifi-select") {
    selectWifiNetwork(button);
  } else if (button.dataset.action === "wifi-key") {
    handleWifiKey(button.dataset.key ?? "");
  } else if (button.dataset.action === "wifi-password-toggle") {
    uiState.wifiPasswordVisible = !uiState.wifiPasswordVisible;
    wifiConnectScreen();
  } else if (button.dataset.action === "wifi-password-clear") {
    uiState.wifiPassword = "";
    wifiConnectScreen();
  } else if (button.dataset.action === "wifi-connect-start") {
    startWifiConnection();
  } else if (button.dataset.action === "wifi-back") {
    openWifiScreen();
  } else if (button.dataset.action === "bluetooth") {
    openBluetoothScreen();
  } else if (button.dataset.action === "bluetooth-scan") {
    setBluetoothScanning(uiState.bluetooth?.running !== true);
  } else if (button.dataset.action === "bluetooth-target") {
    uiState.bluetoothTarget = button.dataset.address;
    bluetoothScreen();
    stopBluetoothBeeper();
    scheduleBluetoothBeeper();
  } else if (button.dataset.action === "internet-speed") {
    openInternetSpeedScreen();
  } else if (button.dataset.action === "internet-speed-start") {
    startInternetSpeed();
  } else if (button.dataset.action === "internet-speed-cancel") {
    cancelInternetSpeed();
  } else if (button.dataset.action === "internet-speed-refresh") {
    requestInternetSpeed();
  } else if (button.dataset.action === "internet-speed-review") {
    uiState.internetSpeedReview = true;
    internetSpeedScreen();
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
