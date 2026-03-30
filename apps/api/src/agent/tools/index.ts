import { RepoInspectionToolkit, makeRepoInspectionToolkitLayer } from "./file-tools";
import { ShellToolkit, makeShellToolkitLayer } from "./shell-tools";
import { SessionToolkit, makeSessionToolkitLayer } from "./session-tools";
import { Toolkit } from "@effect/ai";
import type { SessionService } from "../../service/session.service";
import { Effect, Layer } from "effect";

const AgentToolkit = Toolkit.merge(RepoInspectionToolkit, Toolkit.merge(ShellToolkit, SessionToolkit))

export const getAgentTools = (userId: string, sessionService: SessionService) =>
  AgentToolkit.pipe(
    Effect.provide(
      Layer.mergeAll(
        makeRepoInspectionToolkitLayer(),
        makeSessionToolkitLayer(userId, sessionService),
        makeShellToolkitLayer()
      )
    )
  )
