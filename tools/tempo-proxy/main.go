// tempo-proxy — Bridges Grafana Tempo/TraceQL API ↔ VictoriaTraces Jaeger API
//
// Rewritten in Go to solve JavaScript's Number precision loss for nanosecond
// timestamps in protobuf fixed64 fields. Manual protobuf binary encoder
// produces wire-compatible output that Grafana's proto.Unmarshal can decode.
package main

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ── Manual protobuf wire format encoder ──────────────────────────────
// Wire types: 0=varint, 1=64-bit, 2=length-delimited, 5=32-bit

func pbVarint(buf *bytes.Buffer, fieldNum uint32, value uint64) {
	buf.WriteByte(byte(fieldNum<<3))
	encodeVarint(buf, value)
}

func encodeVarint(buf *bytes.Buffer, v uint64) {
	for v >= 0x80 {
		buf.WriteByte(byte(v) | 0x80)
		v >>= 7
	}
	buf.WriteByte(byte(v))
}

func pbFixed64(buf *bytes.Buffer, fieldNum uint32, value uint64) {
	buf.WriteByte(byte(fieldNum<<3 | 1))
	var b [8]byte
	binary.LittleEndian.PutUint64(b[:], value)
	buf.Write(b[:])
}

func pbFixed32(buf *bytes.Buffer, fieldNum uint32, value uint32) {
	buf.WriteByte(byte(fieldNum<<3 | 5))
	var b [4]byte
	binary.LittleEndian.PutUint32(b[:], value)
	buf.Write(b[:])
}

func pbBytes(buf *bytes.Buffer, fieldNum uint32, data []byte) {
	if len(data) == 0 {
		return
	}
	buf.WriteByte(byte(fieldNum<<3 | 2))
	encodeVarint(buf, uint64(len(data)))
	buf.Write(data)
}

func pbString(buf *bytes.Buffer, fieldNum uint32, s string) {
	if s == "" {
		return
	}
	pbBytes(buf, fieldNum, []byte(s))
}

func pbMessage(buf *bytes.Buffer, fieldNum uint32, msg []byte) {
	// Always write the field, even for empty messages.
	// In proto3, absent field = nil pointer, zero-length field = non-nil empty message.
	// Callers must check nil before calling this.
	buf.WriteByte(byte(fieldNum<<3 | 2))
	encodeVarint(buf, uint64(len(msg)))
	buf.Write(msg)
}

// ── OTel protobuf types (inline, matching Grafana Tempo's proto field numbers) ──
// Field numbers from: opentelemetry/proto/trace/v1/trace.proto

type TraceByIDResponse struct {
	Trace  *Trace
	Status int32 // tempopb.PartialStatus
}

func (r *TraceByIDResponse) Encode() []byte {
	buf := &bytes.Buffer{}
	if r.Trace != nil {
		pbMessage(buf, 1, r.Trace.Encode())
	}
	if r.Status != 0 {
		pbVarint(buf, 3, uint64(r.Status))
	}
	return buf.Bytes()
}

type Trace struct {
	ResourceSpans []*ResourceSpans
}

func (t *Trace) Encode() []byte {
	buf := &bytes.Buffer{}
	for _, rs := range t.ResourceSpans {
		pbMessage(buf, 1, rs.Encode())
	}
	return buf.Bytes()
}

type ResourceSpans struct {
	Resource   *Resource
	ScopeSpans []*ScopeSpans
}

func (rs *ResourceSpans) Encode() []byte {
	buf := &bytes.Buffer{}
	if rs.Resource != nil {
		pbMessage(buf, 1, rs.Resource.Encode())
	}
	for _, ss := range rs.ScopeSpans {
		pbMessage(buf, 2, ss.Encode())
	}
	return buf.Bytes()
}

type Resource struct {
	Attributes []*KeyValue
}

func (r *Resource) Encode() []byte {
	buf := &bytes.Buffer{}
	for _, a := range r.Attributes {
		pbMessage(buf, 1, a.Encode())
	}
	return buf.Bytes()
}

type ScopeSpans struct {
	Scope *InstrumentationScope
	Spans []*Span
}

