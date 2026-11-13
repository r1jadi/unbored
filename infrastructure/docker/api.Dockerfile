# The whole public API (services/cmd/standalone) as one small container.
# Build from the repository root:
#   docker build -f infrastructure/docker/api.Dockerfile -t unbored-api .
FROM golang:1.27-alpine AS build
WORKDIR /src
COPY packages/go/platform ./packages/go/platform
COPY services ./services
WORKDIR /src/services
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/standalone

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/api /api
ENV ENVIRONMENT=production SERVICE_NAME=api LOG_FORMAT=json LOG_LEVEL=info
EXPOSE 8080
ENTRYPOINT ["/api"]
