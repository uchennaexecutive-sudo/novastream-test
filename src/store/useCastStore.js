import { create } from "zustand";
import { invoke, isTauri } from "@tauri-apps/api/core";

const CAST_SESSION_POLL_MS = 5000;
let castSessionPollTimer = null;

const normalizeCastSession = (session) =>
  session?.connected
    ? {
        connected: true,
        device: session.device || null,
        relayId: session.relayId || null,
        relayUrl: session.relayUrl || null,
        playerState: session.playerState || null,
      }
    : null;

const stopCastSessionMonitor = () => {
  if (castSessionPollTimer) {
    window.clearInterval(castSessionPollTimer);
    castSessionPollTimer = null;
  }
};

const startCastSessionMonitor = (refresh) => {
  if (typeof window === "undefined" || castSessionPollTimer) return;

  castSessionPollTimer = window.setInterval(() => {
    void refresh();
  }, CAST_SESSION_POLL_MS);
};

const mergeDevices = (devices = [], activeDevice = null) => {
  const map = new Map();

  for (const device of Array.isArray(devices) ? devices : []) {
    if (!device?.id) continue;
    map.set(device.id, device);
  }

  if (activeDevice?.id && !map.has(activeDevice.id)) {
    map.set(activeDevice.id, activeDevice);
  }

  return Array.from(map.values()).sort((left, right) =>
    String(left?.name || "").localeCompare(String(right?.name || "")),
  );
};

