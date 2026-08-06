export { AgentBrowserBridge, AGENT_BROWSER_ENV } from "./AgentBrowserBridge.ts";
export type {
  AgentBrowserBridgeOptions,
  AgentBrowserLaunchCoordinator,
  PreparedAgentBrowserPtyLaunch,
  PrepareAgentBrowserLaunchInput
} from "./AgentBrowserBridge.ts";
export {
  AgentGateway,
  WINDOWS_AGENT_GATEWAY_UNAVAILABLE,
  supportsAgentGatewayPlatform
} from "./AgentGateway.ts";
export type { AgentGatewayOptions, RegisterAgentInput } from "./AgentGateway.ts";
export {
  WindowsPipeHostTransport,
  WINDOWS_PIPE_HOST_FILENAME,
  WINDOWS_PIPE_RELAY_PROTOCOL
} from "./WindowsPipeHostTransport.ts";
export type {
  AgentGatewaySocket,
  WindowsPipeHostTransportOptions
} from "./WindowsPipeHostTransport.ts";
export type { BrowserCoreLike } from "./protocol.ts";
