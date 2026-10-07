export interface PrCockpitOverlayProps {
  serverId: string;
  agentId: string | null;
  isPointerSuspended: boolean;
}

// PR Cockpit runs beside the desktop and browser app on the same machine; phones have no
// local PR Cockpit to frame.
export function PrCockpitOverlay(_props: PrCockpitOverlayProps): null {
  return null;
}
