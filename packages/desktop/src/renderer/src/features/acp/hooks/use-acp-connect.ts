import { useCallback, useState } from "react";
import { ORPCError } from "@orpc/client";
import { client } from "../../../orpc";
import { useAcpStore } from "../store";

export function useAcpConnect() {
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const setActiveConnectionId = useAcpStore((s) => s.setActiveConnectionId);
  const setAgentSessions = useAcpStore((s) => s.setAgentSessions);

  const connect = useCallback(
    async (agentId: string, cwd?: string) => {
      setConnecting(true);
      setConnectError(null);
      try {
        const { connectionId } = await client.acp.connect({ agentId, cwd });
        setActiveConnectionId(connectionId);

        // Fetch persisted sessions after connect
        client.acp
          .listSessions({ connectionId })
          .then(setAgentSessions)
          .catch(() => {});

        return { connectionId };
      } catch (error) {
        const message =
          error instanceof ORPCError || error instanceof Error
            ? error.message
            : "Failed to connect to agent.";
        setConnectError(message);
        throw error;
      } finally {
        setConnecting(false);
      }
    },
    [setActiveConnectionId, setAgentSessions],
  );

  return { connect, connecting, connectError };
}
