import { FetchHttpClient } from "@effect/platform"
import { Otlp } from "@effect/opentelemetry"
import { Config, Effect, Layer, Option, Redacted } from "effect"

const signalPathPattern = /\/v1\/(?:traces|metrics|logs)$/

const normalizeBaseUrl = (endpoint: string) =>
  endpoint.trim().replace(/\/+$/, "").replace(signalPathPattern, "")

const parseHeaders = (headers: string): Record<string, string> =>
  Object.fromEntries(
    headers
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .flatMap((entry) => {
        const separator = entry.indexOf("=")

        if (separator <= 0) {
          return []
        }

        const key = entry.slice(0, separator).trim()
        const value = entry.slice(separator + 1).trim()

        if (key.length === 0 || value.length === 0) {
          return []
        }

        return [[key, value] as const]
      })
  )

const resolveHeaders = ({
  headers,
  apiKey
}: {
  headers: Option.Option<string>
  apiKey: Option.Option<Redacted.Redacted>
}) =>
  Option.match(headers, {
    onNone: () =>
      Option.match(apiKey, {
        onNone: () => ({}),
        onSome: (value) => ({ "x-honeycomb-team": Redacted.value(value) })
      }),
    onSome: parseHeaders
  })

export const HoneycombObservabilityLive = Layer.unwrapEffect(
  Config.all({
    endpoint: Config.string("OTEL_EXPORTER_OTLP_ENDPOINT").pipe(
      Config.withDefault("https://api.honeycomb.io")
    ),
    serviceName: Config.string("OTEL_SERVICE_NAME").pipe(
      Config.withDefault("malkier-api")
    ),
    headers: Config.option(Config.string("OTEL_EXPORTER_OTLP_HEADERS")),
    apiKey: Config.option(Config.redacted("HONEYCOMB_API_KEY"))
  }).pipe(
    Effect.map(({ endpoint, serviceName, headers, apiKey }) => {
      const deploymentEnvironment = Bun.env.DEPLOYMENT_ENVIRONMENT ?? Bun.env.NODE_ENV
      const serviceVersion = Bun.env.OTEL_SERVICE_VERSION ?? Bun.env.npm_package_version
      const resolvedHeaders = resolveHeaders({ headers, apiKey })

      if (Object.keys(resolvedHeaders).length === 0) {
        return Layer.empty
      }

      return Otlp.layerProtobuf({
        baseUrl: normalizeBaseUrl(endpoint),
        headers: resolvedHeaders,
        resource: {
          serviceName,
          serviceVersion,
          attributes: deploymentEnvironment === undefined
            ? undefined
            : {
                "deployment.environment": deploymentEnvironment
              }
        }
      }).pipe(Layer.provide(FetchHttpClient.layer))
    })
  )
)
