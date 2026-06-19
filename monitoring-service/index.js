require("dotenv").config();

const express = require("express");
const client = require("prom-client");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(cors());
app.use(express.json());

/* ==============================
   SUPABASE CONFIG
============================== */

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

/* ==============================
   PROMETHEUS SETUP
============================== */

// Use default global registry
client.collectDefaultMetrics();

/* ==============================
   BUSINESS METRICS
============================== */

// Total Employees
const totalEmployees = new client.Gauge({
  name: "app_total_employees",
  help: "Total number of employees",
});

// Total Projects
const totalProjects = new client.Gauge({
  name: "app_total_projects",
  help: "Total number of projects",
});

// HTTP Request Counter
const httpRequests = new client.Counter({
  name: "app_http_requests_total",
  help: "Total HTTP requests",
});

// Error Counter
const httpErrors = new client.Counter({
  name: "app_http_errors_total",
  help: "Total HTTP errors",
});

// Latency Histogram
const requestLatency = new client.Histogram({
  name: "employee_app_latency_ms",
  help: "Latency of employee app operations",
  buckets: [100, 300, 500, 1000, 2000],
});

/* ==============================
   MIDDLEWARE
============================== */

app.use((req, res, next) => {
  const start = Date.now();
  httpRequests.inc();

  res.on("finish", () => {
    const duration = Date.now() - start;
    requestLatency.observe(duration);

    if (res.statusCode >= 400) {
      httpErrors.inc();
    }
  });

  next();
});

/* ==============================
   UPDATE BUSINESS METRICS
============================== */

async function updateBusinessMetrics() {
  try {
    const { count: empCount, error: empError } = await supabase
      .from("employees")
      .select("*", { count: "exact", head: true });

    const { count: projCount, error: projError } = await supabase
      .from("projects")
      .select("*", { count: "exact", head: true });

    console.log("Employees:", empCount);
    console.log("Projects:", projCount);

    if (empError) console.log("Employee Error:", empError.message);
    if (projError) console.log("Project Error:", projError.message);

    totalEmployees.set(empCount || 0);
    totalProjects.set(projCount || 0);
  } catch (err) {
    console.error("Main Catch Error:", err);
  }
}

// Run immediately once
updateBusinessMetrics();

// Then update every 10 seconds
setInterval(updateBusinessMetrics, 10000);

/* ==============================
   METRICS ENDPOINT
============================== */

app.get("/metrics", async (req, res) => {
  res.set("Content-Type", client.register.contentType);
  res.end(await client.register.metrics());
});

/* ==============================
   RESTART API (CONTROL ACTION)
============================== */

app.get("/restart", (req, res) => {
  const { exec } = require("child_process");

  exec("docker restart monitoring-applications-employee-app-1", (err, stdout, stderr) => {
    if (err) {
      console.error("ERROR:", err);
      console.error("STDERR:", stderr);
      return res.send("❌ Restart failed");
    }
    console.log("STDOUT:", stdout);
    res.send("✅ App restarted successfully");
  });
});

/* ==============================
   START SERVER
============================== */

app.listen(4000, "0.0.0.0", () => {
  console.log("✅ Monitoring service running on port 4000");
});

let lastErrorCount = 0;

setInterval(async () => {
  const currentErrors = httpErrors.hashMap[""]?.value || 0;

  if (currentErrors - lastErrorCount > 5) {
    console.log("🚨 High errors detected! Restarting...");

    const { exec } = require("child_process");

    exec("docker restart monitoring-applications-employee-app-1", (err) => {
      if (err) console.error("Auto restart failed");
      else console.log("✅ Auto restarted app");
    });

    lastErrorCount = currentErrors;
  }
}, 10000);