func (ss *ScopeSpans) Encode() []byte {
	buf := &bytes.Buffer{}
	if ss.Scope != nil {
		pbMessage(buf, 1, ss.Scope.Encode())
	}
	for _, s := range ss.Spans {
		pbMessage(buf, 2, s.Encode())
	}
	return buf.Bytes()
}

type InstrumentationScope struct {
	Name    string
	Version string
}

func (s *InstrumentationScope) Encode() []byte {
	buf := &bytes.Buffer{}
	pbString(buf, 1, s.Name)
	pbString(buf, 2, s.Version)
	return buf.Bytes()
}

// Span fields match OTel trace.v1.Span proto field numbers
type Span struct {
	TraceId   []byte // field 1
	SpanId    []byte // field 2
	TraceState string // field 3
	ParentSpanId []byte // field 4
	Name     string // field 5
	Kind     int32  // field 6
	StartTimeUnixNano uint64 // field 7, fixed64
	EndTimeUnixNano   uint64 // field 8, fixed64
	Attributes []*KeyValue // field 9
	DroppedAttributesCount uint32 // field 10
	Events []*SpanEvent // field 11
	DroppedEventsCount uint32 // field 12
	Links []*SpanLink // field 13
	DroppedLinksCount uint32 // field 14
	Status *SpanStatus // field 15
	Flags  uint32 // field 16
}

func (s *Span) Encode() []byte {
	buf := &bytes.Buffer{}
	pbBytes(buf, 1, s.TraceId)
	pbBytes(buf, 2, s.SpanId)
	pbString(buf, 3, s.TraceState)
	pbBytes(buf, 4, s.ParentSpanId)
	pbString(buf, 5, s.Name)
	if s.Kind != 0 {
		pbVarint(buf, 6, uint64(s.Kind))
	}
	if s.StartTimeUnixNano != 0 {
		pbFixed64(buf, 7, s.StartTimeUnixNano)
	}
	if s.EndTimeUnixNano != 0 {
		pbFixed64(buf, 8, s.EndTimeUnixNano)
	}
	for _, a := range s.Attributes {
		pbMessage(buf, 9, a.Encode())
	}
	if s.DroppedAttributesCount != 0 {
		pbVarint(buf, 10, uint64(s.DroppedAttributesCount))
	}
	for _, e := range s.Events {
		pbMessage(buf, 11, e.Encode())
	}
	if s.DroppedEventsCount != 0 {
		pbVarint(buf, 12, uint64(s.DroppedEventsCount))
	}
	for _, l := range s.Links {
		pbMessage(buf, 13, l.Encode())
	}
	if s.DroppedLinksCount != 0 {
		pbVarint(buf, 14, uint64(s.DroppedLinksCount))
	}
	if s.Status != nil {
		pbMessage(buf, 15, s.Status.Encode())
	}
	if s.Flags != 0 {
		pbFixed32(buf, 16, s.Flags)
	}
	return buf.Bytes()
}

type SpanEvent struct {
	TimeUnixNano uint64 // field 1, fixed64
	Name         string // field 2
	Attributes   []*KeyValue // field 3
	DroppedAttributesCount uint32 // field 4
}

func (e *SpanEvent) Encode() []byte {
	buf := &bytes.Buffer{}
	if e.TimeUnixNano != 0 {
		pbFixed64(buf, 1, e.TimeUnixNano)
	}
	pbString(buf, 2, e.Name)
	for _, a := range e.Attributes {
		pbMessage(buf, 3, a.Encode())
	}
	if e.DroppedAttributesCount != 0 {
		pbVarint(buf, 4, uint64(e.DroppedAttributesCount))
	}
	return buf.Bytes()
}

type SpanLink struct {
	TraceId []byte // field 1
	SpanId  []byte // field 2
	TraceState string // field 3
	Attributes []*KeyValue // field 4
	DroppedAttributesCount uint32 // field 5
	Flags uint32 // field 6
}

