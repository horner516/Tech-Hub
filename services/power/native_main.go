package main

import (
	"bufio"
	"bytes"
	"context"
	"embed"
	"encoding/binary"
	"encoding/json"
	"encoding/xml"
	"errors"
	"flag"
	"fmt"
	"html"
	"io"
	"log"
	"math"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const appName = "Streamline Power Monitor"

var version = "2.10.0"

//go:embed web/* default_settings.json
var bundledFiles embed.FS

type Settings struct {
	RefreshSeconds float64 `json:"refresh_seconds"`
	TimeoutSeconds float64 `json:"timeout_seconds"`
	MaxResponseKB  int     `json:"max_response_kb"`
}

type Device struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Address     string  `json:"address"`
	Scheme      string  `json:"scheme"`
	Port        int     `json:"port"`
	Path        string  `json:"path"`
	BreakerAmps float64 `json:"breaker_amps,omitempty"`
	DeviceType  string  `json:"device_type"`
}

type Service struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	AmpRating float64  `json:"amp_rating"`
	DeviceIDs []string `json:"device_ids"`
}

type Config struct {
	Version  int       `json:"version"`
	Settings Settings  `json:"settings"`
	Devices  []Device  `json:"devices"`
	Services []Service `json:"services"`
}

type Metric struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Value string `json:"value"`
	Unit  string `json:"unit"`
}

type Field struct {
	Label  string `json:"label"`
	Value  string `json:"value"`
	Source string `json:"source"`
}

type PeakCurrent struct {
	Value      string  `json:"value"`
	Unit       string  `json:"unit"`
	ObservedAt string  `json:"observed_at"`
	Source     string  `json:"source"`
	Numeric    float64 `json:"-"`
}

type ServicePeak struct {
	Load       float64
	ObservedAt string
}

type Alert struct {
	ID           string `json:"id"`
	ConditionID  string `json:"condition_id"`
	Severity     string `json:"severity"`
	Title        string `json:"title"`
	Message      string `json:"message"`
	OccurredAt   string `json:"occurred_at"`
	Acknowledged bool   `json:"acknowledged"`
}

type alertCondition struct {
	Count      int
	ClearCount int
	Active     bool
}

type Capture struct {
	Title       string              `json:"title"`
	Metrics     []Metric            `json:"metrics"`
	PhaseAlerts []string            `json:"phase_alerts"`
	Fields      []Field             `json:"fields"`
	Tables      [][][]string        `json:"tables"`
	Forms       []map[string]any    `json:"forms"`
	Meta        []map[string]string `json:"meta"`
	ScriptVals  []Field             `json:"script_values"`
	Text        string              `json:"text"`
	RawHTML     string              `json:"raw_html"`
	Headers     map[string]string   `json:"headers"`
	FetchedAt   string              `json:"fetched_at"`
	Truncated   bool                `json:"truncated"`
	URL         string              `json:"url"`
	LiveFeed    map[string]any      `json:"live_feed,omitempty"`
}

type Record struct {
	Device        Device
	Status        string
	CheckedAt     string
	LastSeen      string
	ResponseMS    int64
	HTTPStatus    int
	ContentType   string
	ContentBytes  int
	Truncated     bool
	Error         string
	Title         string
	Metrics       []Metric
	PhaseAlerts   []string
	PeakCurrents  map[string]PeakCurrent
	MeterDemand   map[string]PeakCurrent
	ObservedPeaks map[string]PeakCurrent
	History       []map[string]any
	Fields        []Field
	Capture       *Capture
	Stale         bool
}

type fetchResult struct {
	Status       string
	CheckedAt    string
	LastSeen     string
	ResponseMS   int64
	HTTPStatus   int
	ContentType  string
	ContentBytes int
	Truncated    bool
	Error        string
	Title        string
	Metrics      []Metric
	PhaseAlerts  []string
	Fields       []Field
	Capture      *Capture
}

type Store struct {
	mu     sync.RWMutex
	path   string
	config Config
}

func defaultConfig() Config {
	return Config{Version: 2, Settings: Settings{RefreshSeconds: 5, TimeoutSeconds: 2.5, MaxResponseKB: 512}, Devices: []Device{}, Services: []Service{}}
}

func loadStore(path string) (*Store, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		data, err = bundledFiles.ReadFile("default_settings.json")
	}
	if err != nil {
		return nil, err
	}
	config := defaultConfig()
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, fmt.Errorf("settings could not be read: %w", err)
	}
	if err := validateConfig(&config); err != nil {
		return nil, err
	}
	return &Store{path: path, config: config}, nil
}

func (s *Store) Get() Config {
	s.mu.RLock()
	defer s.mu.RUnlock()
	data, _ := json.Marshal(s.config)
	var clone Config
	_ = json.Unmarshal(data, &clone)
	return clone
}

func (s *Store) Save(config Config) error {
	if err := validateConfig(&config); err != nil {
		return err
	}
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	temporary := s.path + ".tmp"
	if err := os.WriteFile(temporary, data, 0o600); err != nil {
		return err
	}
	if err := os.Rename(temporary, s.path); err != nil {
		// Windows does not replace an existing destination with Rename.
		if runtime.GOOS != "windows" {
			_ = os.Remove(temporary)
			return err
		}
		if removeErr := os.Remove(s.path); removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
			_ = os.Remove(temporary)
			return removeErr
		}
		if renameErr := os.Rename(temporary, s.path); renameErr != nil {
			_ = os.Remove(temporary)
			return renameErr
		}
	}
	s.mu.Lock()
	s.config = config
	s.mu.Unlock()
	return nil
}

