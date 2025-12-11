import dgram from "dgram";
import { WebSocketServer } from "ws";
const UDP_PORT = 5625;
const WS_PORT = 9001;
const wss = new WebSocketServer({ port: WS_PORT });
console.log("WS server at ws://localhost:" + WS_PORT);
function broadcast(obj) {
    const data = JSON.stringify(obj);
    wss.clients.forEach((c) => {
        if (c.readyState === 1) c.send(data);
    });
}
const udp = dgram.createSocket("udp4");
udp.on("listening", () => {
    console.log("Listening for UDP packets on port", UDP_PORT);
});
udp.on("message", (msg) => {
    try {
        const hex = msg.toString("utf8").trim();
        const ascii = Buffer.from(hex, "hex").toString("utf8");
        const json = JSON.parse(ascii);
        const parsed = parseStateString(json.device_id, json.state_string);
        broadcast({
            type: "fan_state",
            rawHex: hex,
            rawAscii: ascii,
            ...parsed,
        });
    } catch (e) {
        console.log("Invalid UDP packet:", e.message);
    }
});
function parseStateString(deviceId, s) {
    const parts = s.split(",");
    const value = parseInt(parts[0]);
    const power = (value & 0x10) > 0;
    const led = (value & 0x20) > 0;
    const sleep = (value & 0x80) > 0;
    const speed = value & 0x07;
    const fanTimer = ((0x0F0000 & value) / 65536) | 0;
    const fanTimerElapsedMins = ((0xFF000000 & value) * 4 / 16777216) | 0;
    const brightness = ((0x7F00 & value) / 256) | 0;
    const cool = (value & 0x08) > 0;
    const warm = (value & 0x8000) > 0;
    let color = "none";
    if (cool && warm) color = "daylight";
    else if (cool) color = "cool";
    else if (warm) color = "warm";
    return {
        device_id: deviceId,
        power,
        led,
        sleep,
        speed,
        fanTimer,
        fanTimerElapsedMins,
        brightness,
        color,
    };
}
udp.bind(UDP_PORT);