func (l *SpanLink) Encode() []byte {
	buf := &bytes.Buffer{}
	pbBytes(buf, 1, l.TraceId)
	pbBytes(buf, 2, l.SpanId)
	pbString(buf, 3, l.TraceState)
	for _, a := range l.Attributes {
		pbMessage(buf, 4, a.Encode())
	}
	if l.DroppedAttributesCount != 0 {
		pbVarint(buf, 5, uint64(l.DroppedAttributesCount))
	}
	if l.Flags != 0 {
		pbFixed32(buf, 6, l.Flags)
	}
	return buf.Bytes()
}

type SpanStatus struct {
	Message string // field 2
	Code    int32  // field 3
}

func (s *SpanStatus) Encode() []byte {
	buf := &bytes.Buffer{}
	pbString(buf, 2, s.Message)
	if s.Code != 0 {
		pbVarint(buf, 3, uint64(s.Code))
	}
	return buf.Bytes()
}

type KeyValue struct {
	Key   string
	Value *AnyValue
}

func (kv *KeyValue) Encode() []byte {
	buf := &bytes.Buffer{}
	pbString(buf, 1, kv.Key)
	if kv.Value != nil {
		pbMessage(buf, 2, kv.Value.Encode())
	}
	return buf.Bytes()
}

// AnyValue uses oneof: string(1), bool(2), int(3), double(4)
type AnyValue struct {
	Type    int // 1=string, 2=bool, 3=int, 4=double
	StrVal  string
	BoolVal bool
	IntVal  string  // stored as string to match OTel AnyValue int_value type
	DblVal  float64
}

func anyValueString(s string) *AnyValue {
	return &AnyValue{Type: 1, StrVal: s}
}

func anyValueBool(b bool) *AnyValue {
	return &AnyValue{Type: 2, BoolVal: b}
}

func anyValueInt(s string) *AnyValue {
	return &AnyValue{Type: 3, IntVal: s}
}

func anyValueDouble(f float64) *AnyValue {
	return &AnyValue{Type: 4, DblVal: f}
}

func (av *AnyValue) Encode() []byte {
	buf := &bytes.Buffer{}
	switch av.Type {
	case 1:
		pbString(buf, 1, av.StrVal)
	case 2:
		pbVarint(buf, 2, boolToUint64(av.BoolVal))
	case 3:
		pbString(buf, 3, av.IntVal)
	case 4:
		pbFixed64(buf, 4, math.Float64bits(av.DblVal))
	}
	return buf.Bytes()
}

func boolToUint64(b bool) uint64 {
	if b {
		return 1
	}
	return 0
}

// ── Config ──────────────────────────────────────────────────────────

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

// ── ID helpers ─────────────────────────────────────────────────────────

func traceIDFromJaeger(id string) string {
	return strings.ToLower(fmt.Sprintf("%032s", id))
}

func spanIDFromJaeger(id string) string {
	return strings.ToLower(fmt.Sprintf("%016s", id))
}

func hexToBytes(h string) []byte {
	b, _ := hex.DecodeString(h)
	return b
}

// ── Jaeger → OTel conversion ──────────────────────────────────────────

func tagToOtelAttribute(tag JaegerTag) *KeyValue {
	kv := &KeyValue{Key: tag.Key}
	switch tag.Type {
	case "bool":
		kv.Value = anyValueBool(tag.Value == "true")
	case "int64", "int":
		kv.Value = anyValueInt(tag.Value)
	case "float64", "float":
		if f, err := strconv.ParseFloat(tag.Value, 64); err == nil {
			kv.Value = anyValueDouble(f)
		}
	default:
		kv.Value = anyValueString(tag.Value)
	}
	return kv
}