func validateConfig(config *Config) error {
	config.Version = 2
	if config.Devices == nil {
		config.Devices = []Device{}
	}
	if config.Services == nil {
		config.Services = []Service{}
	}
	if config.Settings.RefreshSeconds < 1 || config.Settings.RefreshSeconds > 3600 {
		return errors.New("Refresh interval must be between 1 and 3,600 seconds.")
	}
	if config.Settings.TimeoutSeconds < .25 || config.Settings.TimeoutSeconds > 60 {
		return errors.New("Request timeout must be between 0.25 and 60 seconds.")
	}
	if config.Settings.MaxResponseKB < 32 || config.Settings.MaxResponseKB > 4096 {
		return errors.New("Response limit must be between 32 and 4,096 KB.")
	}
	if len(config.Devices) > 1000 {
		return errors.New("A configuration may contain at most 1,000 devices.")
	}
	ids := map[string]bool{}
	urls := map[string]bool{}
	for index := range config.Devices {
		device := &config.Devices[index]
		device.DeviceType = strings.ToLower(strings.TrimSpace(device.DeviceType))
		if device.DeviceType == "" {
			device.DeviceType = "distro"
		}
		if device.DeviceType != "distro" && device.DeviceType != "cam_split" {
			return fmt.Errorf("Device %d type must be a power distro or Cam split.", index+1)
		}
		device.Address = strings.TrimSpace(device.Address)
		if net.ParseIP(strings.Trim(device.Address, "[]")) == nil {
			return fmt.Errorf("%s is not a valid IP address.", device.Address)
		}
		device.Address = strings.Trim(device.Address, "[]")
		device.Scheme = strings.ToLower(strings.TrimSpace(device.Scheme))
		if device.Scheme != "http" && device.Scheme != "https" {
			return fmt.Errorf("Device %d protocol must be HTTP or HTTPS.", index+1)
		}
		if device.Port < 1 || device.Port > 65535 {
			return fmt.Errorf("Device %d port must be between 1 and 65,535.", index+1)
		}
		device.Path = strings.TrimSpace(device.Path)
		if device.Path == "" {
			device.Path = "/"
		}
		if !strings.HasPrefix(device.Path, "/") || strings.ContainsAny(device.Path, " \r\n\t") {
			return fmt.Errorf("Device %d path must start with / and contain no spaces.", index+1)
		}
		if len(device.Name) > 80 {
			return fmt.Errorf("Device %d name must be 80 characters or fewer.", index+1)
		}
		if device.BreakerAmps < 0 || device.BreakerAmps > 100000 {
			return fmt.Errorf("Device %d breaker amps must be between 1 and 100,000, or left blank.", index+1)
		}
		if !regexp.MustCompile(`^[A-Za-z0-9_-]{6,80}$`).MatchString(device.ID) {
			return fmt.Errorf("Device %d has an invalid ID.", index+1)
		}
		if ids[device.ID] {
			return fmt.Errorf("Device %d has a duplicate ID.", index+1)
		}
		address := deviceURL(*device)
		if urls[address] {
			return fmt.Errorf("%s is listed more than once.", address)
		}
		ids[device.ID], urls[address] = true, true
	}
	if len(config.Services) > 200 {
		return errors.New("A configuration may contain at most 200 services.")
	}
	serviceIDs := map[string]bool{}
	assignedDevices := map[string]bool{}
	for index := range config.Services {
		service := &config.Services[index]
		service.Name = strings.TrimSpace(service.Name)
		if service.Name == "" || len(service.Name) > 80 {
			return fmt.Errorf("Service %d must have a name of 80 characters or fewer.", index+1)
		}
		if service.AmpRating < 1 || service.AmpRating > 100000 {
			return fmt.Errorf("Service %d amp rating must be between 1 and 100,000.", index+1)
		}
		if !regexp.MustCompile(`^[A-Za-z0-9_-]{6,80}$`).MatchString(service.ID) {
			return fmt.Errorf("Service %d has an invalid ID.", index+1)
		}
		if serviceIDs[service.ID] {
			return fmt.Errorf("Service %d has a duplicate ID.", index+1)
		}
		serviceIDs[service.ID] = true
		if service.DeviceIDs == nil {
			service.DeviceIDs = []string{}
		}
		uniqueDeviceIDs := []string{}
		for _, deviceID := range service.DeviceIDs {
			if !ids[deviceID] {
				return fmt.Errorf("Service %d references a device that does not exist.", index+1)
			}
			alreadyIncluded := false
			for _, existing := range uniqueDeviceIDs {
				if existing == deviceID {
					alreadyIncluded = true
				}
			}
			if alreadyIncluded {
				continue
			}
			if assignedDevices[deviceID] {
				return errors.New("A power device can belong to only one service.")
			}
			uniqueDeviceIDs = append(uniqueDeviceIDs, deviceID)
			assignedDevices[deviceID] = true
		}
		service.DeviceIDs = uniqueDeviceIDs
	}
	return nil
}

func deviceURL(device Device) string {
	host := device.Address
	if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	defaultPort := 80
	if device.Scheme == "https" {
		defaultPort = 443
	}
	if device.Port != defaultPort {
		host += ":" + strconv.Itoa(device.Port)
	}
	return device.Scheme + "://" + host + device.Path
}

type Monitor struct {
	mu              sync.RWMutex
	store           *Store
	records         map[string]*Record
	servicePeaks    map[string]ServicePeak
	alerts          []Alert
	alertConditions map[string]*alertCondition
	running         bool
	cycleStarted    string
	cycleFinished   string
	refresh         chan struct{}
	stop            chan struct{}
}

func newMonitor(store *Store) *Monitor {
	m := &Monitor{store: store, records: map[string]*Record{}, servicePeaks: map[string]ServicePeak{}, alerts: []Alert{}, alertConditions: map[string]*alertCondition{}, refresh: make(chan struct{}, 1), stop: make(chan struct{})}
	m.syncRecords(store.Get())
	return m
}

func (m *Monitor) syncRecords(config Config) {
	m.mu.Lock()
	defer m.mu.Unlock()
	next := map[string]*Record{}
	for _, device := range config.Devices {
		if existing := m.records[device.ID]; existing != nil {
			existing.Device = device
			next[device.ID] = existing
		} else {
			next[device.ID] = &Record{Device: device, Status: "pending", Metrics: []Metric{}, PhaseAlerts: []string{}, PeakCurrents: map[string]PeakCurrent{}, MeterDemand: map[string]PeakCurrent{}, ObservedPeaks: map[string]PeakCurrent{}, History: []map[string]any{}, Fields: []Field{}}
		}
	}
	m.records = next
}

func (m *Monitor) Start() { go m.loop() }

func (m *Monitor) Stop() {
	select {
	case <-m.stop:
	default:
		close(m.stop)
	}
}

func (m *Monitor) RequestRefresh() {
	select {
	case m.refresh <- struct{}{}:
	default:
	}
}

func (m *Monitor) loop() {
	for {
		m.runCycle()
		interval := time.Duration(m.store.Get().Settings.RefreshSeconds * float64(time.Second))
		timer := time.NewTimer(interval)
		select {
		case <-timer.C:
		case <-m.refresh:
			if !timer.Stop() {
				<-timer.C
			}
		case <-m.stop:
			timer.Stop()
			return
		}
	}
}

func (m *Monitor) runCycle() {
	config := m.store.Get()
	m.mu.Lock()
	m.running = true
	m.cycleStarted = nowString()
	m.mu.Unlock()
	var wait sync.WaitGroup
	for _, device := range config.Devices {
		device := device
		wait.Add(1)
		go func() {
			defer wait.Done()
			result := fetchDevice(device, config.Settings)
			m.apply(device.ID, result)
		}()
	}
	wait.Wait()
	m.mu.Lock()
	m.updateServicePeaks(config)
	m.evaluateAlerts(config)
	m.running = false
	m.cycleFinished = nowString()
	m.mu.Unlock()
}

func (m *Monitor) serviceLoad(service Service) (float64, int) {
	phaseTotals, reportingDevices := m.servicePhaseLoads(service)
	load := math.Max(phaseTotals["l1_current"], math.Max(phaseTotals["l2_current"], phaseTotals["l3_current"]))
	return load, reportingDevices
}

func (m *Monitor) servicePhaseLoads(service Service) (map[string]float64, int) {
	phaseTotals := map[string]float64{"l1_current": 0, "l2_current": 0, "l3_current": 0}
	reportingDevices := 0
	for _, deviceID := range service.DeviceIDs {
		record := m.records[deviceID]
		if record == nil || record.Device.DeviceType == "cam_split" || (record.Status != "online" && record.Status != "warning") {
			continue
		}
		contributed := false
		for _, metric := range record.Metrics {
			if _, tracked := phaseTotals[metric.Key]; !tracked {
				continue
			}
			value, err := strconv.ParseFloat(strings.ReplaceAll(metric.Value, ",", ""), 64)
			if err == nil {
				phaseTotals[metric.Key] += value
				contributed = true
			}
		}
		if contributed {
			reportingDevices++
		}
	}
	return phaseTotals, reportingDevices
}

func (m *Monitor) updateServicePeaks(config Config) {
	observedAt := nowString()
	for _, service := range config.Services {
		complete, _, _ := m.serviceQuality(service)
		if !complete {
			continue
		}
		load, _ := m.serviceLoad(service)
		previous, exists := m.servicePeaks[service.ID]
		if !exists || load > previous.Load {
			m.servicePeaks[service.ID] = ServicePeak{Load: load, ObservedAt: observedAt}
		}
	}
}

