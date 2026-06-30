export const OPENCLAW_AGENT_REPO_HINT = "See solavrc/openclaw-even-g2-node.";

export function setupOpenClawAskRequest(gatewayUrl = "") {
  const targetGatewayUrl = gatewayUrl.trim();
  if (targetGatewayUrl) return `Hey Claw, show my Even G2 setup QR for ${targetGatewayUrl}. ${OPENCLAW_AGENT_REPO_HINT}`;
  return `Hey Claw, show my Even G2 setup QR. ${OPENCLAW_AGENT_REPO_HINT}`;
}

export function approvalOpenClawAskRequest(kind: "device" | "operator" | "node") {
  if (kind === "node") return `Hey Claw, approve remaining Even G2 node tools. ${OPENCLAW_AGENT_REPO_HINT}`;
  if (kind === "operator") return `Hey Claw, approve remaining Even G2 operator requests. ${OPENCLAW_AGENT_REPO_HINT}`;
  return `Hey Claw, approve my pending Even G2 setup. ${OPENCLAW_AGENT_REPO_HINT}`;
}