func jaegerSpanToOtel(span JaegerSpan) *Span {
	startUS := uint64(span.StartTime) * 1000
	endUS := uint64(span.StartTime+span.Duration) * 1000
	s := &Span{
		TraceId:           hexToBytes(traceIDFromJaeger(span.TraceID)),
		SpanId:            hexToBytes(spanIDFromJaeger(span.SpanID)),
		Name:              span.OperationName,
		StartTimeUnixNano:  startUS,
		EndTimeUnixNano:    endUS,
		Status:            &SpanStatus{Code: 1},
	}
	if span.ParentSpanID != "" {
		s.ParentSpanId = hexToBytes(spanIDFromJaeger(span.ParentSpanID))
	}
	for _, tag := range span.Tags {
		s.Attributes = append(s.Attributes, tagToOtelAttribute(tag))
	}
	for _, lg := range span.Logs {
		evt := &SpanEvent{
			TimeUnixNano: uint64(lg.Timestamp) * 1000,
			Name:         fmt.Sprintf("event_%d", lg.Timestamp),
			Attributes:   make([]*KeyValue, 0, len(lg.Fields)),
		}
		for _, f := range lg.Fields {
			evt.Attributes = append(evt.Attributes, tagToOtelAttribute(f))
		}
		s.Events = append(s.Events, evt)
	}
	for _, tag := range span.Tags {
		if tag.Key == "error" && tag.Value != "false" && tag.Value != "unset" {
			s.Status = &SpanStatus{Code: 2, Message: "Error"}
			break
		}
	}
	return s
}

func jaegerToResourceSpans(jt JaegerTrace) []*ResourceSpans {
	byProcess := make(map[string][]JaegerSpan)
	for _, sp := range jt.Spans {
		byProcess[sp.ProcessID] = append(byProcess[sp.ProcessID], sp)
	}
	var rss []*ResourceSpans
	for pid, procSpans := range byProcess {
		proc := jt.Processes[pid]
		if proc == nil {
			proc = &JaegerProcess{ServiceName: "unknown"}
		}
		attrs := []*KeyValue{
			{Key: "service.name", Value: anyValueString(proc.ServiceName)},
		}
		for _, tag := range proc.Tags {
			attrs = append(attrs, tagToOtelAttribute(tag))
		}
		otSpans := make([]*Span, 0, len(procSpans))
		for _, sp := range procSpans {
			otSpans = append(otSpans, jaegerSpanToOtel(sp))
		}
		rss = append(rss, &ResourceSpans{
			Resource:   &Resource{Attributes: attrs},
			ScopeSpans: []*ScopeSpans{
				{Scope: &InstrumentationScope{Name: "", Version: ""}, Spans: otSpans},
			},
		})
	}
	return rss
}

// ── Search/metadata conversion ───────────────────────────────────────────

type TempoTraceMetadata struct {
	TraceID           string         `json:"traceID"`
	RootServiceName   string         `json:"rootServiceName"`
	RootTraceName     string         `json:"rootTraceName"`
	StartTimeUnixNano uint64         `json:"startTimeUnixNano"`
	DurationMs        uint32         `json:"durationMs"`
	SpanSets          []SpanSet      `json:"spanSets"`
	ServiceStats      map[string]int `json:"serviceStats"`
}

type SpanSet struct {
	Spans   []SpanMeta `json:"spans"`
	Matched int        `json:"matched"`
}

type SpanMeta struct {
	SpanID            string      `json:"spanID"`
	Name              string      `json:"name"`
	StartTimeUnixNano uint64      `json:"startTimeUnixNano"`
	DurationNanos     uint64      `json:"durationNanos"`
	Attributes        []SpanAttr  `json:"attributes"`
}

type SpanAttr struct {
	Key   string      `json:"key"`
	Value interface{} `json:"value"`
}