func (m *Monitor) serviceQuality(service Service) (bool, []map[string]any, int) {
	missing := []map[string]any{}
	loadDeviceCount := 0
	for _, deviceID := range service.DeviceIDs {
		record := m.records[deviceID]
		if record == nil || record.Device.DeviceType == "cam_split" {
			continue
		}
		loadDeviceCount++
		currents := map[string]bool{"l1_current": false, "l2_current": false, "l3_current": false}
		for _, metric := range record.Metrics {
			if _, tracked := currents[metric.Key]; tracked {
				if _, err := strconv.ParseFloat(strings.ReplaceAll(metric.Value, ",", ""), 64); err == nil {
					currents[metric.Key] = true
				}
			}
		}
		hasCurrents := currents["l1_current"] && currents["l2_current"] && currents["l3_current"]
		if (record.Status != "online" && record.Status != "warning") || !hasCurrents {
			name := record.Device.Name
			if name == "" {
				name = record.Device.Address
			}
			reason := "Current readings unavailable"
			if record.Status == "offline" {
				reason = "Offline"
			}
			missing = append(missing, map[string]any{"id": record.Device.ID, "name": name, "address": record.Device.Address, "status": record.Status, "reason": reason})
		}
	}
	return loadDeviceCount > 0 && len(missing) == 0, missing, loadDeviceCount
}

func roundOne(value float64) float64 { return math.Round(value*10) / 10 }

func (m *Monitor) publicService(service Service) map[string]any {
	phaseTotals, reportingDevices := m.servicePhaseLoads(service)
	currentLoad := math.Max(phaseTotals["l1_current"], math.Max(phaseTotals["l2_current"], phaseTotals["l3_current"]))
	complete, missing, loadDeviceCount := m.serviceQuality(service)
	peak, exists := m.servicePeaks[service.ID]
	if !exists {
		if complete {
			peak = ServicePeak{Load: currentLoad}
		} else {
			peak = ServicePeak{Load: 0}
		}
	}
	peakLoad := peak.Load
	utilization := 0.0
	if service.AmpRating > 0 {
		utilization = currentLoad / service.AmpRating * 100
	}
	level := "normal"
	if !complete {
		level = "incomplete"
	} else if utilization >= 90 {
		level = "critical"
	} else if utilization >= 60 {
		level = "warning"
	}
	camSplits := []map[string]any{}
	for _, deviceID := range service.DeviceIDs {
		record := m.records[deviceID]
		if record == nil {
			continue
		}
		if record.Device.DeviceType == "cam_split" {
			camSplits = append(camSplits, m.publicCamSplit(record))
		}
	}
	return map[string]any{
		"id": service.ID, "name": service.Name, "amp_rating": service.AmpRating, "device_ids": service.DeviceIDs,
		"current_load": roundOne(currentLoad), "peak_load": roundOne(peakLoad), "peak_observed_at": nilIfEmpty(peak.ObservedAt),
		"utilization_percent": roundOne(utilization), "level": level, "reporting_devices": reportingDevices,
		"phase_loads":  map[string]float64{"l1_current": roundOne(phaseTotals["l1_current"]), "l2_current": roundOne(phaseTotals["l2_current"]), "l3_current": roundOne(phaseTotals["l3_current"])},
		"device_count": loadDeviceCount, "data_complete": complete, "missing_devices": missing, "cam_splits": camSplits,
	}
}

func (m *Monitor) publicCamSplit(record *Record) map[string]any {
	currents := map[string]any{"l1_current": nil, "l2_current": nil, "l3_current": nil, "neutral_current": nil}
	for _, metric := range record.Metrics {
		if _, tracked := currents[metric.Key]; tracked {
			unit := metric.Unit
			if unit == "" {
				unit = "A"
			}
			currents[metric.Key] = map[string]any{"value": metric.Value, "unit": unit}
		}
	}
	name := record.Device.Name
	if name == "" {
		name = record.Device.Address
	}
	return map[string]any{"id": record.Device.ID, "name": name, "address": record.Device.Address, "status": record.Status, "stale": record.Stale, "currents": currents}
}

func (m *Monitor) observeAlert(conditionID string, active bool, severity, title, message string) *Alert {
	state := m.alertConditions[conditionID]
	if state == nil {
		state = &alertCondition{}
		m.alertConditions[conditionID] = state
	}
	if active {
		state.Count++
		state.ClearCount = 0
		if state.Count >= 3 && !state.Active {
			state.Active = true
			alert := Alert{ID: fmt.Sprintf("%d-%s", time.Now().UnixNano(), conditionID), ConditionID: conditionID, Severity: severity, Title: title, Message: message, OccurredAt: nowString()}
			m.alerts = append([]Alert{alert}, m.alerts...)
			if len(m.alerts) > 100 {
				m.alerts = m.alerts[:100]
			}
			return &alert
		}
	} else {
		state.Count = 0
		state.ClearCount++
		if state.ClearCount >= 2 {
			state.Active = false
		}
	}
	return nil
}

func (m *Monitor) evaluateAlerts(config Config) []Alert {
	created := []Alert{}
	observe := func(conditionID string, active bool, severity, title, message string) {
		if alert := m.observeAlert(conditionID, active, severity, title, message); alert != nil {
			created = append(created, *alert)
		}
	}
	for _, device := range config.Devices {
		record := m.records[device.ID]
		if record == nil {
			continue
		}
		name := device.Name
		if name == "" {
			name = device.Address
		}
		observe("device:"+device.ID+":offline", record.Status == "offline", "critical", name+" offline", "No current readings are available from this device.")
		observe("device:"+device.ID+":imbalance", len(record.PhaseAlerts) > 0, "warning", name+" phase imbalance", strings.ToUpper(strings.Join(record.PhaseAlerts, ", "))+" current is more than 20% above the other phases.")
		values := []float64{}
		for _, demand := range record.MeterDemand {
			values = append(values, demand.Numeric)
		}
		if len(values) == 0 {
			for _, metric := range record.Metrics {
				if metric.Key == "l1_current" || metric.Key == "l2_current" || metric.Key == "l3_current" {
					if value, err := strconv.ParseFloat(strings.ReplaceAll(metric.Value, ",", ""), 64); err == nil {
						values = append(values, value)
					}
				}
			}
		}
		percent := 0.0
		if device.BreakerAmps > 0 {
			for _, value := range values {
				percent = math.Max(percent, value/device.BreakerAmps*100)
			}
		}
		message := fmt.Sprintf("Demand has reached %.0f%% of the %gA breaker rating.", percent, device.BreakerAmps)
		observe("device:"+device.ID+":breaker-critical", percent >= 100, "critical", name+" breaker demand critical", message)
		observe("device:"+device.ID+":breaker-warning", percent >= 80 && percent < 100, "warning", name+" breaker demand warning", message)
	}
	for _, service := range config.Services {
		public := m.publicService(service)
		missing := public["missing_devices"].([]map[string]any)
		incomplete := len(missing) > 0
		percent := public["utilization_percent"].(float64)
		observe("service:"+service.ID+":incomplete", incomplete, "critical", service.Name+" load incomplete", "One or more assigned distros is offline or missing current readings.")
		observe("service:"+service.ID+":critical", !incomplete && percent >= 90, "critical", service.Name+" critical load", fmt.Sprintf("Current load is %.1f%% of service capacity.", percent))
		observe("service:"+service.ID+":warning", !incomplete && percent >= 60 && percent < 90, "warning", service.Name+" load warning", fmt.Sprintf("Current load is %.1f%% of service capacity.", percent))
	}
	return created
}

