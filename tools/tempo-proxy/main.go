// tempo-proxy — Path translator for Grafana Jaeger datasource ↔ VictoriaTraces Jaeger API
//
// VictoriaTraces exposes Jaeger Query Service API at /select/jaeger/api/*,
// but Grafana's Jaeger datasource calls standard Jaeger paths (/api/*).
// This proxy translates paths and passes responses through as-is.
// Multi-service aggregation is handled when no specific service is requested.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ── Config ──────────────────────────────────────────────────────────────────

var (
	victoriaTracesURL string
	port              int
)

func init() {
	victoriaTracesURL = os.Getenv("VICTORIATRACES_URL")
	if victoriaTracesURL == "" {
		victoriaTracesURL = "http://victoriatraces:10428"
	}
	port = 10429
	if p, err := strconv.Atoi(os.Getenv("PORT")); err == nil && p > 0 {
		port = p
	}
}

// ── Jaeger JSON types ───────────────────────────────────────────────────────

type JaegerTrace struct {
	TraceID   string                    `json:"traceID"`
	Processes map[string]*JaegerProcess `json:"processes"`
	Spans     []JaegerSpan              `json:"spans"`
}

type JaegerProcess struct {
	ServiceName string     `json:"serviceName"`
	Tags        []JaegerTag `json:"tags"`
}

type JaegerTag struct {
	Key   string `json:"key"`
	Value string `json:"value"`
	Type  string `json:"type"`
}

type JaegerSpan struct {
	TraceID       string     `json:"traceID"`
	SpanID        string     `json:"spanID"`
	ProcessID     string     `json:"processID"`
	OperationName string     `json:"operationName"`
	StartTime     int64      `json:"startTime"`
	Duration      int64      `json:"duration"`
	ParentSpanID  string     `json:"parentSpanID"`
	Tags          []JaegerTag `json:"tags"`
	Logs          []JaegerLog `json:"logs"`
}

type JaegerLog struct {
	Timestamp int64      `json:"timestamp"`
	Fields    []JaegerTag `json:"fields"`
}

// ── Service name cache ──────────────────────────────────────────────────────

var (
	serviceMu     sync.Mutex
	serviceNames  []string
	serviceCached time.Time
)

const serviceCacheTTL = 30 * time.Second

func getServiceNames() []string {
	serviceMu.Lock()
	defer serviceMu.Unlock()
	if len(serviceNames) > 0 && time.Since(serviceCached) < serviceCacheTTL {
		return serviceNames
	}
	return fetchServiceNames()
}

func fetchServiceNames() []string {
	resp, err := httpGet(victoriaTracesURL+"/select/jaeger/api/services", 15*time.Second)
	if err != nil {
		log.Printf("[tempo-proxy] failed to fetch services: %v", err)
		return serviceNames
	}
	var result struct {
		Data []string `json:"data"`
	}
	if err := json.Unmarshal(resp, &result); err != nil || len(result.Data) == 0 {
		return serviceNames
	}
	serviceNames = result.Data
	serviceCached = time.Now()
	return result.Data
}

// ── HTTP helpers ────────────────────────────────────────────────────────────

func httpGet(url string, timeout time.Duration) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	return doRequest(req)
}

func httpGetWithContext(ctx context.Context, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	return doRequest(req)
}

func doRequest(req *http.Request) ([]byte, error) {
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, readErr := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return data, fmt.Errorf("upstream %s: HTTP %d: %s", req.URL.String(), resp.StatusCode, strings.TrimSpace(string(data)))
	}
	return data, readErr
}

func httpGetJSON(url string, timeout time.Duration, v interface{}) (int, error) {
	data, err := httpGet(url, timeout)
	if err != nil {
		return 0, err
	}
	return http.StatusOK, json.Unmarshal(data, v)
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	data, _ := json.Marshal(v)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(status)
	w.Write(data)
	preview := string(data)
	if len(preview) > 300 {
		preview = preview[:300] + "..."
	}
	log.Printf("[tempo-proxy] RESP %d body=%s", status, preview)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	http.Error(w, msg, status)
	log.Printf("[tempo-proxy] RESP %d error=%s", status, msg)
}

// ── Route handlers ──────────────────────────────────────────────────────────

func handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// handleServices returns the list of service names from VictoriaTraces.
// Called by Grafana Jaeger datasource to populate service dropdown.
func handleServices(w http.ResponseWriter, r *http.Request) {
	var result struct {
		Data []string `json:"data"`
	}
	if _, err := httpGetJSON(victoriaTracesURL+"/select/jaeger/api/services", 15*time.Second, &result); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "upstream error"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"data": result.Data})
}

// handleOperations returns operations for a given service.
// Called by Grafana Jaeger datasource to populate operation dropdown.
func handleOperations(w http.ResponseWriter, r *http.Request) {
	service := r.URL.Query().Get("service")
	if service == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing service parameter"})
		return
	}
	var result struct {
		Data []string `json:"data"`
	}
	if _, err := httpGetJSON(victoriaTracesURL+"/select/jaeger/api/services/"+url.QueryEscape(service)+"/operations", 15*time.Second, &result); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "upstream error"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"data": result.Data})
}

// handleSearch returns Jaeger-format trace search results.
// When no specific service is given, iterates over all services and merges results.
func handleSearch(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	service := q.Get("service")
	operation := q.Get("operation")
	start := q.Get("start")
	end := q.Get("end")
	limit := q.Get("limit")
	if limit == "" {
		limit = "20"
	}

	services := getServiceNames()
	if service == "" {
		// No specific service — iterate over all known services
	} else {
		services = []string{service}
	}

	// Convert seconds (Grafana) to microseconds (VictoriaTraces Jaeger API)
	microStart := toMicroseconds(start)
	microEnd := toMicroseconds(end)
	limitInt, _ := strconv.Atoi(limit)
	if limitInt <= 0 {
		limitInt = 20
	}

	type traceResult struct {
		Data []JaegerTrace `json:"data"`
	}

	var allTraces []JaegerTrace
	var mu sync.Mutex
	var wg sync.WaitGroup
	done := make(chan struct{})

	// Cancel goroutines when client disconnects or after 28s
	searchCtx, searchCancel := context.WithTimeout(r.Context(), 28*time.Second)
	defer searchCancel()

	for _, svc := range services {
		// Early termination: skip remaining services if we have enough traces
		mu.Lock()
		if len(allTraces) >= limitInt*2 {
			mu.Unlock()
			break
		}
		mu.Unlock()

		wg.Add(1)
		go func(svcName string) {
			defer wg.Done()
			jaegerParams := url.Values{}
			jaegerParams.Set("service", svcName)
			jaegerParams.Set("limit", strconv.Itoa(limitInt))
			if microStart != "" {
				jaegerParams.Set("start", microStart)
			}
			if microEnd != "" {
				jaegerParams.Set("end", microEnd)
			}
			if operation != "" {
				jaegerParams.Set("operation", operation)
			}
			var tResult traceResult
			data, err := httpGetWithContext(searchCtx, victoriaTracesURL+"/select/jaeger/api/traces?"+jaegerParams.Encode())
			if err == nil {
				json.Unmarshal(data, &tResult)
				if len(tResult.Data) > 0 {
					mu.Lock()
					allTraces = append(allTraces, tResult.Data...)
					mu.Unlock()
				}
			}
		}(svc)
	}

	wg.Wait()
	close(done)

	// Sort by startTime descending (use first span's StartTime)
	sort.Slice(allTraces, func(i, j int) bool {
		ti := int64(0)
		tj := int64(0)
		if len(allTraces[i].Spans) > 0 {
			ti = allTraces[i].Spans[0].StartTime
		}
		if len(allTraces[j].Spans) > 0 {
			tj = allTraces[j].Spans[0].StartTime
		}
		return tj < ti // descending
	})
	if len(allTraces) > limitInt {
		allTraces = allTraces[:limitInt]
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"data":   allTraces,
		"total":  len(allTraces),
		"limit":  limitInt,
		"offset": 0,
		"errors": nil,
	})
}

func toMicroseconds(s string) string {
	if s == "" {
		return ""
	}
	v, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return s
	}
	// Grafana sends seconds; VictoriaTraces expects microseconds
	if v < 1e12 {
		return strconv.FormatInt(v*1000000, 10)
	}
	return s
}

func handleMetrics(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{"results": []interface{}{}})
}

func handleSearchTagsV2(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"scopes": []map[string]interface{}{
			{"name": "resource", "tags": []string{"service.name"}},
			{"name": "span", "tags": []string{"name", "status"}},
		},
	})
}