func jaegerSearchToTempoTraces(jaegerData []JaegerTrace) []TempoTraceMetadata {
	var traces []TempoTraceMetadata
	for _, trace := range jaegerData {
		var root *JaegerSpan
		for i := range trace.Spans {
			if trace.Spans[i].ParentSpanID == "" {
				root = &trace.Spans[i]
				break
			}
		}
		if root == nil {
			if len(trace.Spans) > 0 {
				root = &trace.Spans[0]
			} else {
				continue
			}
		}
		serviceStats := map[string]int{}
		for _, sp := range trace.Spans {
			proc := trace.Processes[sp.ProcessID]
			if proc == nil {
				continue
			}
			svc := proc.ServiceName
			serviceStats[svc]++
			for _, t := range sp.Tags {
				if t.Key == "error" && t.Value != "false" && t.Value != "unset" {
					serviceStats[svc]++
					break
				}
			}
		}
		spanSets := []SpanSet{{Spans: make([]SpanMeta, 0, len(trace.Spans)), Matched: len(trace.Spans)}}
		for _, sp := range trace.Spans {
			spanSets[0].Spans = append(spanSets[0].Spans, SpanMeta{
				SpanID:            spanIDFromJaeger(sp.SpanID),
				Name:              sp.OperationName,
				StartTimeUnixNano: uint64(sp.StartTime) * 1000,
				DurationNanos:     uint64(sp.Duration) * 1000,
			})
		}
		durMs := uint32(root.Duration / 1000)
		if durMs < 1 {
			durMs = 1
		}
		rootSvc := "unknown"
		if proc := trace.Processes[root.ProcessID]; proc != nil {
			rootSvc = proc.ServiceName
		}
		traces = append(traces, TempoTraceMetadata{
			TraceID:           traceIDFromJaeger(trace.TraceID),
			RootServiceName:   rootSvc,
			RootTraceName:     root.OperationName,
			StartTimeUnixNano: uint64(root.StartTime) * 1000,
			DurationMs:        durMs,
			SpanSets:          spanSets,
			ServiceStats:      serviceStats,
		})
	}
	return traces
}

// ── TraceQL extraction ─────────────────────────────────────────────────

var reServiceName = regexp.MustCompile(`resource\.service\.name\s*=\s*"([^"]+)"`)
var reServiceAlt = regexp.MustCompile(`\.service\s*=\s*"([^"]+)"`)
var reName = regexp.MustCompile(`\.name\s*=\s*"([^"]+)"`)

func extractJaegerParamsFromTraceQL(traceQL string) (service, operation string) {
	if traceQL == "" {
		return
	}
	q, _ := url.QueryUnescape(traceQL)
	if m := reServiceName.FindStringSubmatch(q); m != nil {
		service = m[1]
	} else if m := reServiceAlt.FindStringSubmatch(q); m != nil {
		service = m[1]
	}
	if m := reName.FindStringSubmatch(q); m != nil && service == "" {
		operation = m[1]
	}
	return
}

// ── Service name cache ────────────────────────────────────────────────────

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
	serviceMu.Lock()
	serviceNames = result.Data
	serviceCached = time.Now()
	serviceMu.Unlock()
	return result.Data
}

// ── HTTP helpers ───────────────────────────────────────────────────────

func httpGet(url string, timeout time.Duration) ([]byte, error) {
	client := &http.Client{Timeout: timeout}
	resp, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	return io.ReadAll(resp.Body)
}

func httpGetJSON(url string, timeout time.Duration, v interface{}) (int, error) {
	data, err := httpGet(url, timeout)
	if err != nil {
		return 0, err
	}
	return http.StatusOK, json.Unmarshal(data, v)
}