func (m *Monitor) AcknowledgeAlerts() {
	m.mu.Lock()
	for index := range m.alerts {
		m.alerts[index].Acknowledged = true
	}
	m.mu.Unlock()
}

func (record *Record) updatePeakCurrents(metrics []Metric, checkedAt string) {
	if record.ObservedPeaks == nil {
		record.ObservedPeaks = map[string]PeakCurrent{}
	}
	record.MeterDemand = map[string]PeakCurrent{}
	demandKeys := map[string]string{"l1_demand": "l1_current", "l2_demand": "l2_current", "l3_demand": "l3_current"}
	for _, metric := range metrics {
		currentKey, isDemand := demandKeys[metric.Key]
		if !isDemand {
			continue
		}
		numeric, err := strconv.ParseFloat(strings.ReplaceAll(metric.Value, ",", ""), 64)
		if err != nil {
			continue
		}
		record.MeterDemand[currentKey] = PeakCurrent{Value: metric.Value, Unit: metric.Unit, ObservedAt: checkedAt, Source: "meter", Numeric: numeric}
	}
	sample := map[string]any{"observed_at": checkedAt}
	for _, metric := range metrics {
		if metric.Key != "l1_current" && metric.Key != "l2_current" && metric.Key != "l3_current" {
			continue
		}
		numeric, err := strconv.ParseFloat(strings.ReplaceAll(metric.Value, ",", ""), 64)
		if err != nil {
			continue
		}
		sample[metric.Key] = numeric
		previous, exists := record.ObservedPeaks[metric.Key]
		if !exists || numeric > previous.Numeric {
			record.ObservedPeaks[metric.Key] = PeakCurrent{Value: metric.Value, Unit: metric.Unit, ObservedAt: checkedAt, Source: "observed", Numeric: numeric}
		}
	}
	record.PeakCurrents = map[string]PeakCurrent{}
	for key, value := range record.ObservedPeaks {
		record.PeakCurrents[key] = value
	}
	if len(sample) > 1 {
		record.History = append(record.History, sample)
		if len(record.History) > 4000 {
			record.History = record.History[len(record.History)-4000:]
		}
	}
}

func (m *Monitor) apply(id string, result fetchResult) {
	m.mu.Lock()
	defer m.mu.Unlock()
	record := m.records[id]
	if record == nil {
		return
	}
	record.Status = result.Status
	record.CheckedAt = result.CheckedAt
	record.ResponseMS = result.ResponseMS
	record.HTTPStatus = result.HTTPStatus
	record.Error = result.Error
	if result.Status == "offline" {
		record.Stale = record.Capture != nil
		return
	}
	record.LastSeen = result.LastSeen
	record.ContentType = result.ContentType
	record.ContentBytes = result.ContentBytes
	record.Truncated = result.Truncated
	record.Title = result.Title
	record.Metrics = result.Metrics
	record.PhaseAlerts = result.PhaseAlerts
	record.updatePeakCurrents(result.Metrics, result.CheckedAt)
	record.Fields = result.Fields
	record.Capture = result.Capture
	record.Stale = false
}

func (m *Monitor) UpdateConfig(config Config) error {
	if err := m.store.Save(config); err != nil {
		return err
	}
	m.syncRecords(config)
	m.mu.Lock()
	validServices := map[string]bool{}
	for _, service := range config.Services {
		validServices[service.ID] = true
	}
	for serviceID := range m.servicePeaks {
		if !validServices[serviceID] {
			delete(m.servicePeaks, serviceID)
		}
	}
	m.mu.Unlock()
	m.RequestRefresh()
	return nil
}

func (m *Monitor) publicRecord(record *Record) map[string]any {
	fields := record.Fields
	if len(fields) > 20 {
		fields = fields[:20]
	}
	return map[string]any{
		"id": record.Device.ID, "name": record.Device.Name, "address": record.Device.Address, "breaker_amps": record.Device.BreakerAmps, "device_type": record.Device.DeviceType,
		"scheme": record.Device.Scheme, "port": record.Device.Port, "path": record.Device.Path,
		"url": deviceURL(record.Device), "status": record.Status, "checked_at": nilIfEmpty(record.CheckedAt),
		"last_seen": nilIfEmpty(record.LastSeen), "response_ms": record.ResponseMS, "http_status": nilIfZero(record.HTTPStatus),
		"content_type": record.ContentType, "content_bytes": record.ContentBytes, "truncated": record.Truncated,
		"error": record.Error, "title": record.Title, "metrics": record.Metrics, "phase_alerts": record.PhaseAlerts,
		"peak_currents": record.ObservedPeaks, "observed_peaks": record.ObservedPeaks, "meter_demand": record.MeterDemand,
		"history": record.History, "fields": fields, "stale": record.Stale, "has_capture": record.Capture != nil,
	}
}

func (m *Monitor) Status() map[string]any {
	m.mu.RLock()
	defer m.mu.RUnlock()
	config := m.store.Get()
	devices := make([]map[string]any, 0, len(config.Devices))
	services := make([]map[string]any, 0, len(config.Services))
	counts := map[string]int{"total": len(config.Devices), "online": 0, "warning": 0, "offline": 0, "pending": 0}
	for _, device := range config.Devices {
		if record := m.records[device.ID]; record != nil {
			devices = append(devices, m.publicRecord(record))
			counts[record.Status]++
		}
	}
	for _, service := range config.Services {
		services = append(services, m.publicService(service))
	}
	return map[string]any{"version": version, "generated_at": nowString(), "running": m.running,
		"cycle_started_at": nilIfEmpty(m.cycleStarted), "cycle_finished_at": nilIfEmpty(m.cycleFinished),
		"refresh_seconds": config.Settings.RefreshSeconds, "counts": counts, "services": services, "devices": devices,
		"alerts": m.alerts}
}

func (m *Monitor) Diagnostics(id string) (map[string]any, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	record := m.records[id]
	if record == nil {
		return nil, false
	}
	return map[string]any{"device": m.publicRecord(record), "capture": record.Capture}, true
}

