import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const ATOMBERG_BASE = "https://api.developer.atomberg-iot.com";

/**
 * Helper: forward request to Atomberg
 */
async function atombergFetch(path, { method = "GET", headers = {}, body }) {
    const res = await fetch(`${ATOMBERG_BASE}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let json;
    try {
        json = JSON.parse(text);
    } catch {
        json = text;
    }

    return { status: res.status, data: json };
}

/**
 * 1️⃣ Get Access Token
 */
app.post("/api/get_access_token", async (req, res) => {
    const { apiKey, refreshToken } = req.body;

    const r = await atombergFetch("/v1/get_access_token", {
        method: "POST",
        headers: {
            "x-api-key": apiKey,
            Authorization: refreshToken,
            "Content-Type": "application/json",
        },
        body: {},
    });

    res.status(r.status).json(r.data);
});

/**
 * 2️⃣ Get Devices
 */
app.get("/api/devices", async (req, res) => {
    const { apiKey, accessToken } = req.headers;

    const r = await atombergFetch("/v1/get_list_of_devices", {
        headers: {
            "x-api-key": apiKey,
            Authorization: accessToken,
        },
    });

    res.status(r.status).json(r.data);
});

/**
 * 3️⃣ Get Device State
 */
app.get("/api/device_state", async (req, res) => {
    const { device_id } = req.query;
    const { apiKey, accessToken } = req.headers;

    const r = await atombergFetch(
        `/v1/get_device_state?device_id=${encodeURIComponent(device_id)}`,
        {
            headers: {
                "x-api-key": apiKey,
                Authorization: accessToken,
            },
        }
    );

    res.status(r.status).json(r.data);
});

/**
 * 4️⃣ Send Command
 */
app.post("/api/send_command", async (req, res) => {
    const { apiKey, accessToken } = req.headers;
    const { device_id, command } = req.body;

    const r = await atombergFetch("/v1/send_command", {
        method: "POST",
        headers: {
            "x-api-key": apiKey,
            Authorization: accessToken,
            "Content-Type": "application/json",
        },
        body: {
            device_id,
            command,
        },
    });

    res.status(r.status).json(r.data);
});

app.listen(3001, () =>
    console.log("✅ Atomberg proxy running on http://localhost:3001")
);
