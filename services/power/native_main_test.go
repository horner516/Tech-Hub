package main

import (
	"net/http"
	"strings"
	"testing"
)

func TestPhaseAlerts(t *testing.T) {
	metrics := []Metric{
		{Key: "l1_current", Value: "121"},
		{Key: "l2_current", Value: "100"},
		{Key: "l3_current", Value: "100"},
	}
	alerts := phaseAlerts(metrics)
	if len(alerts) != 1 || alerts[0] != "l1" {
		t.Fatalf("expected L1 alert, got %#v", alerts)
	}
	metrics[0].Value = "120"
	if alerts := phaseAlerts(metrics); len(alerts) != 0 {
		t.Fatalf("20 percent exactly must not alert, got %#v", alerts)
	}
}

func TestPeakCurrentsKeepHighestReading(t *testing.T) {
	record := &Record{PeakCurrents: map[string]PeakCurrent{}}
	record.updatePeakCurrents([]Metric{{Key: "l1_current", Value: "40.5", Unit: "A"}}, "first")
	record.updatePeakCurrents([]Metric{{Key: "l1_current", Value: "39.0", Unit: "A"}}, "second")
	if peak := record.PeakCurrents["l1_current"]; peak.Value != "40.5" || peak.ObservedAt != "first" {
		t.Fatalf("lower reading replaced peak: %#v", peak)
	}
	record.updatePeakCurrents([]Metric{{Key: "l1_current", Value: "42.1", Unit: "A"}}, "third")
	if peak := record.PeakCurrents["l1_current"]; peak.Value != "42.1" || peak.ObservedAt != "third" {
		t.Fatalf("higher reading did not replace peak: %#v", peak)
	}
	if peak := record.PeakCurrents["l1_current"]; peak.Source != "observed" {
		t.Fatalf("expected observed-current fallback source, got %#v", peak)
	}
}

func TestMeterDemandOverridesObservedPeak(t *testing.T) {
	record := &Record{PeakCurrents: map[string]PeakCurrent{}, MeterDemand: map[string]PeakCurrent{}, ObservedPeaks: map[string]PeakCurrent{}}
	record.updatePeakCurrents([]Metric{
		{Key: "l1_current", Value: "57.6", Unit: "A"},
		{Key: "l1_demand", Value: "77.6", Unit: "A"},
		{Key: "l2_demand", Value: "71.2", Unit: "A"},
		{Key: "l3_demand", Value: "74.5", Unit: "A"},
	}, "meter-time")
	demand := record.MeterDemand["l1_current"]
	if demand.Value != "77.6" || demand.Source != "meter" || demand.ObservedAt != "meter-time" {
		t.Fatalf("expected meter-reported demand, got %#v", demand)
	}
	peak := record.ObservedPeaks["l1_current"]
	if peak.Value != "57.6" || peak.Source != "observed" {
		t.Fatalf("expected separate observed peak, got %#v", peak)
	}
	if len(record.History) != 1 {
		t.Fatalf("expected one trend sample, got %#v", record.History)
	}
}

func TestServiceLoadAggregatesEachPhaseAndUsesHighestTotal(t *testing.T) {
	monitor := &Monitor{
		records: map[string]*Record{
			"device01": {Status: "online", Metrics: []Metric{{Key: "l1_current", Value: "35"}, {Key: "l2_current", Value: "20"}, {Key: "l3_current", Value: "10"}}, PeakCurrents: map[string]PeakCurrent{"l1_current": {Numeric: 50}, "l2_current": {Numeric: 40}, "l3_current": {Numeric: 20}}},
			"device02": {Status: "online", Metrics: []Metric{{Key: "l1_current", Value: "30"}, {Key: "l2_current", Value: "50"}, {Key: "l3_current", Value: "20"}}, PeakCurrents: map[string]PeakCurrent{"l1_current": {Numeric: 30}, "l2_current": {Numeric: 50}, "l3_current": {Numeric: 40}}},
		},
		servicePeaks: map[string]ServicePeak{"service01": {Load: 82.4, ObservedAt: "peak-time"}},
	}
	service := Service{ID: "service01", Name: "Main service", AmpRating: 100, DeviceIDs: []string{"device01", "device02"}}
	public := monitor.publicService(service)
	if public["current_load"] != 70.0 {
		t.Fatalf("expected highest combined phase load of 70A, got %#v", public["current_load"])
	}
	if public["peak_load"] != 82.4 || public["level"] != "warning" {
		t.Fatalf("expected stored peak and warning level, got %#v", public)
	}
	service.AmpRating = 70
	if critical := monitor.publicService(service); critical["level"] != "critical" {
		t.Fatalf("expected load over 90 percent to be critical, got %#v", critical["level"])
	}
	monitor.records["device02"].Status = "offline"
	if incomplete := monitor.publicService(service); incomplete["level"] != "incomplete" || incomplete["data_complete"] != false {
		t.Fatalf("expected incomplete service state, got %#v", incomplete)
	}
}

func TestAlertsRequireThreeConsecutiveReadings(t *testing.T) {
	monitor := &Monitor{records: map[string]*Record{"device01": {Device: Device{ID: "device01", Address: "10.0.0.4", DeviceType: "distro"}, Status: "offline"}}, alertConditions: map[string]*alertCondition{}, alerts: []Alert{}, servicePeaks: map[string]ServicePeak{}}
	config := Config{Devices: []Device{{ID: "device01", Address: "10.0.0.4", DeviceType: "distro"}}}
	monitor.evaluateAlerts(config)
	monitor.evaluateAlerts(config)
	if len(monitor.alerts) != 0 {
		t.Fatalf("alert fired before third reading: %#v", monitor.alerts)
	}
	monitor.evaluateAlerts(config)
	if len(monitor.alerts) != 1 || !strings.Contains(monitor.alerts[0].Title, "offline") {
		t.Fatalf("expected offline alert after third reading: %#v", monitor.alerts)
	}
}