func nilIfEmpty(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func nilIfZero(value int) any {
	if value == 0 {
		return nil
	}
	return value
}

func nowString() string { return time.Now().UTC().Format("2006-01-02T15:04:05.000Z") }

var tagPattern = regexp.MustCompile(`(?s)<[^>]*>`)
var spacePattern = regexp.MustCompile(`\s+`)

func cleanText(source string) string {
	withoutScripts := regexp.MustCompile(`(?is)<(script|style|noscript)[^>]*>.*?</(script|style|noscript)>`).ReplaceAllString(source, " ")
	text := tagPattern.ReplaceAllString(withoutScripts, " ")
	return strings.TrimSpace(spacePattern.ReplaceAllString(html.UnescapeString(text), " "))
}

func pageTitle(source string) string {
	match := regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`).FindStringSubmatch(source)
	if len(match) < 2 {
		return ""
	}
	title := strings.TrimSpace(spacePattern.ReplaceAllString(html.UnescapeString(tagPattern.ReplaceAllString(match[1], " ")), " "))
	if len(title) > 200 {
		title = title[:200]
	}
	return title
}

type metricPattern struct{ key, label, labelRE, units string }

var genericMetricPatterns = []metricPattern{
	{"l1_current", "L1 current", `L1\s*(?:amps?|current)`, `A|amps?|amperes?`},
	{"l2_current", "L2 current", `L2\s*(?:amps?|current)`, `A|amps?|amperes?`},
	{"l3_current", "L3 current", `L3\s*(?:amps?|current)`, `A|amps?|amperes?`},
	{"neutral_current", "Neutral current", `(?:N|neutral)\s*(?:amps?|current)`, `A|amps?|amperes?`},
	{"l1_voltage", "L1 voltage", `L1\s*(?:volt(?:age)?)`, `V|volts?`},
	{"l2_voltage", "L2 voltage", `L2\s*(?:volt(?:age)?)`, `V|volts?`},
	{"l3_voltage", "L3 voltage", `L3\s*(?:volt(?:age)?)`, `V|volts?`},
	{"l12_voltage", "L12 voltage", `L12\s*(?:volt(?:age)?)`, `V|volts?`},
	{"l23_voltage", "L23 voltage", `L23\s*(?:volt(?:age)?)`, `V|volts?`},
	{"l31_voltage", "L31 voltage", `L31\s*(?:volt(?:age)?)`, `V|volts?`},
	{"frequency", "Frequency", `frequency|hertz`, `Hz|hertz`},
	{"power_factor", "Power factor", `power\s*factor|pf`, `%`},
	{"power", "Power", `(?:active\s*)?power|watts?`, `k?W|VA|kVA|watts?`},
}

func genericMetrics(text string) []Metric {
	metrics := []Metric{}
	for _, item := range genericMetricPatterns {
		pattern := regexp.MustCompile(`(?i)\b(?:` + item.labelRE + `)\b\s*(?::|=|is)?\s*([-+]?\d[\d,]*(?:\.\d+)?)\s*(` + item.units + `)?`)
		match := pattern.FindStringSubmatch(text)
		if len(match) > 1 {
			unit := ""
			if len(match) > 2 {
				unit = strings.TrimSpace(match[2])
			}
			metrics = append(metrics, Metric{Key: item.key, Label: item.label, Value: strings.ReplaceAll(match[1], ",", ""), Unit: unit})
		}
	}
	return metrics
}

func phaseAlerts(metrics []Metric) []string {
	values := map[string]float64{}
	for _, metric := range metrics {
		for _, phase := range []string{"l1", "l2", "l3"} {
			if metric.Key == phase+"_current" {
				if value, err := strconv.ParseFloat(strings.ReplaceAll(metric.Value, ",", ""), 64); err == nil {
					values[phase] = value
				}
			}
		}
	}
	if len(values) != 3 {
		return []string{}
	}
	alerts := []string{}
	for _, phase := range []string{"l1", "l2", "l3"} {
		others := 0.0
		for _, other := range []string{"l1", "l2", "l3"} {
			if other != phase {
				others += values[other]
			}
		}
		average := others / 2
		if average > 0 && values[phase] > average*1.20 {
			alerts = append(alerts, phase)
		}
	}
	return alerts
}

var liveDefinitions = []struct {
	index            int
	key, label, unit string
}{
	{0, "l1_voltage", "L1 voltage", "V"}, {1, "l2_voltage", "L2 voltage", "V"}, {2, "l3_voltage", "L3 voltage", "V"},
	{3, "l12_voltage", "L12 voltage", "V"}, {4, "l23_voltage", "L23 voltage", "V"}, {5, "l31_voltage", "L31 voltage", "V"},
	{6, "l1_current", "L1 current", "A"}, {7, "l2_current", "L2 current", "A"}, {8, "l3_current", "L3 current", "A"},
	{9, "neutral_current", "Neutral current", "A"}, {10, "frequency", "Frequency", "Hz"},
	{14, "power", "Total power", "kW"}, {15, "reactive_power", "Total reactive power", "kVAr"},
	{16, "apparent_power", "Total apparent power", "kVA"}, {17, "power_factor", "Power factor", ""},
	{18, "l1_demand", "Demand I1", "A"}, {19, "l2_demand", "Demand I2", "A"}, {20, "l3_demand", "Demand I3", "A"},
}

func fetchLive(client *http.Client, source, pageAddress string, limit int) ([]Metric, []Field, map[string]any, error) {
	if !strings.Contains(source, "scadaArray") || !strings.Contains(source, "ml1b") {
		return nil, nil, nil, errors.New("no live feed")
	}
	match := regexp.MustCompile(`(?i)\.open\(\s*['"]GET['"]\s*,\s*['"]([^'"]+\.xml(?:\?[^'"]*)?)['"]`).FindStringSubmatch(source)
	if len(match) < 2 {
		return nil, nil, nil, errors.New("live feed address not found")
	}
	pageURL, err := url.Parse(pageAddress)
	if err != nil {
		return nil, nil, nil, err
	}
	feedURL, err := pageURL.Parse(match[1])
	if err != nil || feedURL.Scheme != pageURL.Scheme || feedURL.Host != pageURL.Host {
		return nil, nil, nil, errors.New("invalid live feed address")
	}
	req, _ := http.NewRequest(http.MethodGet, feedURL.String(), nil)
	req.Header.Set("User-Agent", "StreamlinePowerMonitor/"+version)
	response, err := client.Do(req)
	if err != nil {
		return nil, nil, nil, err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, int64(min(limit, 128*1024))))
	if err != nil {
		return nil, nil, nil, err
	}
	decoder := xml.NewDecoder(bytes.NewReader(body))
	values := []string{}
	for {
		token, err := decoder.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, nil, nil, err
		}
		if start, ok := token.(xml.StartElement); ok && start.Name.Local == "s" {
			value := ""
			for _, attribute := range start.Attr {
				if attribute.Name.Local == "v" {
					value = strings.TrimSpace(attribute.Value)
				}
			}
			values = append(values, value)
		}
	}
	if len(values) < 18 {
		return nil, nil, nil, errors.New("live feed is incomplete")
	}
	metrics, fields := []Metric{}, []Field{}
	for _, item := range liveDefinitions {
		if item.index < len(values) && values[item.index] != "" {
			metrics = append(metrics, Metric{Key: item.key, Label: item.label, Value: values[item.index], Unit: item.unit})
			fields = append(fields, Field{Label: item.label, Value: strings.TrimSpace(values[item.index] + " " + item.unit), Source: "live-feed"})
		}
	}
	return metrics, fields, map[string]any{"url": feedURL.String(), "raw_xml": string(body), "values": values, "metrics": metrics, "fields": fields}, nil
}

func fetchDevice(device Device, settings Settings) fetchResult {
	started := time.Now()
	checked := nowString()
	result := fetchResult{Status: "offline", CheckedAt: checked, Metrics: []Metric{}, PhaseAlerts: []string{}, Fields: []Field{}}
	client := &http.Client{Timeout: time.Duration(settings.TimeoutSeconds * float64(time.Second))}
	address := deviceURL(device)
	req, err := http.NewRequest(http.MethodGet, address, nil)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	req.Header.Set("User-Agent", "StreamlinePowerMonitor/"+version)
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5")
	response, err := client.Do(req)
	if err != nil {
		result.ResponseMS = time.Since(started).Milliseconds()
		if os.IsTimeout(err) || strings.Contains(strings.ToLower(err.Error()), "timeout") {
			result.Error = "Request timed out."
		} else {
			result.Error = err.Error()
		}
		return result
	}
	defer response.Body.Close()
	limit := settings.MaxResponseKB * 1024
	body, err := io.ReadAll(io.LimitReader(response.Body, int64(limit+1)))
	if err != nil {
		result.Error = err.Error()
		return result
	}
	truncated := len(body) > limit
	if truncated {
		body = body[:limit]
	}
	source := string(body)
	title := pageTitle(source)
	text := cleanText(source)
	metrics := genericMetrics(text)
	fields := []Field{}
	var liveFeed map[string]any
	if liveMetrics, liveFields, live, liveErr := fetchLive(client, source, address, limit); liveErr == nil {
		metrics, fields, liveFeed = liveMetrics, liveFields, live
	}
	status := "online"
	errorMessage := ""
	if response.StatusCode < 200 || response.StatusCode >= 400 {
		status, errorMessage = "warning", fmt.Sprintf("Device returned HTTP %d.", response.StatusCode)
	}
	headers := map[string]string{}
	for key, values := range response.Header {
		headers[key] = strings.Join(values, ", ")
	}
	alerts := phaseAlerts(metrics)
	capture := &Capture{Title: title, Metrics: metrics, PhaseAlerts: alerts, Fields: fields, Tables: [][][]string{}, Forms: []map[string]any{},
		Meta: []map[string]string{}, ScriptVals: []Field{}, Text: text, RawHTML: source, Headers: headers,
		FetchedAt: checked, Truncated: truncated, URL: address, LiveFeed: liveFeed}
	result.Status, result.LastSeen, result.ResponseMS = status, checked, time.Since(started).Milliseconds()
	result.HTTPStatus, result.ContentType, result.ContentBytes = response.StatusCode, response.Header.Get("Content-Type"), len(body)
	result.Truncated, result.Error, result.Title = truncated, errorMessage, title
	result.Metrics, result.PhaseAlerts, result.Fields, result.Capture = metrics, alerts, fields, capture
	return result
}

type App struct {
	monitor    *Monitor
	store      *Store
	updater    *UpdateManager
	controller *ServerController
}

type ServerController struct {
	mu      sync.RWMutex
	host    string
	port    int
	handler http.Handler
	server  *http.Server
	running bool
}

func newServerController(host string, port int, handler http.Handler) *ServerController {
	return &ServerController{host: host, port: port, handler: handler}
}

func (controller *ServerController) Start() error {
	controller.mu.Lock()
	defer controller.mu.Unlock()
	if controller.running {
		return nil
	}
	listener, err := net.Listen("tcp", net.JoinHostPort(controller.host, strconv.Itoa(controller.port)))
	if err != nil {
		return err
	}
	server := &http.Server{Handler: controller.handler, ReadHeaderTimeout: 5 * time.Second}
	controller.server = server
	controller.running = true
	go func() {
		err := server.Serve(listener)
		controller.mu.Lock()
		if controller.server == server {
			controller.running = false
			controller.server = nil
		}
		controller.mu.Unlock()
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("Server stopped: %v", err)
		}
	}()
	return nil
}

func (controller *ServerController) Stop() error {
	controller.mu.Lock()
	server := controller.server
	controller.server = nil
	controller.running = false
	controller.mu.Unlock()
	if server == nil {
		return nil
	}
	return server.Close()
}

func (controller *ServerController) Restart() error {
	if err := controller.Stop(); err != nil {
		return err
	}
	time.Sleep(150 * time.Millisecond)
	return controller.Start()
}

func (controller *ServerController) IsRunning() bool {
	controller.mu.RLock()
	defer controller.mu.RUnlock()
	return controller.running
}

func (controller *ServerController) LocalURL() string {
	return fmt.Sprintf("http://127.0.0.1:%d/", controller.port)
}

func (controller *ServerController) NetworkURLs() []string {
	publicPort := controller.port
	if port, err := strconv.Atoi(os.Getenv("TECH_HUB_PUBLIC_PORT")); err == nil {
		publicPort = port
	}
	addresses := []string{}
	interfaces, err := net.Interfaces()
	if err != nil {
		return addresses
	}
	for _, networkInterface := range interfaces {
		if networkInterface.Flags&net.FlagUp == 0 || networkInterface.Flags&net.FlagLoopback != 0 {
			continue
		}
		interfaceAddresses, err := networkInterface.Addrs()
		if err != nil {
			continue
		}
		for _, interfaceAddress := range interfaceAddresses {
			ip, _, err := net.ParseCIDR(interfaceAddress.String())
			if err == nil && ip.To4() != nil && !ip.IsLoopback() {
				addresses = append(addresses, fmt.Sprintf("http://%s:%d/", ip.String(), publicPort))
			}
		}
	}
	return addresses
}

func normalizeDiscoveryNetwork(value string) (*net.IPNet, error) {
	raw := strings.TrimSpace(value)
	if regexp.MustCompile(`^\d{1,3}(?:\.\d{1,3}){2}$`).MatchString(raw) {
		raw += ".0/23"
	} else if !strings.Contains(raw, "/") {
		raw += "/23"
	}
	_, network, err := net.ParseCIDR(raw)
	if err != nil {
		return nil, errors.New("Discovery range must look like 10.1.0.0/23, 10.1.1.218, or 10.1.1.")
	}
	ones, bits := network.Mask.Size()
	if bits != 32 || ones != 23 {
		return nil, errors.New("Discovery is limited to a private IPv4 /23 network.")
	}
	if !network.IP.IsPrivate() && !network.IP.IsLinkLocalUnicast() {
		return nil, errors.New("Discovery is limited to private local networks.")
	}
	return network, nil
}

func discoveryNetworks(config Config, requested string) ([]*net.IPNet, error) {
	if strings.TrimSpace(requested) != "" {
		network, err := normalizeDiscoveryNetwork(requested)
		if err != nil {
			return nil, err
		}
		return []*net.IPNet{network}, nil
	}
	found := map[string]*net.IPNet{}
	addAddress := func(address string) {
		ip := net.ParseIP(strings.Trim(address, "[]"))
		if ip == nil || ip.To4() == nil || (!ip.IsPrivate() && !ip.IsLinkLocalUnicast()) {
			return
		}
		network, _ := normalizeDiscoveryNetwork(ip.String())
		found[network.String()] = network
	}
	for _, device := range config.Devices {
		addAddress(device.Address)
	}
	if interfaces, err := net.Interfaces(); err == nil {
		for _, networkInterface := range interfaces {
			if networkInterface.Flags&net.FlagUp == 0 || networkInterface.Flags&net.FlagLoopback != 0 {
				continue
			}
			addresses, _ := networkInterface.Addrs()
			for _, address := range addresses {
				ip, _, err := net.ParseCIDR(address.String())
				if err == nil {
					addAddress(ip.String())
				}
			}
		}
	}
	keys := make([]string, 0, len(found))
	for key := range found {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	if len(keys) > 1 {
		keys = keys[:1]
	}
	networks := make([]*net.IPNet, 0, len(keys))
	for _, key := range keys {
		networks = append(networks, found[key])
	}
	if len(networks) == 0 {
		return nil, errors.New("No private IPv4 network was found. Enter a range such as 10.1.0.0/23.")
	}
	return networks, nil
}

func discoveryAddresses(network *net.IPNet) []string {
	base := binary.BigEndian.Uint32(network.IP.To4())
	addresses := make([]string, 0, 510)
	for offset := uint32(1); offset <= 510; offset++ {
		ip := make(net.IP, 4)
		binary.BigEndian.PutUint32(ip, base+offset)
		addresses = append(addresses, ip.String())
	}
	return addresses
}

func discoveryHTTPGet(ctx context.Context, address, path string, timeout time.Duration, maxBody int64) (int, map[string]string, []byte, error) {
	dialer := net.Dialer{Timeout: timeout}
	connection, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(address, "80"))
	if err != nil {
		return 0, nil, nil, err
	}
	defer connection.Close()
	_ = connection.SetDeadline(time.Now().Add(timeout))
	requestText := "GET " + path + " HTTP/1.0\r\nHost: " + address + "\r\nUser-Agent: PowerMonitor/" + version + "\r\nConnection: close\r\n\r\n"
	if _, err := io.WriteString(connection, requestText); err != nil {
		return 0, nil, nil, err
	}
	request, _ := http.NewRequest(http.MethodGet, "http://"+address+path, nil)
	response, err := http.ReadResponse(bufio.NewReaderSize(connection, 16*1024), request)
	if err != nil {
		return 0, nil, nil, err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, maxBody+1))
	if err != nil {
		return 0, nil, nil, err
	}
	if int64(len(body)) > maxBody {
		return 0, nil, nil, errors.New("discovery response was too large")
	}
	headers := map[string]string{}
	for name, values := range response.Header {
		headers[strings.ToLower(name)] = strings.Join(values, ", ")
	}
	return response.StatusCode, headers, body, nil
}

func validateSCADAXML(body []byte) (bool, int) {
	lowered := bytes.ToLower(body)
	if bytes.Contains(lowered, []byte("<!doctype")) || bytes.Contains(lowered, []byte("<!entity")) {
		return false, 0
	}
	decoder := xml.NewDecoder(bytes.NewReader(body))
	root := ""
	valueCount := 0
	for {
		token, err := decoder.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return false, 0
		}
		start, ok := token.(xml.StartElement)
		if !ok {
			continue
		}
		if root == "" {
			root = strings.ToLower(start.Name.Local)
		}
		if strings.EqualFold(start.Name.Local, "s") {
			for _, attribute := range start.Attr {
				if strings.EqualFold(attribute.Name.Local, "v") {
					valueCount++
					break
				}
			}
		}
	}
	return root == "m" && valueCount >= 10, valueCount
}

func discoveryFingerprint(homeStatus int, homeHeaders map[string]string, homeBody []byte, xmlStatus int, xmlBody []byte, modbusOpen bool) map[string]any {
	source := string(homeBody)
	title := ""
	if match := regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`).FindStringSubmatch(source); len(match) > 1 {
		title = strings.TrimSpace(spacePattern.ReplaceAllString(html.UnescapeString(match[1]), " "))
	}
	if homeStatus != http.StatusOK || !strings.Contains(strings.ToLower(title), "dkm411 web scada") {
		return nil
	}
	xmlValid, valueCount := false, 0
	if xmlStatus == http.StatusOK {
		xmlValid, valueCount = validateSCADAXML(xmlBody)
	}
	confidence := "probable"
	if xmlValid {
		confidence = "confirmed"
	}
	return map[string]any{
		"title": title, "manufacturer": "Datakom", "model": "DKM-411", "confidence": confidence,
		"evidence": map[string]any{"http_title": title, "http_server": homeHeaders["server"], "scada_xml_validated": xmlValid, "scada_value_count": valueCount, "modbus_tcp_open": modbusOpen},
	}
}

func discoveryPortOpen(ctx context.Context, address string) bool {
	dialer := net.Dialer{Timeout: 300 * time.Millisecond}
	connection, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(address, "502"))
	if err != nil {
		return false
	}
	connection.Close()
	return true
}

func discoveryNeighborMAC(ctx context.Context, address string) string {
	commandContext, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	output, err := exec.CommandContext(commandContext, "arp", "-a", address).Output()
	if err != nil {
		return ""
	}
	match := regexp.MustCompile(`(?i)\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b`).Find(output)
	return strings.ToUpper(strings.ReplaceAll(string(match), "-", ":"))
}

func probeDiscoveryAddress(ctx context.Context, address string) map[string]any {
	homeStatus := 0
	homeHeaders := map[string]string{}
	homeBody := []byte{}
	retried := false
	for attempt, timeout := range []time.Duration{450 * time.Millisecond, 1250 * time.Millisecond} {
		status, headers, body, err := discoveryHTTPGet(ctx, address, "/", timeout, 32*1024)
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			continue
		}
		homeStatus, homeHeaders, homeBody = status, headers, body
		retried = attempt > 0
		break
	}
	preliminary := discoveryFingerprint(homeStatus, homeHeaders, homeBody, 0, nil, false)
	if preliminary == nil {
		return nil
	}
	xmlStatus, _, xmlBody, _ := discoveryHTTPGet(ctx, address, "/scd.xml", 2*time.Second, 64*1024)
	result := discoveryFingerprint(homeStatus, homeHeaders, homeBody, xmlStatus, xmlBody, discoveryPortOpen(ctx, address))
	serial := ""
	if match := regexp.MustCompile(`(?i)(?:serial(?:\s+(?:number|no\.?))?|s/n)\s*[:=#"'<>\s-]{1,24}([A-Z0-9._:-]{4,48})`).FindStringSubmatch(string(homeBody)); len(match) > 1 {
		serial = match[1]
	}
	result["address"], result["serial"], result["mac"], result["retried"] = address, serial, discoveryNeighborMAC(ctx, address), retried
	return result
}

