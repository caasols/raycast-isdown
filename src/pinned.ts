import { LocalStorage, showToast, Toast } from "@raycast/api";

export const BASE_URL = "https://isdown.app";

const STORAGE_KEY = "pinned-services";
const MAX_PINS = 10;

export interface ServiceItem {
  name: string;
  url: string;
  status: "ok" | "minor" | "major" | "maintenance";
}

interface ServiceResult {
  data: ServiceItem[];
}

export interface PinnedService {
  name: string;
  url: string;
}

export type PinnedStatus = ServiceItem["status"] | "loading" | "unavailable";

export async function getPinnedServices(): Promise<PinnedService[]> {
  const raw = await LocalStorage.getItem<string>(STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as PinnedService[];
  } catch {
    return [];
  }
}

export async function pinService(service: PinnedService): Promise<PinnedService[]> {
  const current = await getPinnedServices();
  if (current.some((s) => s.url === service.url)) return current;
  if (current.length >= MAX_PINS) {
    await showToast({ style: Toast.Style.Failure, title: "Maximum of 10 pinned services reached" });
    return current;
  }
  const updated = [...current, service];
  await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  return updated;
}

export async function unpinService(url: string): Promise<PinnedService[]> {
  const current = await getPinnedServices();
  if (!current.some((s) => s.url === url)) return current;
  const updated = current.filter((s) => s.url !== url);
  await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  return updated;
}

export async function fetchPinnedStatuses(pins: PinnedService[]): Promise<Record<string, PinnedStatus>> {
  const statuses: Record<string, PinnedStatus> = {};

  const results = await Promise.allSettled(
    pins.map(async (pin) => {
      const res = await fetch(`${BASE_URL}/api/public/v1/search.json?q=${encodeURIComponent(pin.name)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ServiceResult;
      const match = json.data.find((item) => item.url === pin.url);
      return { url: pin.url, status: match?.status };
    }),
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      statuses[result.value.url] = result.value.status ?? "unavailable";
    }
  }

  // Mark any pin not in statuses as unavailable
  for (const pin of pins) {
    if (!(pin.url in statuses)) {
      statuses[pin.url] = "unavailable";
    }
  }

  return statuses;
}