const useCastStore = create((set, get) => ({
  castStatus: "idle",
  castDevices: [],
  activeCastDevice: null,
  activeCastSession: null,
  castError: null,
  castRelayStatus: null,
  preparedCastMedia: null,
  lastPreparedCastPayload: null,
  discoveryPending: false,

  refreshRelayStatus: async () => {
    if (!isTauri()) {
      set({ castRelayStatus: null });
      return null;
    }

    try {
      const relayStatus = await invoke("get_cast_relay_status");
      set({ castRelayStatus: relayStatus || null });
      return relayStatus || null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({
        castRelayStatus: null,
        castError: message || "Cast relay is unavailable",
      });
      return null;
    }
  },

  refreshCastSessionStatus: async () => {
    if (!isTauri()) {
      stopCastSessionMonitor();
      set({ activeCastSession: null, activeCastDevice: null });
      return null;
    }

    try {
      const previousSession = get().activeCastSession;
      const response = await invoke("get_cast_session_status");
      const session = normalizeCastSession(response);

      if (session) {
        startCastSessionMonitor(() => get().refreshCastSessionStatus());
      } else {
        stopCastSessionMonitor();
      }

      set((state) => {
        if (session) {
          return {
            activeCastSession: session,
            activeCastDevice: session.device || null,
            castStatus:
              state.castStatus === "discovering" ||
              state.castStatus === "connecting"
                ? state.castStatus
                : "casting",
            castError: null,
          };
        }

        const interruptionMessage =
          response?.errorMessage ||
          "Casting was interrupted. Keep playback open and reconnect.";
        const hadSession = Boolean(previousSession);

        return {
          activeCastSession: null,
          activeCastDevice: null,
          castStatus: hadSession
            ? "error"
            : state.castStatus === "discovering" ||
                state.castStatus === "connecting"
              ? state.castStatus
              : "idle",
          castError: hadSession ? interruptionMessage : null,
        };
      });

      return session;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const hadSession = Boolean(get().activeCastSession);
      stopCastSessionMonitor();
      set({
        activeCastSession: null,
        activeCastDevice: null,
        castStatus: hadSession ? "error" : "idle",
        castError:
          message ||
          (hadSession
            ? "Casting was interrupted. Keep playback open and reconnect."
            : "Could not read cast session state"),
      });
      return null;
    }
  },

  prepareCastMedia: async (payload = {}) => {
    if (!isTauri()) {
      set({
        preparedCastMedia: null,
        castRelayStatus: null,
        lastPreparedCastPayload: null,
        discoveryPending: false,
      });
      return null;
    }

    const hasStreamUrl = Boolean(String(payload?.streamUrl || "").trim());
    const hasFilePath = Boolean(String(payload?.filePath || "").trim());

    if (!hasStreamUrl && !hasFilePath) {
      set({
        preparedCastMedia: null,
        lastPreparedCastPayload: null,
        discoveryPending: false,
      });
      return null;
    }

    try {
      const previousPreparedRelayId = String(
        get().preparedCastMedia?.relayId || "",
      ).trim();
      const prepared = await invoke("prepare_cast_media", { payload });
      set({
        preparedCastMedia: prepared || null,
        castRelayStatus: prepared?.relayStatus || null,
        lastPreparedCastPayload: payload,
        castError: null,
      });

      if (prepared?.relayUrl && get().discoveryPending) {
        set({ discoveryPending: false });
        window.setTimeout(() => {
          void get().startDiscovery();
        }, 0);
      }

      const nextPreparedRelayId = String(prepared?.relayId || "").trim();
      if (
        previousPreparedRelayId &&
        nextPreparedRelayId &&
        previousPreparedRelayId !== nextPreparedRelayId
      ) {
        invoke("clear_cast_relay", { relayId: previousPreparedRelayId }).catch(
          () => {},
        );
      }

      return prepared || null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({
        preparedCastMedia: null,
        castError: message || "Could not prepare this stream for casting",
      });
      return null;
    }
  },

  clearPreparedCastMedia: async () => {
    const { preparedCastMedia, castRelayStatus, activeCastSession } = get();

    const activeRelayId = String(activeCastSession?.relayId || "").trim();
    const preparedRelayId = String(preparedCastMedia?.relayId || "").trim();
    if (!preparedRelayId) {
      set({
        preparedCastMedia: null,
        lastPreparedCastPayload: null,
        discoveryPending: false,
      });
      return castRelayStatus || null;
    }

    if (activeRelayId && preparedRelayId && activeRelayId === preparedRelayId) {
      return castRelayStatus || null;
    }

    if (isTauri()) {
      try {
        const relayStatus = await invoke("clear_cast_relay", {
          relayId: preparedCastMedia?.relayId || null,
        });
        set({
          preparedCastMedia: null,
          castRelayStatus: relayStatus || null,
          lastPreparedCastPayload: null,
          discoveryPending: false,
        });
        return relayStatus || null;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        set({
          preparedCastMedia: null,
          lastPreparedCastPayload: null,
          castError: message || "Failed to clear cast relay",
          discoveryPending: false,
        });
        return null;
      }
    }

    set({
      preparedCastMedia: null,
      castRelayStatus: null,
      lastPreparedCastPayload: null,
      discoveryPending: false,
    });
    return null;
  },

  startDiscovery: async () => {
    set({ castDevices: [], castError: null });
    const preparedCastMedia = get().preparedCastMedia;

    if (!preparedCastMedia?.relayUrl) {
      set({
        castStatus: "idle",
        discoveryPending: true,
      });
      return [];
    }

    set({ castStatus: "discovering", discoveryPending: false });

    const relayStatus = await get().refreshRelayStatus();

    if (!relayStatus?.relayReady) {
      set({
        castStatus: "error",
        castError: "Cast relay is unavailable on this device right now.",
      });
      return [];
    }

    const activeSession = await get().refreshCastSessionStatus();

    try {
      const discoveredDevices = isTauri()
        ? await invoke("discover_cast_devices")
        : [];
      const devices = mergeDevices(
        discoveredDevices || [],
        activeSession?.device || get().activeCastDevice,
      );

      set({
        castDevices: devices,
        castStatus: activeSession ? "casting" : "idle",
        castError: null,
      });

      return devices;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({
        castStatus: "error",
        castDevices: [],
        castError: message || "Could not discover cast devices on this network",
      });
      return [];
    }
  },

  stopDiscovery: () => {
    const { castStatus, activeCastSession, preparedCastMedia } = get();
    if (castStatus === "discovering") {
      set({ castStatus: activeCastSession ? "casting" : "idle" });
    }
    if (!preparedCastMedia?.relayUrl) {
      set({ discoveryPending: false });
    }
  },

  addCastDevice: (device) => {
    set((state) => ({
      castDevices: mergeDevices(
        [...state.castDevices, device],
        state.activeCastDevice,
      ),
    }));
  },

  connectDevice: async (device) => {
    if (!isTauri()) {
      set({
        castStatus: "error",
        castError: "Casting is only available in the desktop app.",
      });
      return null;
    }

    const { preparedCastMedia, activeCastSession } = get();
    if (!preparedCastMedia?.relayUrl) {
      set({
        castStatus: "error",
        castError:
          "This stream is not ready for casting yet. Keep playback open and try again.",
        discoveryPending: false,
      });
      return null;
    }

    if (
      activeCastSession?.device?.id === device?.id &&
      activeCastSession?.relayUrl === preparedCastMedia.relayUrl
    ) {
      set({
        castStatus: "casting",
        activeCastDevice: activeCastSession.device,
        castError: null,
      });
      return activeCastSession;
    }

    if (
      activeCastSession?.device?.id &&
      activeCastSession.device.id !== device?.id
    ) {
      await get().disconnectDevice({ preservePreparedMedia: true });
    }

    set({ castStatus: "connecting", castError: null });

    try {
      const session = normalizeCastSession(
        await invoke("connect_cast_device", {
          payload: {
            device,
            relayId: preparedCastMedia.relayId,
            relayUrl: preparedCastMedia.relayUrl,
            relayKind: preparedCastMedia.relayKind,
            contentType: preparedCastMedia.contentType || null,
            title: preparedCastMedia.title || null,
            imageUrl: preparedCastMedia.imageUrl || null,
            autoplay: true,
          },
        }),
      );

      set((state) => ({
        activeCastSession: session,
        activeCastDevice: session?.device || device,
        castDevices: mergeDevices(state.castDevices, session?.device || device),
        castStatus: session ? "casting" : "idle",
        castError: null,
      }));

      if (session) {
        startCastSessionMonitor(() => get().refreshCastSessionStatus());
      }

      return session;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stopCastSessionMonitor();
      set({
        castStatus: "error",
        castError: message || "Could not connect to this cast device",
      });
      return null;
    }
  },

  disconnectDevice: async (_options = {}) => {
    const { activeCastSession } = get();

    if (!isTauri() || !activeCastSession) {
      stopCastSessionMonitor();
      set({
        castStatus: "idle",
        activeCastDevice: null,
        activeCastSession: null,
        castError: null,
      });
      return null;
    }

    try {
      stopCastSessionMonitor();
      await invoke("disconnect_cast_device");
      const relayStatus = await get().refreshRelayStatus();

      set((state) => ({
        activeCastSession: null,
        activeCastDevice: null,
        castStatus: "idle",
        castError: null,
        castRelayStatus: relayStatus || state.castRelayStatus,
      }));

      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stopCastSessionMonitor();
      set({
        castStatus: "idle",
        activeCastDevice: null,
        activeCastSession: null,
        castError: message || null,
      });
      return null;
    }
  },

  setCasting: (device) => {
    if (device) {
      startCastSessionMonitor(() => get().refreshCastSessionStatus());
    } else {
      stopCastSessionMonitor();
    }
    set({
      castStatus: "casting",
      activeCastDevice: device || null,
      activeCastSession: device
        ? {
            connected: true,
            device,
            relayId: null,
            relayUrl: null,
            playerState: null,
          }
        : null,
      castError: null,
    });
  },

  setCastError: (message) => {
    set({ castStatus: "error", castError: message || "Cast failed" });
  },

  clearCastError: () => {
    set((state) => ({
      castError: null,
      castStatus: state.activeCastSession ? "casting" : "idle",
    }));
  },
}));

export default useCastStore;