func discoverDevices(ctx context.Context, config Config, requested string) (map[string]any, error) {
	networks, err := discoveryNetworks(config, requested)
	if err != nil {
		return nil, err
	}
	addresses := []string{}
	networkNames := make([]string, 0, len(networks))
	for _, network := range networks {
		networkNames = append(networkNames, network.String())
		addresses = append(addresses, discoveryAddresses(network)...)
	}
	configured := map[string]bool{}
	for _, device := range config.Devices {
		configured[device.Address] = true
	}
	jobs := make(chan string)
	results := make(chan map[string]any)
	var workers sync.WaitGroup
	workerCount := 32
	if len(addresses) < workerCount {
		workerCount = len(addresses)
	}
	for index := 0; index < workerCount; index++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for {
				var address string
				var ok bool
				select {
				case <-ctx.Done():
					return
				case address, ok = <-jobs:
					if !ok {
						return
					}
				}
				if result := probeDiscoveryAddress(ctx, address); result != nil {
					result["already_configured"] = configured[address]
					select {
					case results <- result:
					case <-ctx.Done():
						return
					}
				}
			}
		}()
	}
	go func() {
		for _, address := range addresses {
			select {
			case jobs <- address:
			case <-ctx.Done():
				close(jobs)
				workers.Wait()
				close(results)
				return
			}
		}
		close(jobs)
		workers.Wait()
		close(results)
	}()
	found := []map[string]any{}
	for result := range results {
		found = append(found, result)
	}
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	sort.Slice(found, func(left, right int) bool {
		return binary.BigEndian.Uint32(net.ParseIP(found[left]["address"].(string)).To4()) < binary.BigEndian.Uint32(net.ParseIP(found[right]["address"].(string)).To4())
	})
	return map[string]any{"networks": networkNames, "devices": found}, nil
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	writer.Header().Set("Cache-Control", "no-store")
	writer.Header().Set("X-Content-Type-Options", "nosniff")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}

