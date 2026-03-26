import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { List, Icon, Color, Action, ActionPanel, Keyboard, getPreferenceValues } from "@raycast/api";
import { showFailureToast, useFetch } from "@raycast/utils";
import {
  BASE_URL,
  ServiceItem,
  PinnedService,
  PinnedStatus,
  getPinnedServices,
  pinService,
  unpinService,
  fetchPinnedStatuses,
} from "./pinned";

const STATUS_SEVERITY: Record<PinnedStatus, number> = {
  major: 0,
  minor: 1,
  maintenance: 2,
  ok: 3,
  loading: 4,
  unavailable: 5,
};

function withUtm(href: string): string {
  const url = new URL(href);
  url.searchParams.set("utm_source", "raycast1.1");
  return url.toString();
}

function getStatusIcon(status: ServiceItem["status"]) {
  switch (status) {
    case "ok":
      return { source: Icon.CircleFilled, tintColor: Color.Green };
    case "minor":
      return { source: Icon.CircleFilled, tintColor: Color.Orange };
    case "major":
      return { source: Icon.CircleFilled, tintColor: Color.Red };
    default:
      return { source: Icon.CircleFilled, tintColor: Color.Blue };
  }
}

function getStatusAccessory(status: ServiceItem["status"]): List.Item.Accessory {
  switch (status) {
    case "ok":
      return { text: { value: "Operational", color: Color.Green } };
    case "minor":
      return { text: { value: "Minor Outage", color: Color.Orange }, icon: Icon.ExclamationMark };
    case "major":
      return { text: { value: "Major Outage", color: Color.Red }, icon: Icon.ExclamationMark };
    default:
      return { text: { value: "Maintenance", color: Color.Blue } };
  }
}

function getPinnedStatusIcon(status: PinnedStatus) {
  if (status === "loading") {
    return { source: Icon.Circle, tintColor: Color.SecondaryText };
  }
  if (status === "unavailable") {
    return { source: Icon.QuestionMarkCircle, tintColor: Color.SecondaryText };
  }
  return getStatusIcon(status);
}

function getPinnedStatusAccessory(status: PinnedStatus): List.Item.Accessory {
  if (status === "loading") {
    return { text: { value: "Loading…", color: Color.SecondaryText } };
  }
  if (status === "unavailable") {
    return { text: { value: "Status unavailable", color: Color.SecondaryText } };
  }
  return getStatusAccessory(status);
}

function ServiceListItem({
  name,
  url,
  status,
  isPinned,
  onPin,
  onUnpin,
}: {
  name: string;
  url: string;
  status: ServiceItem["status"] | PinnedStatus;
  isPinned: boolean;
  onPin: (service: PinnedService) => void;
  onUnpin: (url: string) => void;
}) {
  const icon = isPinned ? getPinnedStatusIcon(status as PinnedStatus) : getStatusIcon(status as ServiceItem["status"]);
  const accessory = isPinned
    ? getPinnedStatusAccessory(status as PinnedStatus)
    : getStatusAccessory(status as ServiceItem["status"]);

  return (
    <List.Item
      key={url}
      title={name}
      icon={icon}
      accessories={[accessory]}
      actions={
        <ActionPanel title={`Check ${name} Status`}>
          <Action.OpenInBrowser url={withUtm(`${BASE_URL}${url}`)} />
          {isPinned ? (
            <Action
              title="Unpin Service"
              icon={Icon.PinDisabled}
              shortcut={Keyboard.Shortcut.Common.Pin}
              onAction={() => onUnpin(url)}
            />
          ) : (
            <Action
              title="Pin Service"
              icon={Icon.Pin}
              shortcut={Keyboard.Shortcut.Common.Pin}
              onAction={() => onPin({ name, url })}
            />
          )}
        </ActionPanel>
      }
    />
  );
}

