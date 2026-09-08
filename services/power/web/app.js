"use strict";

const state = {
  config: null,
  status: null,
  deviceDraft: [],
  serviceDraft: [],
  diagnostics: null,
  diagnosticsTab: "overview",
  discoveryResults: [],
  seenAlertIDs: new Set(),
  alertsInitialized: false,
  discoveryController: null,
  statusTimer: null,
  updateTimer: null,
  updateStatus: null,
  toastTimer: null,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function newDeviceId() {
  if (crypto.randomUUID) return crypto.randomUUID().replaceAll("-", "");
  const random = crypto.getRandomValues(new Uint32Array(4));
  return [...random].map((value) => value.toString(16).padStart(8, "0")).join("");
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[character]));
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

function showToast(message, error = false) {
  const toast = $("#toast");
  clearTimeout(state.toastTimer);
  toast.textContent = message;
  toast.classList.toggle("error", error);
  toast.hidden = false;
  state.toastTimer = setTimeout(() => { toast.hidden = true; }, 4200);
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function formatTime(value) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

function relativeTime(value) {
  if (!value) return "Never seen";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 5) return "Seen just now";
  if (seconds < 60) return `Seen ${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Seen ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `Seen ${hours}h ago`;
}

function deviceDisplayName(device) {
  return device.name || device.title || `Device ${device.address}`;
}

function deviceURL(device) {
  const address = device.address.includes(":") ? `[${device.address}]` : device.address;
  const defaultPort = device.scheme === "https" ? 443 : 80;
  return `${device.scheme}://${address}${Number(device.port) === defaultPort ? "" : `:${device.port}`}${device.path}`;
}

function statusLabel(status) {
  return ({ online: "Online", warning: "Warning", offline: "Offline", pending: "Pending" })[status] || "Unknown";
}

function syncRefreshRate(seconds) {
  const select = $("#refresh-rate-select");
  if (!select || seconds == null) return;
  select.querySelector("option[data-custom]")?.remove();
  const value = String(Number(seconds));
  if (![...select.options].some((option) => option.value === value)) {
    const option = document.createElement("option");
    option.value = value;
    option.dataset.custom = "true";
    option.textContent = `${value} seconds`;
    select.append(option);
  }
  select.value = value;
}

function renderSummary(data) {
  const counts = data.counts || {};
  $("#count-total").textContent = counts.total ?? 0;
  $("#count-online").textContent = counts.online ?? 0;
  $("#count-warning").textContent = counts.warning ?? 0;
  $("#count-offline").textContent = counts.offline ?? 0;
  const label = $("#cycle-label");
  if (!counts.total) {
    label.textContent = "No devices configured yet.";
  } else if (data.running) {
    label.textContent = `Checking ${plural(counts.total, "device")} now…`;
  } else if (data.cycle_finished_at) {
    label.textContent = `Refreshing every ${data.refresh_seconds} seconds · Last pass ${formatTime(data.cycle_finished_at)}`;
  } else {
    label.textContent = `Starting the first check for ${plural(counts.total, "device")}…`;
  }
  const indicator = $("#server-indicator");
  indicator.className = "server-indicator connected";
  $("span", indicator).textContent = data.running ? "Checking devices" : "Monitor active";
  syncRefreshRate(data.refresh_seconds);
}

function renderAlerts(data) {
  const alerts = Array.isArray(data.alerts) ? data.alerts : [];
  const unacknowledged = alerts.filter((alert) => !alert.acknowledged);
  const count = $("#alerts-count");
  count.textContent = unacknowledged.length;
  count.hidden = unacknowledged.length === 0;
  $("#alerts-button").classList.toggle("has-alerts", unacknowledged.length > 0);
  if (state.alertsInitialized) {
    const newest = unacknowledged.find((alert) => !state.seenAlertIDs.has(alert.id));
    if (newest) showToast(`${newest.title}: ${newest.message}`, newest.severity === "critical");
  }
  alerts.forEach((alert) => state.seenAlertIDs.add(alert.id));
  state.alertsInitialized = true;
  const list = $("#alerts-list");
  list.innerHTML = alerts.length ? alerts.map((alert) => `<article class="alert-item ${escapeHTML(alert.severity)} ${alert.acknowledged ? "acknowledged" : ""}"><span aria-hidden="true"></span><div><strong>${escapeHTML(alert.title)}</strong><p>${escapeHTML(alert.message)}</p><small>${escapeHTML(formatTime(alert.occurred_at))}${alert.acknowledged ? " · acknowledged" : ""}</small></div></article>`).join("") : `<div class="configured-empty">No alerts have been recorded this session.</div>`;
}

function openAlerts() {
  if (state.status) renderAlerts(state.status);
  $("#alerts-dialog").showModal();
}

async function acknowledgeAlerts() {
  await api("/api/alerts/acknowledge", { method: "POST", body: "{}" });
  showToast("Alerts acknowledged.");
  await refreshStatus();
}

function serviceLoadMarkup(value) {
  const number = Number(value || 0);
  return `${escapeHTML(number.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }))}<small>A</small>`;
}

function camSplitMarkup(camSplit) {
  const currents = camSplit.currents || {};
  const currentCell = (label, key) => `<div><span>${label}</span>${valueMarkup(currents[key])}</div>`;
  return `<section class="cam-split-card ${camSplit.stale ? "stale" : ""}">
    <header><div><strong>${escapeHTML(camSplit.name || camSplit.address)}</strong><small>${escapeHTML(camSplit.address)}</small></div><span class="status-${escapeHTML(camSplit.status)}">${escapeHTML(statusLabel(camSplit.status))}</span></header>
    <div class="cam-split-values">${currentCell("L1", "l1_current")}${currentCell("L2", "l2_current")}${currentCell("L3", "l3_current")}${currentCell("N", "neutral_current")}</div>
    <p>Cam split · not included in service load</p>
  </section>`;
}