func readBody(r *http.Request) ([]byte, error) {
	return io.ReadAll(r.Body)
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

// ── Route handlers ──────────────────────────────────────────────────────

func handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

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

	if service == "" {
		traceQL := q.Get("q")
		svc, op := extractJaegerParamsFromTraceQL(traceQL)
		if svc != "" {
			service = svc
		}
		if op != "" {
			operation = op
		}
	}

	// POST body extraction
	if service == "" && r.Method == http.MethodPost {
		body, _ := readBody(r)
		var jsonBody map[string]interface{}
		if json.Unmarshal(body, &jsonBody) == nil {
			svc, op := extractJaegerParamsFromTraceQL(fmt.Sprint(jsonBody["traceQL"]))
			if svc != "" {
				service = svc
			}
			if op != "" {
				operation = op
			}
			if v, ok := jsonBody["start"]; ok {
				start = fmt.Sprint(v)
			}
			if v, ok := jsonBody["end"]; ok {
				end = fmt.Sprint(v)
			}
			if v, ok := jsonBody["limit"]; ok {
				limit = fmt.Sprint(v)
			}
		}
	}

	services := getServiceNames()
	if service == "" {
		// No specific service — iterate over all known services (skip empty)
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
	type searchResult struct {
		Traces []TempoTraceMetadata `json:"traces"`
	}

	var allTraces []TempoTraceMetadata
	var mu sync.Mutex
	var wg sync.WaitGroup

	for _, svc := range services {
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
			code, err := httpGetJSON(victoriaTracesURL+"/select/jaeger/api/traces?"+jaegerParams.Encode(), 30*time.Second, &tResult)
			if err == nil && code == http.StatusOK && len(tResult.Data) > 0 {
				traces := jaegerSearchToTempoTraces(tResult.Data)
				mu.Lock()
				allTraces = append(allTraces, traces...)
				mu.Unlock()
			}
		}(svc)
	}

	wg.Wait()

	// Sort by startTime descending
	sort.Slice(allTraces, func(i, j int) bool {
		return allTraces[j].StartTimeUnixNano > allTraces[i].StartTimeUnixNano
	})
	if len(allTraces) > limitInt {
		allTraces = allTraces[:limitInt]
	}
	writeJSON(w, http.StatusOK, searchResult{Traces: allTraces})
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
	// Extract tag name from path: /api/v2/search/tag/{tag}/values or /api/search/tags/{tag}/values
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

func handleTraceByID(w http.ResponseWriter, r *http.Request) {
	// Match /api/v2/traces/{id} or /api/traces/{id}
	re := regexp.MustCompile(`^/api/(v2/)?traces/([0-9a-fA-F]+)`)
	m := re.FindStringSubmatch(r.URL.Path)
	if m == nil {
		writeError(w, http.StatusBadRequest, "invalid trace ID")
		return
	}
	traceID := m[2]

	data, err := httpGet(victoriaTracesURL+"/select/jaeger/api/traces/"+traceID, 15*time.Second)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	var jaegerResp struct {
		Data []JaegerTrace `json:"data"`
	}
	if err := json.Unmarshal(data, &jaegerResp); err != nil || len(jaegerResp.Data) == 0 {
		// Empty trace — return empty TraceByIDResponse
		resp := &TraceByIDResponse{}
		buf := resp.Encode()
		w.Header().Set("Content-Type", "application/protobuf")
		w.WriteHeader(http.StatusOK)
		w.Write(buf)
		log.Printf("[tempo-proxy] RESP 200 protobuf %d bytes (empty trace)", len(buf))
		return
	}

	// Merge all traces into one ResourceSpans list
	var allResourceSpans []*ResourceSpans
	for _, trace := range jaegerResp.Data {
		allResourceSpans = append(allResourceSpans, jaegerToResourceSpans(trace)...)
	}

	resp := &TraceByIDResponse{
		Trace: &Trace{ResourceSpans: allResourceSpans},
	}

	buf := resp.Encode()
	w.Header().Set("Content-Type", "application/protobuf")
	w.WriteHeader(http.StatusOK)
	w.Write(buf)
	log.Printf("[tempo-proxy] RESP 200 protobuf %d bytes", len(buf))
}

// ── Jaeger JSON types ───────────────────────────────────────────────────

type JaegerTrace struct {
	TraceID   string                  `json:"traceID"`
	Processes map[string]*JaegerProcess `json:"processes"`
	Spans     []JaegerSpan            `json:"spans"`
}

type JaegerProcess struct {
	ServiceName string     `json:"serviceName"`
	Tags       []JaegerTag `json:"tags"`
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
	Logs          []JaegerLog  `json:"logs"`
}

type JaegerLog struct {
	Timestamp int64      `json:"timestamp"`
	Fields    []JaegerTag `json:"fields"`
}

// ── Main router ──────────────────────────────────────────────────────────

func main() {
	log.Printf("[tempo-proxy] listening on :%d, backend: %s", port, victoriaTracesURL)

	mux := http.NewServeMux()
	mux.HandleFunc("/", handleHealth)
	mux.HandleFunc("/ready", handleHealth)
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/api/echo", handleHealth)

	mux.HandleFunc("/api/services", handleServices)
	mux.HandleFunc("/api/operations", handleOperations)
	mux.HandleFunc("/api/search", handleSearch)
	mux.HandleFunc("/api/v2/search/tags", handleSearchTagsV2)

	// Tag values — two route patterns
	mux.HandleFunc("/api/v2/search/tag/", handleSearchTagValuesV2)
	mux.HandleFunc("/api/search/tags/", handleSearchTagValuesV2)

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