func handleSearchTagValuesV2(w http.ResponseWriter, r *http.Request) {
	tag := ""
	parts := strings.Split(strings.TrimSuffix(r.URL.Path, "/"), "/")
	for i, p := range parts {
		if (p == "tag" || p == "tags") && i+1 < len(parts) {
			tag = parts[i+1]
			break
		}
	}
	if tag == "" {
		tag = r.URL.Query().Get("tag")
	}
	switch tag {
	case "resource.service.name", "service.name":
		services := getServiceNames()
		tagValues := make([]map[string]interface{}, len(services))
		for i, s := range services {
			tagValues[i] = map[string]interface{}{"type": "string", "value": s}
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"tagValues": tagValues})
	case "name", "span.name":
		writeJSON(w, http.StatusOK, map[string]interface{}{"tagValues": []map[string]string{{"type": "string", "value": "HTTP GET"}}})
	case "status":
		writeJSON(w, http.StatusOK, map[string]interface{}{"tagValues": []map[string]string{
			{"type": "string", "value": "ok"}, {"type": "string", "value": "error"}, {"type": "string", "value": "unset"},
		}})
	default:
		writeJSON(w, http.StatusOK, map[string]interface{}{"tagValues": []map[string]string{}})
	}
}

// handleTraceByID returns a single trace in Jaeger JSON format.
// VictoriaTraces already returns Jaeger format — just pass through.
func handleTraceByID(w http.ResponseWriter, r *http.Request) {
	// Match /api/v2/traces/{id} or /api/traces/{id}
	parts := strings.Split(strings.TrimSuffix(r.URL.Path, "/"), "/")
	traceID := ""
	for i, p := range parts {
		if p == "traces" && i+1 < len(parts) {
			traceID = parts[i+1]
			break
		}
	}
	if traceID == "" {
		writeError(w, http.StatusBadRequest, "invalid trace ID")
		return
	}
	// Validate traceID is hex and reasonable length (16 or 32 chars)
	for _, c := range traceID {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			writeError(w, http.StatusBadRequest, "invalid trace ID: not hex")
			return
		}
	}
	if len(traceID) != 16 && len(traceID) != 32 {
		writeError(w, http.StatusBadRequest, "invalid trace ID: wrong length")
		return
	}

	data, err := httpGet(victoriaTracesURL+"/select/jaeger/api/traces/"+traceID, 15*time.Second)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	// Pass through raw Jaeger JSON from VictoriaTraces
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(http.StatusOK)
	w.Write(data)
	log.Printf("[tempo-proxy] RESP 200 json (jaeger trace %s) %d bytes", traceID, len(data))
}

// ── Main router ─────────────────────────────────────────────────────────────

func main() {
	log.Printf("[tempo-proxy] listening on :%d, backend: %s", port, victoriaTracesURL)

	mux := http.NewServeMux()
	mux.HandleFunc("/", handleHealth)
	mux.HandleFunc("/ready", handleHealth)
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/api/echo", handleHealth)

	// Jaeger API endpoints — used by Grafana Jaeger datasource
	mux.HandleFunc("/api/services", handleServices)
	mux.HandleFunc("/api/operations", handleOperations)
	mux.HandleFunc("/api/search", handleSearch)
	mux.HandleFunc("/api/v2/search/tags", handleSearchTagsV2)

	// Tag values — kept for backward compat
	mux.HandleFunc("/api/v2/search/tag/", handleSearchTagValuesV2)
	mux.HandleFunc("/api/search/tags/", handleSearchTagValuesV2)

	// Metrics — stub
	mux.HandleFunc("/api/metrics/query_range", handleMetrics)
	mux.HandleFunc("/api/metrics/query", handleMetrics)
	mux.HandleFunc("/api/v1/query_range", handleMetrics)
	mux.HandleFunc("/api/v1/query", handleMetrics)

	// TraceByID — V2 then V1
	mux.HandleFunc("/api/v2/traces/", handleTraceByID)
	mux.HandleFunc("/api/traces/", handleTraceByID)

	// /api/traces (no trailing slash) = search
	mux.HandleFunc("/api/traces", handleSearch)

	// Catch-all for unknown /api/v2/ paths
	mux.HandleFunc("/api/v2/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{"scopes": []interface{}{}})
	})

	server := &http.Server{
		Addr:    fmt.Sprintf(":%d", port),
		Handler: mux,
	}
	log.Fatal(server.ListenAndServe())
}
