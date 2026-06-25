const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const ping = require('ping');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = 3000;
const LOG_FILE = path.join(__dirname, 'network_logs.json');
const TARGET_HOST = '8.8.8.8'; // Bisa kamu ganti jadi IP Gateway routermu (misal 192.168.1.1)
const LATENCY_THRESHOLD = 100; // Batas ms untuk kategori lemot (spike)

// Pastikan file JSON log siap
if (!fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, JSON.stringify([], null, 2));
}

app.use(express.static('public'));

// API untuk membaca file JSON
app.get('/api/logs', (req, res) => {
    fs.readFile(LOG_FILE, 'utf8', (err, data) => {
        if (err) return res.status(500).send("Gagal membaca log.");
        res.json(JSON.parse(data));
    });
});

// Fungsi untuk mencatat log ke JSON
function logEvent(type, details) {
    fs.readFile(LOG_FILE, 'utf8', (err, data) => {
        let logs = [];
        if (!err && data) {
            try { logs = JSON.parse(data); } catch (e) { logs = []; }
        }
        
        const newLog = {
            timestamp: new Date().toLocaleString('id-ID'),
            type: type, // 'DOWN', 'SLOW', atau 'SPEEDTEST'
            ...details
        };
        
        logs.push(newLog);
        fs.writeFile(LOG_FILE, JSON.stringify(logs, null, 2), (err) => {
            if (err) console.error("Gagal menulis file log:", err);
        });
    });
}

let logCounter = 0;

// Loop Ping (Berjalan setiap 2 detik)
setInterval(async () => {
    let res = await ping.promise.probe(TARGET_HOST, { timeout: 2 });
    let time = res.time === 'unknown' ? 0 : Math.round(res.time);
    let status = "NORMAL";

    if (time === 0) {
        status = "DOWN";
        logEvent("DOWN", { ping_ms: 0, message: "Koneksi Terputus (0 ms / RTO)" });
    } else if (time > LATENCY_THRESHOLD) {
        status = "SLOW";
        logEvent("SLOW", { ping_ms: time, message: `Ping Spike / Lemot (> ${LATENCY_THRESHOLD}ms)` });
    } else {
        // Biar file JSON ga bengkak, simpan ping normal tiap 5x putaran (sekitar 10 detik sekali)
        logCounter++;
        if (logCounter >= 5) {
            logEvent("NORMAL", { ping_ms: time, message: "Koneksi Normal" });
            logCounter = 0;
        }
    }

    // Kirim data realtime ke Web via WebSocket
    const dataPayload = JSON.stringify({ type: 'PING', status, time, timestamp: new Date().toLocaleTimeString() });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(dataPayload);
    });
}, 2000);


// Loop Speedtest Berkala (Setiap 1 menit)
setInterval(() => {
    console.log("Sedang menjalankan speedtest berkala...");
    exec('speedtest-cli --json', (err, stdout, stderr) => {
        if (err) {
            console.error("Speedtest gagal:", stderr);
            return;
        }
        try {
            const result = JSON.parse(stdout);
            const downloadMbit = (result.download / 1000000).toFixed(2);
            const uploadMbit = (result.upload / 1000000).toFixed(2);
            const pingSpeedtest = Math.round(result.ping);
            
            logEvent("SPEEDTEST", { download: `${downloadMbit} Mbps`, upload: `${uploadMbit} Mbps`, ping: pingSpeedtest });
            
            // Kirim hasil speedtest ke Web
            const speedPayload = JSON.stringify({ type: 'SPEEDTEST', download: downloadMbit, upload: uploadMbit });
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) client.send(speedPayload);
            });
        } catch (e) {
            console.error("Gagal memproses data speedtest");
        }
    });
}, 60000); // 60000 ms = 1 menit

server.listen(PORT, () => {
    console.log(`Server aktif! Silakan akses http://localhost:${PORT}`);
});
