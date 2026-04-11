#!/usr/bin/env node

const { Client, DefaultMediaReceiver } = require("castv2-client");
const createMdns = require("multicast-dns");

const GOOGLECAST_SERVICE = "_googlecast._tcp.local";
const DISCOVERY_INTERVAL_MS = 900;
const DEFAULT_DISCOVERY_TIMEOUT_MS = 3200;
const DEFAULT_CONNECT_TIMEOUT_MS = 20000;
const DEFAULT_DISCONNECT_TIMEOUT_MS = 12000;

function readStdinJson() {
  return new Promise((resolve, reject) => {
    let buffer = "";

    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buffer += chunk;
    });
    process.stdin.on("end", () => {
      const trimmed = buffer.trim();
      if (!trimmed) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(trimmed));
      } catch (error) {
        reject(new Error(`Invalid bridge JSON payload: ${error.message}`));
      }
    });
    process.stdin.on("error", (error) => reject(error));
  });
}

function writeJson(value) {
  process.stdout.write(JSON.stringify(value));
}

function stripTrailingDot(value) {
  return String(value || "").replace(/\.$/, "");
}

function normalizeDeviceName(value) {
  return stripTrailingDot(value)
    .replace(/\._googlecast\._tcp\.local$/i, "")
    .trim();
}

function isIpv4(value) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(String(value || "").trim());
}

function parseTxtRecords(entries) {
  const output = {};

  for (const entry of Array.isArray(entries) ? entries : []) {
    const text = Buffer.isBuffer(entry)
      ? entry.toString("utf8")
      : String(entry || "");
    const separatorIndex = text.indexOf("=");

    if (separatorIndex <= 0) {
      if (text) output[text] = true;
      continue;
    }

    const key = text.slice(0, separatorIndex).trim();
    const value = text.slice(separatorIndex + 1).trim();
    if (key) output[key] = value;
  }

  return output;
}

function promiseWithTimeout(factory, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutHandle = null;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      callback(value);
    };

    timeoutHandle = setTimeout(() => {
      finish(reject, new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    factory(
      (value) => finish(resolve, value),
      (error) =>
        finish(
          reject,
          error instanceof Error ? error : new Error(String(error || label)),
        ),
    );
  });
}

function safeCloseClient(client) {
  if (!client || typeof client.close !== "function") return;
  try {
    client.close();
  } catch (_) {}
}

function connectClient({ host, port, timeoutMs }) {
  return promiseWithTimeout(
    (resolve, reject) => {
      const client = new Client();

      client.once("error", (error) => {
        safeCloseClient(client);
        reject(error);
      });

      client.connect({ host, port: Number(port) || 8009 }, () =>
        resolve(client),
      );
    },
    timeoutMs,
    "Chromecast connection",
  );
}

function launchReceiver(client, timeoutMs) {
  return promiseWithTimeout(
    (resolve, reject) => {
      client.launch(DefaultMediaReceiver, (error, player) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(player);
      });
    },
    timeoutMs,
    "Chromecast receiver launch",
  );
}

function loadReceiver(player, media, options, timeoutMs) {
  return promiseWithTimeout(
    (resolve, reject) => {
      player.load(media, options, (error, status) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(status || null);
      });
    },
    timeoutMs,
    "Chromecast media load",
  );
}

function getReceiverSessions(client, timeoutMs) {
  return promiseWithTimeout(
    (resolve, reject) => {
      client.getSessions((error, sessions) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(Array.isArray(sessions) ? sessions : []);
      });
    },
    timeoutMs,
    "Chromecast session query",
  );
}

function joinReceiverSession(client, session, timeoutMs) {
  return promiseWithTimeout(
    (resolve, reject) => {
      client.join(session, DefaultMediaReceiver, (error, player) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(player);
      });
    },
    timeoutMs,
    "Chromecast session join",
  );
}

function getReceiverStatus(player, timeoutMs) {
  return promiseWithTimeout(
    (resolve, reject) => {
      player.getStatus((error, status) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(status || null);
      });
    },
    timeoutMs,
    "Chromecast status query",
  );
}

function stopReceiver(client, player, timeoutMs) {
  return promiseWithTimeout(
    (resolve, reject) => {
      client.stop(player, (error, applications) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(Array.isArray(applications) ? applications : []);
      });
    },
    timeoutMs,
    "Chromecast disconnect",
  );
}

function findDefaultMediaSession(sessions = []) {
  return (
    (Array.isArray(sessions) ? sessions : []).find(
      (session) => session && session.appId === DefaultMediaReceiver.APP_ID,
    ) || null
  );
}

