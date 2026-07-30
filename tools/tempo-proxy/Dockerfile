FROM golang:1.24-alpine AS builder
WORKDIR /build
COPY go.mod ./
RUN go mod download
COPY main.go .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o tempo-proxy .

FROM alpine:3.21
RUN apk add --no-cache ca-certificates
COPY --from=builder /build/tempo-proxy /tempo-proxy
USER 1000
EXPOSE 10429
ENTRYPOINT ["/tempo-proxy"]
