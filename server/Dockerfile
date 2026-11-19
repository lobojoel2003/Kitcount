# syntax=docker/dockerfile:1.7
# Kitcount sync server — small, static, non-root image.

FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS build
ARG TARGETOS
ARG TARGETARCH
ARG VERSION=dev
ARG BUILD=0
ARG COMMIT=unknown
ARG DATE=unknown
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath \
      -ldflags "-s -w \
        -X github.com/lobojoel2003/Kitcount/server/internal/version.Version=${VERSION} \
        -X github.com/lobojoel2003/Kitcount/server/internal/version.Build=${BUILD} \
        -X github.com/lobojoel2003/Kitcount/server/internal/version.Commit=${COMMIT} \
        -X github.com/lobojoel2003/Kitcount/server/internal/version.Date=${DATE}" \
      -o /out/kitcount-server ./cmd/kitcount-server

FROM gcr.io/distroless/static-debian12:nonroot
ARG VERSION=dev
ARG COMMIT=unknown
LABEL org.opencontainers.image.title="kitcount-server" \
      org.opencontainers.image.description="Zero-knowledge sync server for the Kitcount syringe services program app" \
      org.opencontainers.image.source="https://github.com/lobojoel2003/Kitcount" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${COMMIT}"
COPY --from=build /out/kitcount-server /usr/local/bin/kitcount-server
USER nonroot:nonroot
EXPOSE 8080
ENV KITCOUNT_LISTEN=:8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/usr/local/bin/kitcount-server", "healthcheck"]
ENTRYPOINT ["/usr/local/bin/kitcount-server"]
CMD ["serve"]