func TestDiscoveryNormalizesToPrivate23(t *testing.T) {
	network, err := normalizeDiscoveryNetwork("10.1.1.218")
	if err != nil || network.String() != "10.1.0.0/23" {
		t.Fatalf("expected 10.1.0.0/23, got %v (%v)", network, err)
	}
	if _, err := normalizeDiscoveryNetwork("10.1.1.0/24"); err == nil {
		t.Fatal("expected /24 discovery range to be rejected")
	}
	if addresses := discoveryAddresses(network); len(addresses) != 510 || addresses[0] != "10.1.0.1" || addresses[509] != "10.1.1.254" {
		t.Fatalf("unexpected /23 host list: %d %#v %#v", len(addresses), addresses[0], addresses[len(addresses)-1])
	}
}

func TestDiscoveryFingerprintRequiresDKMTitleAndValidatesLiveXML(t *testing.T) {
	home := []byte(`<html><head><title>DKM411 Web Scada SW:1.0</title></head><body>WEB Scada</body></html>`)
	xmlBody := []byte(`<m><s v="1"/><s v="2"/><s v="3"/><s v="4"/><s v="5"/><s v="6"/><s v="7"/><s v="8"/><s v="9"/><s v="10"/></m>`)
	result := discoveryFingerprint(200, map[string]string{"server": "uIP/1.0"}, home, 200, xmlBody, true)
	if result == nil || result["confidence"] != "confirmed" {
		t.Fatalf("expected confirmed DKM-411, got %#v", result)
	}
	evidence := result["evidence"].(map[string]any)
	if evidence["scada_xml_validated"] != true || evidence["scada_value_count"] != 10 {
		t.Fatalf("expected validated live feed, got %#v", evidence)
	}
	probable := discoveryFingerprint(200, map[string]string{"server": "uIP/1.0"}, home, 503, nil, true)
	if probable == nil || probable["confidence"] != "probable" {
		t.Fatalf("expected title-only probable result, got %#v", probable)
	}
	generic := []byte(`<html><head><title>Power Monitor</title></head><body>scadaArray scd.xml ml1b</body></html>`)
	if result := discoveryFingerprint(200, map[string]string{"server": "uIP/1.0"}, generic, 200, xmlBody, true); result != nil {
		t.Fatalf("generic uIP page must not be identified: %#v", result)
	}
}

func TestDiscoveryXMLRejectsWrongRootAndEntities(t *testing.T) {
	if valid, _ := validateSCADAXML([]byte(`<other><s v="1"/></other>`)); valid {
		t.Fatal("wrong XML root must be rejected")
	}
	unsafe := []byte(`<!DOCTYPE m [<!ENTITY x "1">]><m><s v="1"/><s v="2"/><s v="3"/><s v="4"/><s v="5"/><s v="6"/><s v="7"/><s v="8"/><s v="9"/><s v="10"/></m>`)
	if valid, _ := validateSCADAXML(unsafe); valid {
		t.Fatal("XML declarations with entities must be rejected")
	}
}

func TestCamSplitIsVisibleButExcludedFromServiceLoad(t *testing.T) {
	monitor := &Monitor{
		records: map[string]*Record{
			"distro01":  {Device: Device{ID: "distro01", DeviceType: "distro"}, Status: "online", Metrics: []Metric{{Key: "l1_current", Value: "30"}}, PeakCurrents: map[string]PeakCurrent{"l1_current": {Numeric: 35}}},
			"camsplit1": {Device: Device{ID: "camsplit1", Name: "Stage Cam Split", Address: "10.0.0.5", DeviceType: "cam_split"}, Status: "online", Metrics: []Metric{{Key: "l1_current", Value: "80", Unit: "A"}, {Key: "neutral_current", Value: "5", Unit: "A"}}, PeakCurrents: map[string]PeakCurrent{"l1_current": {Numeric: 90}}},
		},
		servicePeaks: map[string]ServicePeak{"service01": {Load: 35}},
	}
	service := Service{ID: "service01", Name: "Main service", AmpRating: 100, DeviceIDs: []string{"distro01", "camsplit1"}}
	public := monitor.publicService(service)
	if public["current_load"] != 30.0 || public["peak_load"] != 35.0 || public["device_count"] != 1 {
		t.Fatalf("Cam split affected service calculation: %#v", public)
	}
	phaseLoads := public["phase_loads"].(map[string]float64)
	if phaseLoads["l1_current"] != 30 || phaseLoads["l2_current"] != 0 || phaseLoads["l3_current"] != 0 {
		t.Fatalf("unexpected service phase loads: %#v", phaseLoads)
	}
	camSplits := public["cam_splits"].([]map[string]any)
	if len(camSplits) != 1 || camSplits[0]["name"] != "Stage Cam Split" {
		t.Fatalf("Cam split was not exposed: %#v", camSplits)
	}
}

func TestServerControllerLifecycle(t *testing.T) {
	controller := newServerController("127.0.0.1", 0, http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	if err := controller.Start(); err != nil {
		t.Fatal(err)
	}
	if !controller.IsRunning() {
		t.Fatal("server should be running")
	}
	if err := controller.Stop(); err != nil {
		t.Fatal(err)
	}
	if controller.IsRunning() {
		t.Fatal("server should be stopped")
	}
	if err := controller.Restart(); err != nil {
		t.Fatal(err)
	}
	if !controller.IsRunning() {
		t.Fatal("server should be running after restart")
	}
	if err := controller.Stop(); err != nil {
		t.Fatal(err)
	}
}
