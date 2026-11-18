FROM golang:1.24-alpine AS builder
WORKDIR /build
COPY go.mod ./
RUN go mod download
COPY main.go .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o tempo-proxy .

FROM alpine:3.22
RUN apk add --no-cache ca-certificates
COPY --from=builder /build/tempo-proxy /tempo-proxy

# The OS packages are refreshed by a separate, bustable layer: the monthly
# rebuild passes --build-arg CACHE_BUST=<timestamp>, and a layer that takes
# that argument is the only one whose cache key changes.
#
# Position: after the expensive layers (what sits above it stays cached — a
# layer's cache key includes its parent), before the writes to package-owned
# paths (a package that moves would restore its own files over ours), and
# still root.
ARG CACHE_BUST=0
RUN CACHE_BUST=$CACHE_BUST apk upgrade --no-cache

USER 1000
EXPOSE 10429
ENTRYPOINT ["/tempo-proxy"]