function renderServices(data) {
  const panel = $("#services-panel");
  const grid = $("#service-grid");
  const services = Array.isArray(data.services) ? data.services : [];
  panel.hidden = services.length === 0;
  if (!services.length) {
    grid.innerHTML = "";
    return;
  }
  grid.innerHTML = services.map((service) => {
    const level = ["normal", "warning", "critical", "incomplete"].includes(service.level) ? service.level : "normal";
    const utilization = Math.max(0, Number(service.utilization_percent || 0));
    const reporting = Number(service.reporting_devices || 0);
    const deviceCount = Number(service.device_count || 0);
    const reportingLabel = deviceCount ? `${reporting} of ${deviceCount} load ${deviceCount === 1 ? "distro" : "distros"} reporting` : "No load distros assigned";
    const camSplits = Array.isArray(service.cam_splits) ? service.cam_splits : [];
    return `
      <article class="service-card level-${level}">
        <header class="service-card-header">
          <div><h3 title="${escapeHTML(service.name)}">${escapeHTML(service.name)}</h3><p>${escapeHTML(Number(service.amp_rating).toLocaleString())}A service</p></div>
          <span class="service-utilization">${escapeHTML(utilization.toFixed(1))}%</span>
        </header>
        <div class="service-loads">
          <div class="service-load"><span>${service.data_complete ? "Current load" : "Partial current load"}</span><strong>${serviceLoadMarkup(service.current_load)}</strong></div>
          <div class="service-load"><span>Overall peak load</span><strong>${serviceLoadMarkup(service.peak_load)}</strong></div>
        </div>
        <div class="service-phase-loads" aria-label="Current service phase loads">
          <div><span>L1 load</span><strong>${serviceLoadMarkup(service.phase_loads?.l1_current)}</strong></div>
          <div><span>L2 load</span><strong>${serviceLoadMarkup(service.phase_loads?.l2_current)}</strong></div>
          <div><span>L3 load</span><strong>${serviceLoadMarkup(service.phase_loads?.l3_current)}</strong></div>
        </div>
        <div class="service-capacity-track" aria-label="${escapeHTML(utilization.toFixed(1))}% of service capacity"><div class="service-capacity-fill" style="--utilization: ${Math.min(utilization, 100)}%"></div></div>
        <p class="service-reporting">${escapeHTML(reportingLabel)}</p>
        ${service.data_complete ? "" : `<div class="service-incomplete"><strong>Load incomplete</strong><span>${service.missing_devices?.length ? `Missing: ${escapeHTML(service.missing_devices.map((item) => item.name).join(", "))}` : "Assign at least one load distro to calculate this service."}</span></div>`}
        ${camSplits.length ? `<div class="cam-split-grid">${camSplits.map(camSplitMarkup).join("")}</div>` : ""}
      </article>`;
  }).join("");
}

function valueMarkup(metric) {
  if (!metric) return `<strong class="phase-missing">—</strong>`;
  return `<strong>${escapeHTML(metric.value)}${metric.unit ? `<small>${escapeHTML(metric.unit)}</small>` : ""}</strong>`;
}