async function discoverDevices(payload = {}) {
  const timeoutMs = Math.max(
    1200,
    Number(payload.timeoutMs) || DEFAULT_DISCOVERY_TIMEOUT_MS,
  );
  const mdns = createMdns();
  const instances = new Map();
  const hostAddresses = new Map();
  const queriedHosts = new Set();

  const ensureInstance = (instanceName) => {
    const key = stripTrailingDot(instanceName);
    const existing = instances.get(key);
    if (existing) return existing;

    const created = {
      instanceName: key,
      name: normalizeDeviceName(key),
      port: null,
      hostName: null,
      addresses: [],
      txt: {},
    };
    instances.set(key, created);
    return created;
  };

  const applyHostAddresses = (hostName) => {
    const key = stripTrailingDot(hostName);
    const entry = hostAddresses.get(key);
    if (!entry) return;

    for (const device of instances.values()) {
      if (device.hostName === key) {
        device.addresses = Array.from(new Set(entry));
      }
    }
  };

  const queryHost = (hostName) => {
    const key = stripTrailingDot(hostName);
    if (!key || queriedHosts.has(key)) return;
    queriedHosts.add(key);

    try {
      mdns.query([
        { name: key, type: "A" },
        { name: key, type: "AAAA" },
      ]);
    } catch (_) {}
  };

  const handleRecord = (record) => {
    const name = stripTrailingDot(record?.name);
    const type = String(record?.type || "").toUpperCase();

    if (!name || !type) return;

    if (type === "PTR") {
      const instanceName = stripTrailingDot(record.data);
      if (name === GOOGLECAST_SERVICE && instanceName) {
        ensureInstance(instanceName);
      }
      return;
    }

    if (type === "SRV") {
      const device = ensureInstance(name);
      const hostName = stripTrailingDot(record.data?.target);
      device.port = Number(record.data?.port) || 8009;
      device.hostName = hostName || device.hostName;
      if (hostName) {
        applyHostAddresses(hostName);
        queryHost(hostName);
      }
      return;
    }

    if (type === "TXT") {
      const device = ensureInstance(name);
      device.txt = { ...device.txt, ...parseTxtRecords(record.data) };
      if (device.txt.fn) {
        device.name = String(device.txt.fn).trim() || device.name;
      }
      return;
    }

    if (type === "A" || type === "AAAA") {
      const hostName = stripTrailingDot(name);
      const address = stripTrailingDot(record.data);
      if (!address) return;

      const addresses = hostAddresses.get(hostName) || [];
      if (!addresses.includes(address)) {
        addresses.push(address);
        hostAddresses.set(hostName, addresses);
      }
      applyHostAddresses(hostName);
    }
  };

  const responseHandler = (response) => {
    const records = [
      ...(Array.isArray(response?.answers) ? response.answers : []),
      ...(Array.isArray(response?.additionals) ? response.additionals : []),
    ];

    for (const record of records) {
      handleRecord(record);
    }
  };

  mdns.on("response", responseHandler);

  const queryTimer = setInterval(() => {
    try {
      mdns.query({
        questions: [{ name: GOOGLECAST_SERVICE, type: "PTR" }],
      });
    } catch (_) {}
  }, DISCOVERY_INTERVAL_MS);

  try {
    mdns.query({
      questions: [{ name: GOOGLECAST_SERVICE, type: "PTR" }],
    });
  } catch (_) {}

  await new Promise((resolve) => setTimeout(resolve, timeoutMs));

  clearInterval(queryTimer);
  try {
    mdns.destroy();
  } catch (_) {}

  const devices = Array.from(instances.values())
    .map((entry) => {
      const selectedAddress =
        entry.addresses.find((value) => isIpv4(value)) ||
        entry.addresses[0] ||
        entry.hostName;
      if (!selectedAddress || !entry.port) return null;

      const txt = entry.txt || {};
      const id = String(txt.id || `${selectedAddress}:${entry.port}`).trim();
      const name = String(txt.fn || entry.name || selectedAddress).trim();

      return {
        id,
        name: name || selectedAddress,
        type: "chromecast",
        host: selectedAddress,
        port: Number(entry.port) || 8009,
        modelName: txt.md ? String(txt.md) : null,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.name.localeCompare(right.name));

  return { devices };
}

function buildMetadata(payload = {}) {
  const title = String(payload.title || "").trim();
  const imageUrl = String(payload.imageUrl || "").trim();
  const metadata = {
    type: 0,
    metadataType: 0,
    title: title || "NOVA STREAM",
  };

  if (imageUrl) {
    metadata.images = [{ url: imageUrl }];
  }

  return metadata;
}

function normalizeMediaContentType(payload = {}) {
  const explicit = String(payload.contentType || "").trim();
  if (explicit) return explicit;

  if (String(payload.relayKind || "").toLowerCase() === "hls") {
    return "application/vnd.apple.mpegurl";
  }

  return "video/mp4";
}

async function connectAndLoad(payload = {}) {
  const host = String(payload.host || "").trim();
  const port = Number(payload.port) || 8009;
  const relayUrl = String(payload.relayUrl || "").trim();
  const timeoutMs = Math.max(
    4000,
    Number(payload.timeoutMs) || DEFAULT_CONNECT_TIMEOUT_MS,
  );

  if (!host) {
    throw new Error("Chromecast host is required");
  }

  if (!relayUrl) {
    throw new Error("Cast relay URL is required");
  }

  const client = await connectClient({ host, port, timeoutMs });

  try {
    const player = await launchReceiver(client, timeoutMs);
    const media = {
      contentId: relayUrl,
      contentType: normalizeMediaContentType(payload),
      streamType: "BUFFERED",
      metadata: buildMetadata(payload),
    };
    const options = {
      autoplay: payload.autoplay !== false,
      currentTime: Math.max(0, Number(payload.currentTime) || 0),
    };
    const status = await loadReceiver(player, media, options, timeoutMs);

    return {
      status: status
        ? {
            playerState: status.playerState || null,
            currentTime: Number(status.currentTime) || 0,
            mediaSessionId: status.mediaSessionId || null,
          }
        : null,
    };
  } finally {
    safeCloseClient(client);
  }
}

async function disconnectFromDevice(payload = {}) {
  const host = String(payload.host || "").trim();
  const port = Number(payload.port) || 8009;
  const timeoutMs = Math.max(
    3000,
    Number(payload.timeoutMs) || DEFAULT_DISCONNECT_TIMEOUT_MS,
  );

  if (!host) {
    throw new Error("Chromecast host is required");
  }

  const client = await connectClient({ host, port, timeoutMs });

  try {
    const session = findDefaultMediaSession(
      await getReceiverSessions(client, timeoutMs),
    );
    if (!session) {
      return {
        stopped: false,
        remainingApplications: 0,
      };
    }

    const player = await joinReceiverSession(client, session, timeoutMs);
    const applications = await stopReceiver(client, player, timeoutMs);

    return {
      stopped: true,
      remainingApplications: applications.length,
    };
  } finally {
    safeCloseClient(client);
  }
}

async function getDeviceStatus(payload = {}) {
  const host = String(payload.host || "").trim();
  const port = Number(payload.port) || 8009;
  const timeoutMs = Math.max(
    3000,
    Number(payload.timeoutMs) || DEFAULT_DISCONNECT_TIMEOUT_MS,
  );

  if (!host) {
    throw new Error("Chromecast host is required");
  }

  const client = await connectClient({ host, port, timeoutMs });

  try {
    const session = findDefaultMediaSession(
      await getReceiverSessions(client, timeoutMs),
    );
    if (!session) {
      return {
        connected: false,
        status: null,
      };
    }

    const player = await joinReceiverSession(client, session, timeoutMs);
    const status = await getReceiverStatus(player, timeoutMs);

    return {
      connected: true,
      status: status
        ? {
            playerState: status.playerState || null,
            currentTime: Number(status.currentTime) || 0,
            mediaSessionId: status.mediaSessionId || null,
            contentId: status.media?.contentId || null,
          }
        : null,
    };
  } finally {
    safeCloseClient(client);
  }
}

async function main() {
  const command = String(process.argv[2] || "")
    .trim()
    .toLowerCase();
  const payload = await readStdinJson();

  if (command === "discover") {
    writeJson(await discoverDevices(payload));
    return;
  }

  if (command === "connect") {
    writeJson(await connectAndLoad(payload));
    return;
  }

  if (command === "disconnect") {
    writeJson(await disconnectFromDevice(payload));
    return;
  }

  if (command === "status") {
    writeJson(await getDeviceStatus(payload));
    return;
  }

  throw new Error(`Unsupported cast bridge command: ${command || "<empty>"}`);
}

main().catch((error) => {
  process.stderr.write(
    String(error?.stack || error?.message || error || "Cast bridge failed"),
  );
  process.exit(1);
});
