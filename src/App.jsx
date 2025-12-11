import React, { useEffect, useState, useRef } from "react";

const API_BASE = "https://api.developer.atomberg-iot.com";
const DEFAULT_WS = "ws://localhost:9001";

function decodeStateValue(value) {
  const num = Number(value) || 0;
  return {
    power: (num & 0x10) > 0,
    led: (num & 0x20) > 0,
    sleep: (num & 0x80) > 0,
    speed: num & 0x07,
    fanTimer: ((num & 0x0F0000) >>> 16),
    fanTimerElapsedMins: Math.round(((num & 0xFF000000) >>> 24) * 4),
    brightness: ((num & 0x7F00) >>> 8),
    cool: (num & 0x08) > 0,
    warm: (num & 0x8000) > 0,
    color: (num & 0x08) > 0 && (num & 0x8000) > 0 ? "daylight" : (num & 0x08) > 0 ? "cool" : (num & 0x8000) > 0 ? "warm" : "none",
  };
}

export default function App() {
  const [apiKey, setApiKey] = useState(localStorage.getItem("atomberg_api_key") || "");
  const [refreshToken, setRefreshToken] = useState(localStorage.getItem("atomberg_refresh_token") || "");
  const [accessToken, setAccessToken] = useState(localStorage.getItem("atomberg_access_token") || "");
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [deviceState, setDeviceState] = useState(null);
  const [wsUrl, setWsUrl] = useState(localStorage.getItem("atomberg_ws_url") || DEFAULT_WS);
  const wsRef = useRef(null);

  useEffect(() => {
    localStorage.setItem("atomberg_api_key", apiKey);
  }, [apiKey]);

  useEffect(() => {
    localStorage.setItem("atomberg_refresh_token", refreshToken);
  }, [refreshToken]);

  useEffect(() => {
    localStorage.setItem("atomberg_access_token", accessToken);
  }, [accessToken]);

  useEffect(() => {
    localStorage.setItem("atomberg_ws_url", wsUrl);
  }, [wsUrl]);

  async function getAccessToken() {
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/v1/get_access_token`, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          Authorization: refreshToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message || `Token request failed: ${res.status}`);

      const token = json.access_token || json.accessToken || json.accessTokenString || "";
      if (!token) throw new Error("No access token returned by API. See response in console.");
      setAccessToken(token);
      localStorage.setItem("atomberg_access_token", token);
      setLoading(false);
      return token;
    } catch (err) {
      console.error("getAccessToken:", err);
      setError(err.message || String(err));
      setLoading(false);
      throw err;
    }
  }

  function authHeaders(useAccess = true) {
    const headers = { "x-api-key": apiKey };
    if (useAccess && accessToken) headers["Authorization"] = accessToken;
    return headers;
  }

  async function fetchDevices() {
    setError("");
    setLoading(true);
    try {
      if (!accessToken) await getAccessToken();
      const res = await fetch(`${API_BASE}/v1/get_list_of_devices`, {
        method: "GET",
        headers: authHeaders(true),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message || `Get devices failed: ${res.status}`);
      const list = json.devices || json || [];
      const normalized = (Array.isArray(list) ? list : []).map((d) => ({
        device_id: d.device_id || d.id || d.uuid || d._id,
        device_name: d.device_name || d.name || d.alias || `Fan ${d.device_id || d.id}`,
        raw: d,
      }));
      setDevices(normalized);
      setLoading(false);
      return normalized;
    } catch (err) {
      console.error("fetchDevices:", err);
      setError(err.message || String(err));
      setLoading(false);
    }
  }

  async function getDeviceState(deviceId) {
    setError("");
    setLoading(true);
    try {
      if (!accessToken) await getAccessToken();
      const res = await fetch(`${API_BASE}/v1/get_device_state?device_id=${encodeURIComponent(deviceId)}`, {
        method: "GET",
        headers: authHeaders(true),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message || `Get device state failed: ${res.status}`);

      const state_string = json.state_string || (json.raw && json.raw.state_string) || "";
      const parts = (state_string || "").split(",");
      const firstField = Number(parts[0]) || 0;
      const decoded = decodeStateValue(firstField);
      const full = { raw: json, decoded, parts };
      setDeviceState(full);
      setLoading(false);
      return full;
    } catch (err) {
      console.error("getDeviceState:", err);
      setError(err.message || String(err));
      setLoading(false);
    }
  }

  async function sendCommand(deviceId, commandObj) {
    setError("");
    setLoading(true);
    try {
      if (!accessToken) await getAccessToken();
      const body = {
        device_id: deviceId,
        command: commandObj,
      };
      const res = await fetch(`${API_BASE}/v1/send_command`, {
        method: "POST",
        headers: {
          ...authHeaders(true),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message || `Send command failed: ${res.status}`);

      await getDeviceState(deviceId).catch(() => { });
      setLoading(false);
      return json;
    } catch (err) {
      console.error("sendCommand:", err);
      setError(err.message || String(err));
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!wsUrl) return;
    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.onopen = () => {
        console.log("WS connected to", wsUrl);
      };
      ws.onmessage = (ev) => {
        try {
          const m = JSON.parse(ev.data);
          console.log("WS update:", m);
          if (selectedDevice && m.device_id === selectedDevice.device_id) {
            const parts = (m.state_string || "").split(",");
            const val = Number(parts[0]) || 0;
            const decoded = decodeStateValue(val);
            setDeviceState({ raw: m, decoded, parts });
          }
          setDevices((prev) =>
            prev.map((d) =>
              d.device_id === m.device_id ? { ...d, lastSeen: Date.now(), rawUdp: m } : d
            )
          );
        } catch (e) {
          console.warn("WS message parse error", e, ev.data);
        }
      };
      ws.onclose = () => {
        console.log("WS closed");
      };
      ws.onerror = (e) => console.warn("WS error", e);
      return () => {
        try {
          ws.close();
        } catch (e) { }
      };
    } catch (e) {
      console.warn("ws connect failed", e);
    }
  }, [wsUrl, selectedDevice]);

  const uiTogglePower = async (device) => {
    const wantOn = !(deviceState?.decoded?.power);
    await sendCommand(device.device_id, { power: wantOn });
  };

  const uiSetSpeed = async (device, speed) => {
    if (speed < 1 || speed > 6) return alert("Speed must be 1-6");
    await sendCommand(device.device_id, { speed: speed });
  };

  const uiSetLed = async (device, on) => {
    await sendCommand(device.device_id, { led: on });
  };

  const uiSetBrightness = async (device, value) => {
    if (value < 10 || value > 100) return alert("brightness 10-100");
    await sendCommand(device.device_id, { brightness: value });
  };

  const uiSetTimer = async (device, val) => {
    await sendCommand(device.device_id, { timer: val });
  };

  return (
    <div className="min-h-screen bg-slate-900 ">
      <div className="max-w-7xl mx-auto p-6">
        <div className="mb-8">
          <img src="https://images.yourstory.com/cs/2/e35953e0c10a11eeaef14be6ff40ae87/Imagey4c9-1710955199100.jpg?mode=crop&crop=faces&ar=2%3A1&format=auto&w=1920&q=75" alt="Atomberg Logo" className="h-16 mb-4" />
          <h1 className="text-4xl font-bold text-white mb-2">Atomberg Fan Controller</h1>
          <p className="text-blue-200">Smart home control interface</p>
        </div>
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 mb-6 border border-white/20">
          <h2 className="text-xl font-semibold text-white mb-4">API Configuration</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-blue-200 mb-2">API Key (x-api-key)</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="w-full px-4 py-2 bg-white/5 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter your API key"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-blue-200 mb-2">Refresh Token</label>
              <input
                type="password"
                value={refreshToken}
                onChange={(e) => setRefreshToken(e.target.value)}
                className="w-full px-4 py-2 bg-white/5 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter your refresh token"
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => getAccessToken()}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors">
                Get Access Token
              </button>
              <button
                onClick={() => fetchDevices()}
                className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors"
              >
                Fetch Devices
              </button>
              <button
                onClick={() => {
                  setDevices([]);
                  setDeviceState(null);
                  setSelectedDevice(null);
                  localStorage.removeItem("atomberg_access_token");
                  setAccessToken("");
                }}
                className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors">
                Clear
              </button>
            </div>
          </div>
        </div>
        {error && (
          <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4 mb-6">
            <p className="text-red-200">{error}</p>
          </div>
        )}
        {loading && (
          <div className="bg-blue-500/20 border border-blue-500/50 rounded-lg p-4 mb-6">
            <p className="text-blue-200">Loading...</p>
          </div>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20">
            <h2 className="text-2xl font-semibold text-white mb-4">Devices</h2>
            {devices.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                No devices. Click Fetch Devices.
              </div>
            ) : (
              <div className="space-y-3">
                {devices.map((d) => (
                  <div
                    key={d.device_id}
                    className={`p-4 rounded-xl border transition-all ${selectedDevice?.device_id === d.device_id
                      ? 'bg-blue-500/30 border-blue-400'
                      : 'bg-white/5 border-white/10 hover:bg-white/10'
                      }`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="font-semibold text-white text-lg">{d.device_name}</h3>
                        <p className="text-sm text-gray-400">{d.device_id}</p>
                        {d.lastSeen && (
                          <p className="text-xs text-green-400 mt-1">
                            Last UDP: {new Date(d.lastSeen).toLocaleTimeString()}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setSelectedDevice(d);
                          getDeviceState(d.device_id);
                        }}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
                      >
                        Inspect
                      </button>
                      <button
                        onClick={() => uiTogglePower(d)}
                        className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-sm rounded-lg transition-colors"
                      >
                        Toggle Power
                      </button>
                      <button
                        onClick={() => setSelectedDevice(d)}
                        className="px-3 py-1.5 bg-gray-600 hover:bg-gray-700 text-white text-sm rounded-lg transition-colors"
                      >
                        Select
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20">
            <h2 className="text-2xl font-semibold text-white mb-4">Device Control</h2>
            {!selectedDevice ? (
              <div className="text-center py-8 text-gray-400">
                No device selected
              </div>
            ) : (
              <div className="space-y-6">
                <div className="pb-4 border-b border-white/10">
                  <h3 className="text-xl font-semibold text-white">{selectedDevice.device_name}</h3>
                  <p className="text-sm text-gray-400">{selectedDevice.device_id}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => getDeviceState(selectedDevice.device_id)}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm"
                  >
                    Get State
                  </button>
                  <button
                    onClick={() => uiTogglePower(selectedDevice)}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors text-sm"
                  >
                    Toggle Power
                  </button>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-blue-200 mb-2">LED Control</h4>
                  <div className="flex gap-2">
                    <button
                      onClick={() => uiSetLed(selectedDevice, true)}
                      className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors text-sm"
                    >
                      LED ON
                    </button>
                    <button
                      onClick={() => uiSetLed(selectedDevice, false)}
                      className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors text-sm"
                    >
                      LED OFF
                    </button>
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-blue-200 mb-2">Speed Control</h4>
                  <div className="grid grid-cols-6 gap-2">
                    {[1, 2, 3, 4, 5, 6].map((s) => (
                      <button
                        key={s}
                        onClick={() => uiSetSpeed(selectedDevice, s)}
                        className={`px-4 py-2 rounded-lg transition-colors text-sm font-medium ${deviceState?.decoded?.speed === s
                          ? 'bg-blue-600 text-white'
                          : 'bg-white/10 text-white hover:bg-white/20'
                          }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-blue-200 mb-2">Timer</h4>
                  <div className="grid grid-cols-5 gap-2">
                    {[
                      { label: 'Off', val: 0 },
                      { label: '1h', val: 1 },
                      { label: '2h', val: 2 },
                      { label: '3h', val: 3 },
                      { label: '6h', val: 4 },
                    ].map((t) => (
                      <button
                        key={t.val}
                        onClick={() => uiSetTimer(selectedDevice, t.val)}
                        className="px-3 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors text-sm"
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-blue-200 mb-2">Brightness (10-100)</h4>
                  <div className="grid grid-cols-5 gap-2">
                    {[20, 40, 60, 80, 100].map((v) => (
                      <button
                        key={v}
                        onClick={() => uiSetBrightness(selectedDevice, v)}
                        className="px-3 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors text-sm"
                      >
                        {v}%
                      </button>
                    ))}
                  </div>
                </div>
                {/* Device State Display */}
                <div className="pt-4 border-t border-white/10">
                  <h4 className="text-lg font-semibold text-white mb-3">Device State</h4>
                  {!deviceState ? (
                    <div className="text-center py-4 text-gray-400 text-sm">
                      No state loaded. Click Get State or wait for UDP update.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-white/5 rounded-lg p-3">
                          <p className="text-xs text-gray-400 mb-1">Power</p>
                          <p className={`text-lg font-semibold ${deviceState.decoded.power ? 'text-green-400' : 'text-red-400'}`}>
                            {deviceState.decoded.power ? 'ON' : 'OFF'}
                          </p>
                        </div>
                        <div className="bg-white/5 rounded-lg p-3">
                          <p className="text-xs text-gray-400 mb-1">Speed</p>
                          <p className="text-lg font-semibold text-blue-400">{deviceState.decoded.speed}</p>
                        </div>
                        <div className="bg-white/5 rounded-lg p-3">
                          <p className="text-xs text-gray-400 mb-1">LED</p>
                          <p className={`text-lg font-semibold ${deviceState.decoded.led ? 'text-green-400' : 'text-gray-400'}`}>
                            {deviceState.decoded.led ? 'ON' : 'OFF'}
                          </p>
                        </div>
                        <div className="bg-white/5 rounded-lg p-3">
                          <p className="text-xs text-gray-400 mb-1">Sleep Mode</p>
                          <p className={`text-lg font-semibold ${deviceState.decoded.sleep ? 'text-purple-400' : 'text-gray-400'}`}>
                            {deviceState.decoded.sleep ? 'ON' : 'OFF'}
                          </p>
                        </div>
                        <div className="bg-white/5 rounded-lg p-3">
                          <p className="text-xs text-gray-400 mb-1">Brightness</p>
                          <p className="text-lg font-semibold text-yellow-400">{deviceState.decoded.brightness}</p>
                        </div>
                        <div className="bg-white/5 rounded-lg p-3">
                          <p className="text-xs text-gray-400 mb-1">Color</p>
                          <p className="text-lg font-semibold text-orange-400 capitalize">{deviceState.decoded.color}</p>
                        </div>
                      </div>
                      <details className="bg-white/5 rounded-lg p-3">
                        <summary className="text-sm font-medium text-blue-200 cursor-pointer">Raw Data</summary>
                        <pre className="mt-2 text-xs text-gray-300 overflow-x-auto">
                          {JSON.stringify(deviceState, null, 2)}
                        </pre>
                      </details>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