function trendMarkup(history = []) {
  const minutes = Number($("#trend-range-select")?.value || 60);
  const cutoff = Date.now() - minutes * 60 * 1000;
  const samples = history.filter((sample) => new Date(sample.observed_at).getTime() >= cutoff);
  if (samples.length < 2) return `<section class="phase-trend"><div><h3>Phase trend · ${minutes} min</h3><span>Collecting readings…</span></div></section>`;
  const keys = ["l1_current", "l2_current", "l3_current"];
  const values = samples.flatMap((sample) => keys.map((key) => Number(sample[key])).filter(Number.isFinite));
  const maximum = Math.max(1, ...values) * 1.08;
  const points = (key) => samples.map((sample, index) => {
    const value = Number(sample[key]);
    const x = samples.length === 1 ? 0 : index / (samples.length - 1) * 300;
    const y = Number.isFinite(value) ? 64 - Math.min(value / maximum, 1) * 60 : 64;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return `<section class="phase-trend"><div><h3>Phase trend · ${minutes} min</h3><span><i class="l1"></i>L1 <i class="l2"></i>L2 <i class="l3"></i>L3</span></div><svg viewBox="0 0 300 68" preserveAspectRatio="none" role="img" aria-label="${minutes}-minute phase current trend"><polyline class="l1" points="${points("l1_current")}"/><polyline class="l2" points="${points("l2_current")}"/><polyline class="l3" points="${points("l3_current")}"/></svg></section>`;
}

function phaseMetricMarkup(metrics, stale, phaseAlerts, observedPeaks = {}, meterDemand = {}, breakerAmps = 0, history = []) {
  const byKey = Object.fromEntries(metrics.map((metric) => [metric.key, metric]));
  const phaseKeys = ["l1_current", "l2_current", "l3_current", "neutral_current", "l1_voltage", "l2_voltage", "l3_voltage", "l12_voltage", "l23_voltage", "l31_voltage"];
  if (!phaseKeys.some((key) => byKey[key])) return "";
  const alerts = new Set(phaseAlerts || []);
  const phaseCell = (label, metricKey, phase = "") => `
    <div class="phase-value${phase && alerts.has(phase) ? " phase-alert" : ""}">
      <span>${escapeHTML(label)}${stale ? " · last known" : ""}</span>
      ${valueMarkup(byKey[metricKey])}
    </div>`;
  const readingCell = (label, values, metricKey) => {
    const reading = values?.[metricKey];
    return `<div class="peak-demand-value"><span>${escapeHTML(label)}</span><strong>${reading ? `${escapeHTML(reading.value)}${reading.unit ? `<small>${escapeHTML(reading.unit)}</small>` : ""}` : "—"}</strong></div>`;
  };
  const alertLabels = [...alerts].map((phase) => phase.toUpperCase());
  const supporting = metrics.filter((metric) => ["frequency", "power", "power_factor", "energy", "temperature", "load"].includes(metric.key));
  const demandNumbers = ["l1_current", "l2_current", "l3_current"].map((key) => Number(meterDemand?.[key]?.value ?? byKey[key]?.value)).filter(Number.isFinite);
  const demandPercent = Number(breakerAmps) > 0 && demandNumbers.length ? Math.max(...demandNumbers) / Number(breakerAmps) * 100 : 0;
  const breakerLevel = demandPercent >= 100 ? "critical" : demandPercent >= 80 ? "warning" : "normal";
  const breakerBadge = Number(breakerAmps) > 0 ? `<span class="breaker-badge ${breakerLevel}">Breaker ${escapeHTML(Number(breakerAmps).toLocaleString())}A · ${escapeHTML(demandPercent.toFixed(0))}% demand</span>` : "";
  return `
    <div class="phase-monitor">
      ${alertLabels.length ? `<div class="imbalance-warning"><b>${escapeHTML(alertLabels.join(", "))} phase imbalance</b><span>Current is more than 20% above the other phases.</span></div>` : ""}
      <section class="phase-section">
        <h3>Current</h3>
        <div class="phase-values current-values">
          ${phaseCell("L1", "l1_current", "l1")}${phaseCell("L2", "l2_current", "l2")}${phaseCell("L3", "l3_current", "l3")}${phaseCell("N", "neutral_current")}
        </div>
      </section>
      <section class="phase-section peak-demand-section">
        <div class="peak-demand-heading"><h3>Meter demand</h3><div>${breakerBadge}<span>Current demand reported by the meter</span></div></div>
        <div class="peak-demand-values">
          ${readingCell("I1", meterDemand, "l1_current")}${readingCell("I2", meterDemand, "l2_current")}${readingCell("I3", meterDemand, "l3_current")}
        </div>
      </section>
      <section class="phase-section peak-demand-section observed-peak-section">
        <div class="peak-demand-heading"><h3>Highest observed this session</h3><div><span>Simultaneous readings captured by Power Monitor</span></div></div>
        <div class="peak-demand-values">
          ${readingCell("L1", observedPeaks, "l1_current")}${readingCell("L2", observedPeaks, "l2_current")}${readingCell("L3", observedPeaks, "l3_current")}
        </div>
      </section>
      ${trendMarkup(history)}
      <section class="phase-section">
        <h3>Voltage · line to neutral</h3>
        <div class="phase-values">
          ${phaseCell("L1", "l1_voltage", "l1")}${phaseCell("L2", "l2_voltage", "l2")}${phaseCell("L3", "l3_voltage", "l3")}
        </div>
      </section>
      <section class="phase-section">
        <h3>Voltage · line to line</h3>
        <div class="phase-values">
          ${phaseCell("L12", "l12_voltage")}${phaseCell("L23", "l23_voltage")}${phaseCell("L31", "l31_voltage")}
        </div>
      </section>
      ${supporting.length ? `<div class="supporting-metrics">${supporting.map((metric) => `<span><b>${escapeHTML(metric.label)}</b> ${escapeHTML(metric.value)} ${escapeHTML(metric.unit)}</span>`).join("")}</div>` : ""}
    </div>`;
}

function metricMarkup(metrics, stale, phaseAlerts, observedPeaks, meterDemand, breakerAmps, history) {
  const phaseMarkup = phaseMetricMarkup(metrics, stale, phaseAlerts, observedPeaks, meterDemand, breakerAmps, history);
  if (phaseMarkup) return phaseMarkup;
  if (!metrics.length) {
    return `<div class="metrics-grid"><div class="metric-empty"><i aria-hidden="true">∿</i><span>No standard electrical values were recognized yet. Open diagnostics to inspect everything captured from this page.</span></div></div>`;
  }
  return `<div class="metrics-grid">${metrics.slice(0, 6).map((metric) => `
      <div class="metric">
        <span>${escapeHTML(metric.label)}${stale ? " · last known" : ""}</span>
        <strong>${escapeHTML(metric.value)}${metric.unit ? `<small>${escapeHTML(metric.unit)}</small>` : ""}</strong>
      </div>`).join("")}</div>`;
}

function deviceCardMarkup(device) {
  const metrics = Array.isArray(device.metrics) ? device.metrics : [];
  const fields = (Array.isArray(device.fields) ? device.fields : []).slice(0, 3);
  const checked = device.checked_at ? `Checked ${formatTime(device.checked_at)}` : "Waiting for first check";
  const technical = [device.http_status ? `HTTP ${device.http_status}` : "", device.response_ms != null ? `${device.response_ms} ms` : ""].filter(Boolean).join(" · ");
  return `
    <article class="device-card status-${escapeHTML(device.status)}" data-device-id="${escapeHTML(device.id)}">
      <header class="card-header">
        <div class="device-heading">
          <span class="status-pill"><i aria-hidden="true"></i>${escapeHTML(statusLabel(device.status))}</span>
          <h2 title="${escapeHTML(deviceDisplayName(device))}">${escapeHTML(deviceDisplayName(device))}</h2>
          <a class="device-address" href="${escapeHTML(device.url)}" target="_blank" rel="noopener noreferrer" title="Open the device page">${escapeHTML(device.address)}</a><span class="device-type-chip">${device.device_type === "cam_split" ? "Cam split" : "Power distro"}</span>
        </div>
        <button class="card-menu" type="button" data-diagnostics="${escapeHTML(device.id)}" aria-label="Open diagnostics for ${escapeHTML(deviceDisplayName(device))}">•••</button>
      </header>
      ${metricMarkup(metrics, device.stale, device.phase_alerts, device.observed_peaks || device.peak_currents, device.meter_demand, device.device_type === "cam_split" ? 0 : device.breaker_amps, device.history)}
      ${device.error ? `<p class="device-error">${escapeHTML(device.error)}${device.stale ? " Last captured values remain visible." : ""}</p>` : ""}
      ${fields.length ? `<div class="field-preview">${fields.map((item) => `<span><b>${escapeHTML(item.label)}:</b> ${escapeHTML(item.value)}</span>`).join("")}</div>` : ""}
      <footer class="card-footer">
        <p><strong>${escapeHTML(relativeTime(device.last_seen))}</strong><br>${escapeHTML(technical || checked)}</p>
        <button class="diagnostics-link" type="button" data-diagnostics="${escapeHTML(device.id)}">View extracted data</button>
      </footer>
    </article>`;
}

function renderDevices(data) {
  const grid = $("#device-grid");
  const empty = $("#empty-state");
  const query = $("#search-input").value.trim().toLowerCase();
  const filter = $("#status-filter").value;
  const devices = data.devices || [];
  empty.hidden = devices.length !== 0;
  grid.hidden = devices.length === 0;
  if (!devices.length) {
    grid.innerHTML = "";
    grid.setAttribute("aria-busy", "false");
    return;
  }
  const visible = devices.filter((device) => {
    const matchesQuery = !query || `${device.name} ${device.title} ${device.address}`.toLowerCase().includes(query);
    const matchesStatus = filter === "all" || device.status === filter;
    return matchesQuery && matchesStatus;
  });
  grid.innerHTML = visible.length ? visible.map(deviceCardMarkup).join("") : `<div class="no-results">No devices match the current search and status filter.</div>`;
  grid.setAttribute("aria-busy", "false");
}

async function refreshStatus() {
  try {
    const data = await api("/api/status");
    state.status = data;
    renderSummary(data);
    renderAlerts(data);
    renderServices(data);
    renderDevices(data);
  } catch (error) {
    const indicator = $("#server-indicator");
    indicator.className = "server-indicator disconnected";
    $("span", indicator).textContent = "Monitor disconnected";
    $("#cycle-label").textContent = "The local monitor is not responding. Keep the launch window open.";
  }
}

function renderUpdateStatus(status) {
  state.updateStatus = status;
  const banner = $("#update-banner");
  const settingsText = $("#update-status-text");
  if (status.available) {
    banner.hidden = false;
    $("#update-title").textContent = `Power Monitor ${status.latest_version} is available`;
    $("#update-summary").textContent = status.can_install ? `Installed version: ${status.current_version}. The update will be verified, installed, and restarted automatically.` : (status.error || "Open the GitHub Release to download this update.");
    $("#update-release-link").href = status.release_url || "https://github.com/horner516/STG-Power-Meter/releases";
    const installButton = $("#install-update-button");
    installButton.hidden = !status.can_install;
    installButton.disabled = Boolean(status.downloading);
    installButton.textContent = status.downloading ? "Downloading…" : "Install update";
  } else {
    banner.hidden = true;
  }
  if (settingsText) {
    if (status.checking) settingsText.textContent = "Checking GitHub Releases…";
    else if (status.available) settingsText.textContent = `Version ${status.latest_version} is available${status.can_install ? " and ready to install." : "."}`;
    else if (status.error) settingsText.textContent = `Last check could not complete: ${status.error}`;
    else settingsText.textContent = `Version ${status.current_version} is current. Updates are checked automatically every 24 hours.`;
  }
}

async function refreshUpdateStatus(force = false) {
  const checkButton = $("#check-update-button");
  if (force && checkButton) {
    checkButton.disabled = true;
    checkButton.textContent = "Checking…";
  }
  try {
    const response = await api(force ? "/api/update/check" : "/api/update", force ? { method: "POST", body: "{}" } : {});
    const status = response.status || response;
    renderUpdateStatus(status);
    if (force) showToast(status.checking ? "The automatic GitHub check is still running." : status.available ? `Power Monitor ${status.latest_version} is available.` : `Power Monitor ${status.current_version} is up to date.`);
  } catch (error) {
    if (force) showToast(error.message, true);
  } finally {
    if (force && checkButton) {
      checkButton.disabled = false;
      checkButton.textContent = "Check now";
    }
  }
}

async function installUpdate() {
  const status = state.updateStatus;
  if (!status?.can_install || !window.confirm(`Install Power Monitor ${status.latest_version}? The app will restart and keep all settings.`)) return;
  const button = $("#install-update-button");
  button.disabled = true;
  button.textContent = "Downloading and verifying…";
  try {
    await api("/api/update/install", { method: "POST", body: "{}" });
    $("#update-summary").textContent = "The verified update is installing. Power Monitor will restart in a moment.";
    button.textContent = "Restarting…";
  } catch (error) {
    showToast(error.message, true);
    button.disabled = false;
    button.textContent = "Install update";
  }
}

function resetDeviceEditor(focus = false) {
  $("#device-form").reset();
  $("#device-id").value = "";
  $("#device-scheme").value = "http";
  $("#device-port").value = "80";
  $("#device-path").value = "/";
  $("#device-breaker-amps").value = "";
  $("#device-type").value = "distro";
  syncDeviceTypeFields();
  $("#editor-title").textContent = "New device";
  $("#stage-device-button").textContent = "Add to list";
  $("#cancel-edit-button").hidden = true;
  if (focus) $("#device-address").focus();
}

function syncDeviceTypeFields() {
  const isCamSplit = $("#device-type").value === "cam_split";
  const breaker = $("#device-breaker-amps");
  breaker.disabled = isCamSplit;
  if (isCamSplit) breaker.value = "";
  $("#breaker-field").classList.toggle("field-disabled", isCamSplit);
}

function renderConfiguredDevices() {
  const list = $("#configured-list");
  $("#configured-count").textContent = plural(state.deviceDraft.length, "device");
  if (!state.deviceDraft.length) {
    list.innerHTML = `<div class="configured-empty">No devices in this configuration yet.</div>`;
    return;
  }
  list.innerHTML = state.deviceDraft.map((device) => `
    <div class="configured-device">
      <span aria-hidden="true"></span>
      <div class="configured-device-info"><strong>${escapeHTML(device.name || "Unnamed device")}</strong><small>${device.device_type === "cam_split" ? "Cam split" : "Power distro"} · ${escapeHTML(deviceURL(device))}${device.breaker_amps && device.device_type !== "cam_split" ? ` · ${escapeHTML(Number(device.breaker_amps).toLocaleString())}A breaker` : ""}</small></div>
      <button class="button button-quiet" type="button" data-edit-device="${escapeHTML(device.id)}" aria-label="Edit ${escapeHTML(device.name || device.address)}">Edit</button>
      <button class="button button-danger" type="button" data-remove-device="${escapeHTML(device.id)}" aria-label="Remove ${escapeHTML(device.name || device.address)}">×</button>
    </div>`).join("");
}

function openDeviceManager() {
  state.deviceDraft = cloneData(state.config?.devices || []);
  state.discoveryResults = [];
  renderConfiguredDevices();
  $("#discovery-results").innerHTML = "";
  const firstIPv4 = state.deviceDraft.find((device) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(device.address || ""));
  if (firstIPv4) {
    const octets = firstIPv4.address.split(".").map(Number);
    $("#discovery-subnet").value = `${octets[0]}.${octets[1]}.${octets[2] & 254}.0/23`;
  }
  resetDeviceEditor();
  $("#devices-dialog").showModal();
}

function renderDiscoveryResults() {
  const results = $("#discovery-results");
  if (!state.discoveryResults.length) {
    results.innerHTML = `<div class="discovery-empty">No compatible devices were found in this /23 range.</div>`;
    return;
  }
  const draftAddresses = new Set(state.deviceDraft.map((device) => device.address));
  results.innerHTML = state.discoveryResults.map((device) => {
    const added = device.already_configured || draftAddresses.has(device.address);
    const evidence = device.evidence || {};
    const identity = [device.confidence === "confirmed" ? `Confirmed from live feed (${evidence.scada_value_count || 0} values)` : "Probable — live feed did not validate", evidence.http_server ? `Server ${evidence.http_server}` : "", evidence.modbus_tcp_open ? "Modbus TCP available" : "", device.serial ? `Serial ${device.serial}` : "", device.mac ? `MAC ${device.mac}` : "", device.retried ? "Found on slow retry" : ""].filter(Boolean).join(" · ");
    return `<div class="discovery-result">
      <div><strong>${escapeHTML(device.address)} <span class="discovery-confidence ${escapeHTML(device.confidence || "probable")}">${escapeHTML(device.confidence || "probable")}</span></strong><small>${escapeHTML(`${device.manufacturer || "Datakom"} ${device.model || "DKM-411"}`)} · ${escapeHTML(device.title || "DKM411 Web Scada")}${identity ? `<br>${escapeHTML(identity)}` : ""}</small></div>
      <select data-discovery-type="${escapeHTML(device.address)}" ${added ? "disabled" : ""}><option value="distro">Power distro</option><option value="cam_split">Cam split</option></select>
      <button class="button button-secondary" type="button" data-add-discovery="${escapeHTML(device.address)}" ${added ? "disabled" : ""}>${added ? "Added" : "Add"}</button>
    </div>`;
  }).join("");
}

async function discoverDevices() {
  const button = $("#discover-button");
  if (state.discoveryController) {
    state.discoveryController.abort();
    return;
  }
  const controller = new AbortController();
  state.discoveryController = controller;
  button.textContent = "Cancel scan";
  let progress = 2;
  $("#discovery-results").innerHTML = `<div class="discovery-progress"><div><strong>Scanning 510 addresses</strong><span id="discovery-progress-label">Starting fast pass…</span></div><div><i id="discovery-progress-bar" style="width:2%"></i></div></div>`;
  const progressTimer = setInterval(() => {
    progress = Math.min(94, progress + (progress < 55 ? 4 : 1));
    $("#discovery-progress-bar")?.style.setProperty("width", `${progress}%`);
    const label = $("#discovery-progress-label");
    if (label) label.textContent = progress > 55 ? "Retrying slower addresses…" : "Checking for compatible DKM411 devices…";
  }, 350);
  try {
    const result = await api("/api/discover", { method: "POST", body: JSON.stringify({ subnet: $("#discovery-subnet").value.trim() }), signal: controller.signal });
    state.discoveryResults = result.devices || [];
    if (result.networks?.length) $("#discovery-subnet").value = result.networks[0];
    renderDiscoveryResults();
    showToast(state.discoveryResults.length ? `Found ${plural(state.discoveryResults.length, "compatible device")}.` : "No compatible devices were found.");
  } catch (error) {
    $("#discovery-results").innerHTML = "";
    showToast(error.name === "AbortError" ? "Network discovery cancelled." : error.message, error.name !== "AbortError");
  } finally {
    clearInterval(progressTimer);
    state.discoveryController = null;
    button.textContent = "Discover";
  }
}

function addDiscoveredDevice(address) {
  if (state.deviceDraft.some((device) => device.address === address)) return;
  const result = state.discoveryResults.find((device) => device.address === address);
  const type = $$('[data-discovery-type]', $("#discovery-results")).find((select) => select.dataset.discoveryType === address)?.value || "distro";
  state.deviceDraft.push({
    id: newDeviceId(), name: result?.serial ? `DKM411 ${result.serial}` : "", address, scheme: "http", port: 80, path: "/",
    breaker_amps: null, device_type: type,
  });
  renderConfiguredDevices();
  renderDiscoveryResults();
  showToast(`${type === "cam_split" ? "Cam split" : "Power distro"} ${result?.address || address} added. Save changes when ready.`);
}

function editDevice(deviceId) {
  const device = state.deviceDraft.find((item) => item.id === deviceId);
  if (!device) return;
  $("#device-id").value = device.id;
  $("#device-name").value = device.name;
  $("#device-address").value = device.address;
  $("#device-scheme").value = device.scheme;
  $("#device-port").value = device.port;
  $("#device-path").value = device.path;
  $("#device-breaker-amps").value = device.breaker_amps || "";
  $("#device-type").value = device.device_type || "distro";
  syncDeviceTypeFields();
  $("#editor-title").textContent = "Edit device";
  $("#stage-device-button").textContent = "Update device";
  $("#cancel-edit-button").hidden = false;
  $("#device-name").focus();
}

function stageDevice(event) {
  event.preventDefault();
  const id = $("#device-id").value || newDeviceId();
  const device = {
    id,
    name: $("#device-name").value.trim(),
    address: $("#device-address").value.trim(),
    scheme: $("#device-scheme").value,
    port: Number($("#device-port").value),
    path: $("#device-path").value.trim() || "/",
    breaker_amps: $("#device-breaker-amps").value ? Number($("#device-breaker-amps").value) : null,
    device_type: $("#device-type").value,
  };
  const existingIndex = state.deviceDraft.findIndex((item) => item.id === id);
  if (existingIndex >= 0) state.deviceDraft.splice(existingIndex, 1, device);
  else state.deviceDraft.push(device);
  renderConfiguredDevices();
  resetDeviceEditor();
  showToast(existingIndex >= 0 ? "Device updated in the list. Save changes when ready." : "Device added to the list. Save changes when ready.");
}

async function saveDevices() {
  const button = $("#save-devices-button");
  button.disabled = true;
  try {
    const validDeviceIDs = new Set(state.deviceDraft.map((device) => device.id));
    const services = (state.config.services || []).map((service) => ({
      ...service,
      device_ids: (service.device_ids || []).filter((deviceId) => validDeviceIDs.has(deviceId)),
    }));
    const response = await api("/api/config", {
      method: "PUT",
      body: JSON.stringify({ ...state.config, devices: state.deviceDraft, services }),
    });
    state.config = response.config;
    $("#devices-dialog").close();
    showToast("Device configuration saved.");
    await refreshStatus();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

function serviceDeviceNames(service) {
  const devices = state.config?.devices || [];
  return (service.device_ids || []).map((deviceId) => {
    const device = devices.find((item) => item.id === deviceId);
    return device ? (device.name || device.address) : "Unknown device";
  });
}

function renderConfiguredServices() {
  const list = $("#configured-services-list");
  $("#configured-services-count").textContent = plural(state.serviceDraft.length, "service");
  if (!state.serviceDraft.length) {
    list.innerHTML = `<div class="configured-empty">No services configured yet.</div>`;
    return;
  }
  list.innerHTML = state.serviceDraft.map((service) => {
    const devices = serviceDeviceNames(service);
    const detail = `${Number(service.amp_rating).toLocaleString()}A · ${devices.length ? devices.join(", ") : "No devices assigned"}`;
    return `<div class="configured-service">
      <div class="configured-service-info"><strong>${escapeHTML(service.name)}</strong><small>${escapeHTML(detail)}</small></div>
      <button class="button button-quiet" type="button" data-edit-service="${escapeHTML(service.id)}" aria-label="Edit ${escapeHTML(service.name)}">Edit</button>
      <button class="button button-danger" type="button" data-remove-service="${escapeHTML(service.id)}" aria-label="Remove ${escapeHTML(service.name)}">×</button>
    </div>`;
  }).join("");
}

function renderServiceDeviceChoices(selectedIDs = [], editingServiceID = "") {
  const list = $("#service-device-list");
  const devices = state.config?.devices || [];
  if (!devices.length) {
    list.innerHTML = `<div class="service-device-empty">Add devices before assigning them to a service.</div>`;
    return;
  }
  list.innerHTML = devices.map((device) => {
    const assignedService = state.serviceDraft.find((service) => service.id !== editingServiceID && (service.device_ids || []).includes(device.id));
    const checked = selectedIDs.includes(device.id);
    return `<label class="service-device-option${assignedService ? " assigned" : ""}">
      <input type="checkbox" value="${escapeHTML(device.id)}" ${checked ? "checked" : ""} ${assignedService ? "disabled" : ""}>
      <span>${escapeHTML(device.name || device.address)}<small>${escapeHTML(assignedService ? `Assigned to ${assignedService.name}` : `${device.device_type === "cam_split" ? "Cam split" : "Power distro"} · ${device.address}`)}</small></span>
    </label>`;
  }).join("");
}

function resetServiceEditor(focus = false) {
  $("#service-form").reset();
  $("#service-id").value = "";
  $("#service-editor-title").textContent = "New service";
  $("#stage-service-button").textContent = "Add to list";
  $("#cancel-service-edit-button").hidden = true;
  renderServiceDeviceChoices();
  if (focus) $("#service-name").focus();
}

function openServicesManager() {
  state.serviceDraft = cloneData(state.config?.services || []);
  renderConfiguredServices();
  resetServiceEditor();
  $("#services-dialog").showModal();
}

function editService(serviceId) {
  const service = state.serviceDraft.find((item) => item.id === serviceId);
  if (!service) return;
  $("#service-id").value = service.id;
  $("#service-name").value = service.name;
  $("#service-amp-rating").value = service.amp_rating;
  $("#service-editor-title").textContent = "Edit service";
  $("#stage-service-button").textContent = "Update service";
  $("#cancel-service-edit-button").hidden = false;
  renderServiceDeviceChoices(service.device_ids || [], service.id);
  $("#service-name").focus();
}

function stageService(event) {
  event.preventDefault();
  const id = $("#service-id").value || newDeviceId();
  const service = {
    id,
    name: $("#service-name").value.trim(),
    amp_rating: Number($("#service-amp-rating").value),
    device_ids: $$("#service-device-list input:checked").map((input) => input.value),
  };
  const existingIndex = state.serviceDraft.findIndex((item) => item.id === id);
  if (existingIndex >= 0) state.serviceDraft.splice(existingIndex, 1, service);
  else state.serviceDraft.push(service);
  renderConfiguredServices();
  resetServiceEditor();
  showToast(existingIndex >= 0 ? "Service updated in the list. Save changes when ready." : "Service added to the list. Save changes when ready.");
}

async function saveServices() {
  const button = $("#save-services-button");
  button.disabled = true;
  try {
    const response = await api("/api/config", { method: "PUT", body: JSON.stringify({ ...state.config, services: state.serviceDraft }) });
    state.config = response.config;
    $("#services-dialog").close();
    showToast("Service configuration saved.");
    await refreshStatus();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

function openSettings() {
  const settings = state.config.settings;
  $("#refresh-seconds").value = settings.refresh_seconds;
  $("#timeout-seconds").value = settings.timeout_seconds;
  $("#max-response-kb").value = settings.max_response_kb;
  $("#settings-dialog").showModal();
}

async function saveSettings(event) {
  event.preventDefault();
  const settings = {
    refresh_seconds: Number($("#refresh-seconds").value),
    timeout_seconds: Number($("#timeout-seconds").value),
    max_response_kb: Number($("#max-response-kb").value),
  };
  try {
    const response = await api("/api/config", { method: "PUT", body: JSON.stringify({ ...state.config, settings }) });
    state.config = response.config;
    $("#settings-dialog").close();
    showToast("Monitor settings saved.");
    await refreshStatus();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function saveQuickRefreshRate(event) {
  if (!state.config) return;
  const select = event.currentTarget;
  const previous = state.config.settings.refresh_seconds;
  const settings = { ...state.config.settings, refresh_seconds: Number(select.value) };
  select.disabled = true;
  try {
    const response = await api("/api/config", { method: "PUT", body: JSON.stringify({ ...state.config, settings }) });
    state.config = response.config;
    syncRefreshRate(response.config.settings.refresh_seconds);
    showToast(`Auto refresh set to ${plural(response.config.settings.refresh_seconds, "second")}.`);
    await refreshStatus();
  } catch (error) {
    syncRefreshRate(previous);
    showToast(error.message, true);
  } finally {
    select.disabled = false;
  }
}

function diagnosticsOverview(data) {
  const device = data.device;
  const capture = data.capture;
  if (!capture) return `<div class="diagnostic-note">No page has been captured from this device yet. Check the address and network connection, then refresh.</div>`;
  const fields = capture.fields || [];
  const metrics = capture.metrics || [];
  return `
    <div class="diagnostic-summary">
      <div class="diagnostic-stat"><span>HTTP response</span><strong>${escapeHTML(device.http_status || "—")}</strong></div>
      <div class="diagnostic-stat"><span>Response time</span><strong>${device.response_ms == null ? "—" : `${escapeHTML(device.response_ms)} ms`}</strong></div>
      <div class="diagnostic-stat"><span>Page size</span><strong>${escapeHTML(Math.round((device.content_bytes || 0) / 1024))} KB${device.truncated ? " (limited)" : ""}</strong></div>
      <div class="diagnostic-stat"><span>Extracted items</span><strong>${escapeHTML(fields.length)}</strong></div>
    </div>
    <section class="diagnostics-section"><h3>Recognized electrical values</h3>
      ${metrics.length ? `<table class="data-table"><thead><tr><th>Metric</th><th>Value</th></tr></thead><tbody>${metrics.map((item) => `<tr><td>${escapeHTML(item.label)}</td><td>${escapeHTML(item.value)} ${escapeHTML(item.unit)}</td></tr>`).join("")}</tbody></table>` : `<div class="diagnostic-note">No standard voltage, current, power, energy, frequency, temperature, load, or power-factor labels were recognized.</div>`}
    </section>
    <section class="diagnostics-section"><h3>All extracted key/value data</h3>
      ${fields.length ? `<table class="data-table"><thead><tr><th>Label</th><th>Value</th><th>Source</th></tr></thead><tbody>${fields.map((item) => `<tr><td>${escapeHTML(item.label)}</td><td>${escapeHTML(item.value)}</td><td><span class="source-chip">${escapeHTML(item.source)}</span></td></tr>`).join("")}</tbody></table>` : `<div class="diagnostic-note">The page responded, but it did not expose obvious key/value pairs.</div>`}
    </section>`;
}

function diagnosticsTables(data) {
  const capture = data.capture;
  if (!capture) return `<div class="diagnostic-note">No page has been captured from this device yet.</div>`;
  const tables = capture.tables || [];
  const forms = capture.forms || [];
  const tablesMarkup = tables.length ? tables.map((table, tableIndex) => `
    <section class="diagnostics-section"><h3>Table ${tableIndex + 1}</h3><table class="data-table"><tbody>${table.map((row) => `<tr>${row.map((cell) => `<td>${escapeHTML(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></section>`).join("") : `<div class="diagnostic-note">No HTML tables were found.</div>`;
  const formsMarkup = forms.length ? forms.map((form, index) => `
    <section class="diagnostics-section"><h3>Form ${index + 1} · ${escapeHTML(form.method)} ${escapeHTML(form.action || "current page")}</h3>
    <table class="data-table"><thead><tr><th>Element</th><th>Name / ID</th><th>Type</th><th>Value</th></tr></thead><tbody>${(form.fields || []).map((item) => `<tr><td>${escapeHTML(item.element)}</td><td>${escapeHTML(item.name || item.id || item.placeholder)}</td><td>${escapeHTML(item.type)}</td><td>${escapeHTML(item.value)}</td></tr>`).join("")}</tbody></table></section>`).join("") : `<div class="diagnostic-note">No HTML forms were found.</div>`;
  return `<section class="diagnostics-section"><h3>Captured tables</h3>${tablesMarkup}</section><section class="diagnostics-section"><h3>Captured forms</h3>${formsMarkup}</section>`;
}

function renderDiagnosticsTab() {
  const body = $("#diagnostics-body");
  if (!state.diagnostics) return;
  $$(".tab-button").forEach((button) => button.classList.toggle("active", button.dataset.tab === state.diagnosticsTab));
  if (state.diagnosticsTab === "overview") {
    body.innerHTML = diagnosticsOverview(state.diagnostics);
  } else if (state.diagnosticsTab === "tables") {
    body.innerHTML = diagnosticsTables(state.diagnostics);
  } else {
    body.innerHTML = "";
    const capture = state.diagnostics.capture;
    const pre = document.createElement("pre");
    pre.className = "raw-capture";
    pre.textContent = capture?.raw_html || "No raw page has been captured from this device yet.";
    body.append(pre);
  }
}

async function openDiagnostics(deviceId) {
  const device = state.status?.devices.find((item) => item.id === deviceId);
  $("#diagnostics-title").textContent = device ? deviceDisplayName(device) : "Device diagnostics";
  $("#diagnostics-subtitle").textContent = device ? `${device.url} · Loading capture…` : "Loading capture…";
  $("#diagnostics-body").innerHTML = `<div class="diagnostic-note">Loading captured device structure…</div>`;
  $("#diagnostics-dialog").showModal();
  try {
    state.diagnostics = await api(`/api/devices/${encodeURIComponent(deviceId)}/diagnostics`);
    state.diagnosticsTab = "overview";
    const captured = state.diagnostics.capture?.fetched_at;
    $("#diagnostics-subtitle").textContent = `${state.diagnostics.device.url}${captured ? ` · Captured ${formatTime(captured)}` : " · No capture yet"}`;
    renderDiagnosticsTab();
  } catch (error) {
    $("#diagnostics-body").innerHTML = `<div class="diagnostic-note">${escapeHTML(error.message)}</div>`;
  }
}

async function copyDiagnostics() {
  if (!state.diagnostics) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(state.diagnostics, null, 2));
    showToast("Diagnostics copied to the clipboard.");
  } catch {
    showToast("The browser could not copy diagnostics. Select the raw capture and copy it manually.", true);
  }
}

function bindEvents() {
  $("#manage-button").addEventListener("click", openDeviceManager);
  $("#empty-add-button").addEventListener("click", openDeviceManager);
  $("#services-button").addEventListener("click", openServicesManager);
  $("#edit-services-button").addEventListener("click", openServicesManager);
  $("#settings-button").addEventListener("click", openSettings);
  $("#alerts-button").addEventListener("click", openAlerts);
  $("#device-form").addEventListener("submit", stageDevice);
  $("#service-form").addEventListener("submit", stageService);
  $("#cancel-edit-button").addEventListener("click", () => resetDeviceEditor());
  $("#cancel-service-edit-button").addEventListener("click", () => resetServiceEditor());
  $("#add-device-button").addEventListener("click", () => resetDeviceEditor(true));
  $("#discover-button").addEventListener("click", discoverDevices);
  $("#add-service-button").addEventListener("click", () => resetServiceEditor(true));
  $("#save-devices-button").addEventListener("click", saveDevices);
  $("#save-services-button").addEventListener("click", saveServices);
  $("#settings-form").addEventListener("submit", saveSettings);
  $("#refresh-rate-select").addEventListener("change", saveQuickRefreshRate);
  $("#copy-diagnostics-button").addEventListener("click", copyDiagnostics);
  $("#acknowledge-alerts-button").addEventListener("click", acknowledgeAlerts);
  $("#check-update-button").addEventListener("click", () => refreshUpdateStatus(true));
  $("#install-update-button").addEventListener("click", installUpdate);
  $("#trend-range-select").addEventListener("change", () => state.status && renderDevices(state.status));
  $("#search-input").addEventListener("input", () => state.status && renderDevices(state.status));
  $("#status-filter").addEventListener("change", () => state.status && renderDevices(state.status));
  $("#refresh-button").addEventListener("click", async () => {
    const button = $("#refresh-button");
    button.classList.add("spinning");
    try {
      await api("/api/refresh", { method: "POST", body: "{}" });
      showToast("A fresh device check has started.");
      setTimeout(refreshStatus, 300);
    } catch (error) {
      showToast(error.message, true);
    } finally {
      setTimeout(() => button.classList.remove("spinning"), 800);
    }
  });
  $("#device-scheme").addEventListener("change", (event) => {
    const port = $("#device-port");
    if (port.value === "80" || port.value === "443") port.value = event.target.value === "https" ? "443" : "80";
  });
  $("#device-type").addEventListener("change", syncDeviceTypeFields);
  $("#configured-list").addEventListener("click", (event) => {
    const edit = event.target.closest("[data-edit-device]");
    const remove = event.target.closest("[data-remove-device]");
    if (edit) editDevice(edit.dataset.editDevice);
    if (remove) {
      const device = state.deviceDraft.find((item) => item.id === remove.dataset.removeDevice);
      if (device && window.confirm(`Remove ${device.name || device.address} from the dashboard?`)) {
        state.deviceDraft = state.deviceDraft.filter((item) => item.id !== device.id);
        renderConfiguredDevices();
        if ($("#device-id").value === device.id) resetDeviceEditor();
      }
    }
  });
  $("#discovery-results").addEventListener("click", (event) => {
    const target = event.target.closest("[data-add-discovery]");
    if (target) addDiscoveredDevice(target.dataset.addDiscovery);
  });
  $("#configured-services-list").addEventListener("click", (event) => {
    const edit = event.target.closest("[data-edit-service]");
    const remove = event.target.closest("[data-remove-service]");
    if (edit) editService(edit.dataset.editService);
    if (remove) {
      const service = state.serviceDraft.find((item) => item.id === remove.dataset.removeService);
      if (service && window.confirm(`Remove ${service.name} from the dashboard?`)) {
        state.serviceDraft = state.serviceDraft.filter((item) => item.id !== service.id);
        renderConfiguredServices();
        if ($("#service-id").value === service.id) resetServiceEditor();
      }
    }
  });
  $("#device-grid").addEventListener("click", (event) => {
    const target = event.target.closest("[data-diagnostics]");
    if (target) openDiagnostics(target.dataset.diagnostics);
  });
  $(".tab-list").addEventListener("click", (event) => {
    const tab = event.target.closest("[data-tab]");
    if (!tab) return;
    state.diagnosticsTab = tab.dataset.tab;
    renderDiagnosticsTab();
  });
  $$(".close-dialog").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
  $$("dialog").forEach((dialog) => dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  }));
}

async function initialize() {
  bindEvents();
  try {
    state.config = await api("/api/config");
    state.config.services = state.config.services || [];
    await refreshStatus();
    await refreshUpdateStatus(location.hash === "#updates");
    state.statusTimer = setInterval(refreshStatus, 1500);
    state.updateTimer = setInterval(refreshUpdateStatus, 60_000);
  } catch (error) {
    showToast(`Power Monitor could not start: ${error.message}`, true);
    await refreshStatus();
  }
}

document.addEventListener("DOMContentLoaded", initialize);
