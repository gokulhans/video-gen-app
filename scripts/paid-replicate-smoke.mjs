const VERSION = "68b33d8ba1189a1a997abf2c09edc5bbb90d6cfa239befbf9c903bcfee7f9a59";
const EXPECTED_MAX_USD = 0.01;
const confirmation = process.env.ALLOW_PAID_REPLICATE_SMOKE;
const configuredBudget = Number(process.env.REPLICATE_SMOKE_MAX_USD);
const token = process.env.REPLICATE_API_TOKEN;

if (confirmation !== "RUN_ONE_PAID_PVIDEO_TEST") throw new Error("paid smoke confirmation is missing");
if (!token) throw new Error("REPLICATE_API_TOKEN is missing");
if (!Number.isFinite(configuredBudget) || configuredBudget <= 0 || configuredBudget > EXPECTED_MAX_USD) {
  throw new Error(`REPLICATE_SMOKE_MAX_USD must be > 0 and <= ${EXPECTED_MAX_USD}`);
}

const headers = {
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
  prefer: "wait=10",
  "cancel-after": "90s",
};
const response = await fetch(`https://api.replicate.com/v1/predictions`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    version: VERSION,
    input: {
      prompt: "A single white ceramic cup slowly rotating on a neutral studio background, safe commercial product test",
      duration: 1,
      aspect_ratio: "16:9",
      resolution: "720p",
      fps: 24,
      draft: true,
      prompt_upsampling: true,
      disable_safety_filter: false,
      save_audio: false,
      seed: 1,
    },
  }),
});
if (!response.ok) throw new Error(`Replicate create failed (${response.status})`);
let prediction = await response.json();
if (prediction.version !== VERSION || typeof prediction.id !== "string") throw new Error("Replicate returned an unexpected prediction");

const deadline = Date.now() + 4 * 60_000;
while (!["succeeded", "failed", "canceled"].includes(prediction.status) && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  const poll = await fetch(prediction.urls.get, { headers: { authorization: `Bearer ${token}` } });
  if (!poll.ok) throw new Error(`Replicate poll failed (${poll.status})`);
  prediction = await poll.json();
}
if (prediction.status !== "succeeded") {
  if (prediction.urls?.cancel && !["failed", "canceled"].includes(prediction.status)) {
    await fetch(prediction.urls.cancel, { method: "POST", headers: { authorization: `Bearer ${token}` } });
  }
  throw new Error(`Replicate paid smoke ended with ${prediction.status}`);
}
if (typeof prediction.output !== "string" || !prediction.output.startsWith("https://")) {
  throw new Error("Replicate paid smoke returned no HTTPS video output");
}
console.log(JSON.stringify({ event: "paid_replicate_smoke_passed", predictionId: prediction.id, version: VERSION }));
