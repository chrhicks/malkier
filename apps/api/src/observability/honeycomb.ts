import { FetchHttpClient } from "@effect/platform"
import { Otlp } from "@effect/opentelemetry"
import { Layer, Redacted } from "effect"
import { getMalkierConfig } from "../config/malkier-config"

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
  headers: string | null
  apiKey: Redacted.Redacted | null
}) =>
  headers === null
    ? apiKey === null
      ? {}
      : { "x-honeycomb-team": Redacted.value(apiKey) }
    : parseHeaders(headers)

const observabilityConfig = getMalkierConfig().observability
const resolvedHeaders = resolveHeaders({
  headers: observabilityConfig.headers,
  apiKey: observabilityConfig.apiKey
})

export const HoneycombObservabilityLive = !observabilityConfig.enabled || Object.keys(resolvedHeaders).length === 0
  ? Layer.empty
  : Otlp.layerProtobuf({
      baseUrl: normalizeBaseUrl(observabilityConfig.endpoint),
      headers: resolvedHeaders,
      resource: {
        serviceName: observabilityConfig.serviceName,
        serviceVersion: observabilityConfig.serviceVersion ?? undefined,
        attributes: observabilityConfig.deploymentEnvironment === null
          ? undefined
          : {
              "deployment.environment": observabilityConfig.deploymentEnvironment
            }
      }
    }).pipe(Layer.provide(FetchHttpClient.layer))