export default function Command() {
  const [searchText, setSearchText] = useState("");
  const [pinnedServices, setPinnedServices] = useState<PinnedService[]>([]);
  const [pinnedStatuses, setPinnedStatuses] = useState<Record<string, PinnedStatus>>({});
  const [pinnedLoading, setPinnedLoading] = useState(true);
  const initialFetchDone = useRef(false);

  const {
    isLoading: isSearchLoading,
    data: searchData,
    error: searchError,
  } = useFetch(`${BASE_URL}/api/public/v1/search.json?q=${encodeURIComponent(searchText)}`, {
    execute: searchText.length >= 2,
    mapResult(result: { data: ServiceItem[] }) {
      return { data: result.data };
    },
    keepPreviousData: true,
    onError(error) {
      showFailureToast(error, { title: "Failed to load services" });
    },
  });

  const {
    isLoading: isPopularLoading,
    data: popularData,
    error: popularError,
  } = useFetch(`${BASE_URL}/api/public/v1/search/popular.json`, {
    execute: searchText.length < 2,
    mapResult(result: { data: ServiceItem[] }) {
      return { data: result.data };
    },
  });

  // Load pinned services from storage once on mount
  useEffect(() => {
    (async () => {
      try {
        const pins = await getPinnedServices();
        setPinnedServices(pins);
        if (pins.length === 0) {
          setPinnedLoading(false);
        }
      } catch {
        setPinnedLoading(false);
      }
    })();
  }, []);

  // Fetch statuses on initial load, using popular data to optimize when available
  useEffect(() => {
    if (initialFetchDone.current) return;
    if (pinnedServices.length === 0) return;

    let aborted = false;

    (async () => {
      const popularMap = new Map((popularData ?? []).map((s) => [s.url, s.status]));
      const needsFetch: PinnedService[] = [];
      const knownStatuses: Record<string, PinnedStatus> = {};

      for (const pin of pinnedServices) {
        const popularStatus = popularMap.get(pin.url);
        if (popularStatus) {
          knownStatuses[pin.url] = popularStatus;
        } else {
          needsFetch.push(pin);
        }
      }

      // If some pins aren't in popular and popular hasn't loaded yet, wait for it
      if (needsFetch.length > 0 && !popularData) {
        // Popular data not yet available — fetch all pins directly
        const fetched = await fetchPinnedStatuses(pinnedServices);
        if (aborted) return;
        setPinnedStatuses(fetched);
      } else {
        if (needsFetch.length > 0) {
          const fetched = await fetchPinnedStatuses(needsFetch);
          if (aborted) return;
          Object.assign(knownStatuses, fetched);
        }
        setPinnedStatuses(knownStatuses);
      }

      initialFetchDone.current = true;
      setPinnedLoading(false);
    })();

    return () => {
      aborted = true;
    };
  }, [pinnedServices, popularData]);

  const pinnedUrlSet = useMemo(() => new Set(pinnedServices.map((s) => s.url)), [pinnedServices]);

  const handlePin = useCallback(async (service: PinnedService) => {
    const updated = await pinService(service);
    setPinnedServices(updated);
    try {
      const statuses = await fetchPinnedStatuses([service]);
      setPinnedStatuses((prev) => ({ ...prev, ...statuses }));
    } catch {
      setPinnedStatuses((prev) => ({ ...prev, [service.url]: "unavailable" }));
      showFailureToast(new Error("Could not fetch status"), { title: `Failed to load ${service.name} status` });
    }
  }, []);

  const handleUnpin = useCallback(async (url: string) => {
    const updated = await unpinService(url);
    setPinnedServices(updated);
    setPinnedStatuses((prev) => {
      const next = { ...prev };
      delete next[url];
      return next;
    });
  }, []);

  const isLoading = isSearchLoading || isPopularLoading || pinnedLoading;

  const { pinnedSortOrder = "alphabetical" } = getPreferenceValues<{ pinnedSortOrder: string }>();

  const sortedPinned = useMemo(() => {
    const visible =
      searchText.length >= 2
        ? pinnedServices.filter((p) => p.name.toLowerCase().includes(searchText.toLowerCase()))
        : pinnedServices;
    return [...visible].sort((a, b) => {
      if (pinnedSortOrder === "severity") {
        const aStatus = pinnedStatuses[a.url] ?? "loading";
        const bStatus = pinnedStatuses[b.url] ?? "loading";
        const diff = STATUS_SEVERITY[aStatus] - STATUS_SEVERITY[bStatus];
        if (diff !== 0) return diff;
      }
      return a.name.localeCompare(b.name);
    });
  }, [pinnedServices, pinnedStatuses, searchText, pinnedSortOrder]);

  const filteredPopular = useMemo(
    () => (popularData ?? []).filter((item) => !pinnedUrlSet.has(item.url)),
    [popularData, pinnedUrlSet],
  );

  const filteredSearch = useMemo(
    () => (searchData ?? []).filter((item) => !pinnedUrlSet.has(item.url)),
    [searchData, pinnedUrlSet],
  );

  return (
    <List
      isLoading={isLoading}
      searchText={searchText}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search cloud providers…"
      throttle
    >
      {(searchError || popularError) && (
        <List.EmptyView title="Failed to load services" description={(searchError ?? popularError)?.message} />
      )}
      {sortedPinned.length > 0 && (
        <List.Section title="Pinned">
          {sortedPinned.map((pin) => (
            <ServiceListItem
              key={pin.url}
              name={pin.name}
              url={pin.url}
              status={pinnedStatuses[pin.url] ?? "loading"}
              isPinned={true}
              onPin={handlePin}
              onUnpin={handleUnpin}
            />
          ))}
        </List.Section>
      )}
      {searchText.length < 2 ? (
        <List.Section title="Popular Services">
          {filteredPopular.map((item) => (
            <ServiceListItem
              key={item.url}
              name={item.name}
              url={item.url}
              status={item.status}
              isPinned={false}
              onPin={handlePin}
              onUnpin={handleUnpin}
            />
          ))}
        </List.Section>
      ) : (
        <List.Section title="Search Results">
          {filteredSearch.map((item) => (
            <ServiceListItem
              key={item.url}
              name={item.name}
              url={item.url}
              status={item.status}
              isPinned={false}
              onPin={handlePin}
              onUnpin={handleUnpin}
            />
          ))}
        </List.Section>
      )}
    </List>
  );
}
