import { showHUD } from "@raycast/api";
import { getPinnedServices, fetchPinnedStatuses, PinnedStatus } from "./pinned";

export default async function Command() {
  const pins = await getPinnedServices();

  if (pins.length === 0) {
    await showHUD("No pinned services — open IsDown to pin some");
    return;
  }

  const statuses = await fetchPinnedStatuses(pins);

  const issues: string[] = [];
  for (const pin of pins) {
    const status = statuses[pin.url] ?? "unavailable";
    if (status !== "ok" && status !== "loading") {
      issues.push(`${pin.name} (${status})`);
    }
  }

  if (issues.length === 0) {
    await showHUD(`✅ All ${pins.length} services operational`);
  } else {
    await showHUD(`⚠️ ${issues.length} of ${pins.length} with issues: ${issues.join(", ")}`);
  }
}