func (app *App) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	path := request.URL.Path
	if request.Method == http.MethodGet && (path == "/" || path == "/index.html" || path == "/styles.css" || path == "/app.js" || path == "/streamline-logo.svg") {
		filename := strings.TrimPrefix(path, "/")
		if filename == "" {
			filename = "index.html"
		}
		data, err := bundledFiles.ReadFile("web/" + filename)
		if err != nil {
			writeJSON(writer, 500, map[string]any{"ok": false, "error": "Web interface files are missing."})
			return
		}
		contentType := mime.TypeByExtension(filepath.Ext(filename))
		if filename == "app.js" {
			contentType = "text/javascript; charset=utf-8"
		}
		if contentType == "" {
			contentType = "application/octet-stream"
		}
		writer.Header().Set("Content-Type", contentType)
		writer.Header().Set("Cache-Control", "no-cache")
		writer.Header().Set("X-Content-Type-Options", "nosniff")
		writer.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'")
		_, _ = writer.Write(data)
		return
	}
	if request.Method == http.MethodGet && path == "/api/health" {
		writeJSON(writer, 200, map[string]any{"ok": true, "name": appName, "version": version})
		return
	}
	if request.Method == http.MethodGet && path == "/api/config" {
		writeJSON(writer, 200, app.store.Get())
		return
	}
	if request.Method == http.MethodPut && path == "/api/config" {
		var config Config
		decoder := json.NewDecoder(io.LimitReader(request.Body, 2_000_000))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&config); err != nil {
			writeJSON(writer, 400, map[string]any{"ok": false, "error": "Settings are not valid."})
			return
		}
		if err := app.monitor.UpdateConfig(config); err != nil {
			writeJSON(writer, 400, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		writeJSON(writer, 200, map[string]any{"ok": true, "config": app.store.Get()})
		return
	}
	if request.Method == http.MethodGet && path == "/api/status" {
		writeJSON(writer, 200, app.monitor.Status())
		return
	}
	if request.Method == http.MethodGet && path == "/api/update" {
		writeJSON(writer, 200, app.updater.Status())
		return
	}
	if request.Method == http.MethodPost && path == "/api/update/check" {
		status, err := app.updater.Check(request.Context(), true)
		if err != nil {
			writeJSON(writer, 502, map[string]any{"ok": false, "error": err.Error(), "status": status})
			return
		}
		writeJSON(writer, 200, map[string]any{"ok": true, "status": status})
		return
	}
	if request.Method == http.MethodPost && path == "/api/update/install" {
		if runtime.GOOS != "windows" {
			writeJSON(writer, 400, map[string]any{"ok": false, "error": "Automatic installation is available in the Windows app."})
			return
		}
		path, err := app.updater.Download(request.Context())
		if err != nil {
			writeJSON(writer, 502, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		writeJSON(writer, 202, map[string]any{"ok": true, "message": "The verified update is ready. Power Monitor will restart."})
		time.AfterFunc(500*time.Millisecond, func() {
			if err := installDownloadedUpdate(path, app.controller, app.monitor); err != nil {
				_ = os.Remove(path)
				app.updater.setInstallError(err)
			}
		})
		return
	}
	if request.Method == http.MethodPost && path == "/api/discover" {
		var discoveryRequest struct {
			Subnet string `json:"subnet"`
		}
		decoder := json.NewDecoder(io.LimitReader(request.Body, 64*1024))
		if err := decoder.Decode(&discoveryRequest); err != nil {
			writeJSON(writer, 400, map[string]any{"ok": false, "error": "Discovery request is not valid."})
			return
		}
		result, err := discoverDevices(request.Context(), app.store.Get(), discoveryRequest.Subnet)
		if err != nil {
			if errors.Is(err, context.Canceled) {
				return
			}
			writeJSON(writer, 400, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		result["ok"] = true
		writeJSON(writer, 200, result)
		return
	}
	if request.Method == http.MethodPost && path == "/api/refresh" {
		app.monitor.RequestRefresh()
		writeJSON(writer, 202, map[string]any{"ok": true})
		return
	}
	if request.Method == http.MethodPost && path == "/api/alerts/acknowledge" {
		app.monitor.AcknowledgeAlerts()
		writeJSON(writer, 200, map[string]any{"ok": true})
		return
	}
	if request.Method == http.MethodGet && strings.HasPrefix(path, "/api/devices/") && strings.HasSuffix(path, "/diagnostics") {
		id := strings.TrimSuffix(strings.TrimPrefix(path, "/api/devices/"), "/diagnostics")
		if diagnostics, ok := app.monitor.Diagnostics(id); ok {
			writeJSON(writer, 200, diagnostics)
		} else {
			writeJSON(writer, 404, map[string]any{"ok": false, "error": "Device not found."})
		}
		return
	}
	writeJSON(writer, 404, map[string]any{"ok": false, "error": "Not found."})
}

func openBrowser(address string) {
	var command *exec.Cmd
	if runtime.GOOS == "windows" {
		command = exec.Command("rundll32", "url.dll,FileProtocolHandler", address)
	} else if runtime.GOOS == "darwin" {
		command = exec.Command("open", address)
	} else {
		command = exec.Command("xdg-open", address)
	}
	_ = command.Start()
}

func main() {
	host := flag.String("host", "0.0.0.0", "network bind address")
	port := flag.Int("port", 8765, "dashboard port")
	configFlag := flag.String("config", "", "settings file location")
	noBrowser := flag.Bool("no-browser", false, "do not open the dashboard automatically")
	updateTarget := flag.String("apply-update", "", "replace an older executable and restart")
	temporaryUpdate := flag.Bool("temporary-update", false, "remove a downloaded updater after installation")
	cleanupUpdate := flag.String("cleanup-update", "", "remove a completed temporary updater")
	flag.Parse()
	if *updateTarget != "" {
		if err := applyUpdateExecutable(*updateTarget, *temporaryUpdate); err != nil {
			showUpdateFailure(err)
			os.Exit(1)
		}
		return
	}
	if *cleanupUpdate != "" {
		go removeCompletedUpdater(*cleanupUpdate)
	}
	executable, _ := os.Executable()
	configPath := *configFlag
	if configPath == "" {
		configPath = filepath.Join(filepath.Dir(executable), "settings.json")
	}
	store, err := loadStore(configPath)
	if err != nil {
		log.Fatalf("Unable to start %s: %v", appName, err)
	}
	monitor := newMonitor(store)
	monitor.Start()
	updater := newUpdateManager()
	if os.Getenv("TECH_HUB_MANAGED") != "1" {
		updater.Start()
	}
	defer updater.Stop()
	app := &App{monitor: monitor, store: store, updater: updater}
	controller := newServerController(*host, *port, app)
	app.controller = controller
	startErr := controller.Start()
	if !*noBrowser && startErr == nil {
		time.AfterFunc(400*time.Millisecond, func() { openBrowser(controller.LocalURL()) })
	}
	if runtime.GOOS == "windows" {
		if err := runTray(controller, monitor, updater, startErr); err != nil {
			log.Printf("Tray error: %v", err)
		}
		return
	}
	if startErr != nil {
		log.Fatalf("Unable to start %s: %v", appName, startErr)
	}
	fmt.Printf("%s %s is running at %s\n", appName, version, controller.LocalURL())
	for _, address := range controller.NetworkURLs() {
		fmt.Printf("Network access: %s\n", address)
	}
	fmt.Println("Press Ctrl+C to stop the monitor.")
	interrupt := make(chan os.Signal, 1)
	signal.Notify(interrupt, os.Interrupt)
	<-interrupt
	_ = controller.Stop()
	monitor.Stop()
}
