/**
 * Remotion render HTTP server for the `RendererContainer` (apps/render).
 *
 * POST /render         -> accepts a RenderRequest JSON body, starts an async
 *                          renderMedia() run, responds immediately (202) so
 *                          the caller polls progress instead of holding the
 *                          connection open for the whole render.
 * GET  /progress/:jobId -> { status, progress, videoUrl?, error? } — polled
 *                          by the render worker's queue consumer.
 * GET  /healthz         -> liveness check.
 */
import http from "node:http";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { AwsClient } from "aws4fetch";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const COMPOSITION_ID = "MainComposition";

/** @type {Map<string, { status: string, progress: number, videoUrl?: string, key?: string, error?: string }>} */
const jobs = new Map();

/** @type {Promise<string> | null} */
let serveUrlPromise = null;

function getServeUrl() {
	if (!serveUrlPromise) {
		serveUrlPromise = bundle({
			entryPoint: path.join(__dirname, "remotion", "index.js"),
			onProgress: () => {},
		});
	}
	return serveUrlPromise;
}

// Warm the bundle as soon as the process starts, so the first /render call
// doesn't pay the bundling cost on top of render time.
getServeUrl().catch((err) => {
	console.error("Failed to bundle Remotion project at startup", err);
});

function r2Client() {
	return new AwsClient({
		accessKeyId: process.env.R2_ACCESS_KEY_ID,
		secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
		service: "s3",
		region: "auto",
	});
}

async function uploadToR2(localPath, key) {
	const accountId = process.env.R2_ACCOUNT_ID;
	const bucket = process.env.R2_RENDERS_BUCKET_NAME || "renders";
	if (!accountId || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
		throw new Error("R2 credentials missing (R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY env vars)");
	}

	const endpoint = `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
	const body = await fsp.readFile(localPath);
	const client = r2Client();

	const res = await client.fetch(endpoint, {
		method: "PUT",
		body,
		headers: { "content-type": "video/mp4" },
	});

	if (!res.ok) {
		throw new Error(`R2 upload failed: ${res.status} ${await res.text()}`);
	}
}

async function runRender(renderRequest) {
	const { jobId, composition, resolution, outputKey } = renderRequest;
	jobs.set(jobId, { status: "rendering", progress: 0 });

	const tmpOut = path.join(os.tmpdir(), `${jobId}.mp4`);

	try {
		const serveUrl = await getServeUrl();
		const inputProps = { composition, resolution };

		const { composition: selected } = await selectComposition({
			serveUrl,
			id: COMPOSITION_ID,
			inputProps,
		});

		await renderMedia({
			composition: selected,
			serveUrl,
			codec: "h264",
			outputLocation: tmpOut,
			inputProps,
			concurrency: os.cpus().length,
			onProgress: ({ progress }) => {
				// Reserve the last ~10% of the progress bar for the R2 upload.
				const pct = Math.min(Math.round(progress * 90), 90);
				jobs.set(jobId, { status: "rendering", progress: pct });
			},
		});

		jobs.set(jobId, { status: "uploading", progress: 92 });
		await uploadToR2(tmpOut, outputKey);

		jobs.set(jobId, { status: "completed", progress: 100, videoUrl: outputKey, key: outputKey });
	} catch (err) {
		console.error(`Render failed for job ${jobId}`, err);
		jobs.set(jobId, {
			status: "failed",
			progress: 0,
			error: err instanceof Error ? err.message : String(err),
		});
	} finally {
		fsp.unlink(tmpOut).catch(() => {});
	}
}

function readJsonBody(req) {
	return new Promise((resolve, reject) => {
		let data = "";
		req.on("data", (chunk) => {
			data += chunk;
		});
		req.on("end", () => {
			if (!data) return resolve(null);
			try {
				resolve(JSON.parse(data));
			} catch (err) {
				reject(err);
			}
		});
		req.on("error", reject);
	});
}

const server = http.createServer(async (req, res) => {
	try {
		const url = new URL(req.url, `http://${req.headers.host}`);

		if (req.method === "GET" && url.pathname === "/healthz") {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ ok: true }));
			return;
		}

		if (req.method === "POST" && url.pathname === "/render") {
			let body;
			try {
				body = await readJsonBody(req);
			} catch {
				res.writeHead(400, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: { code: "invalid_json", message: "Malformed JSON body" } }));
				return;
			}

			if (!body?.jobId || !body?.composition || !body?.resolution || !body?.outputKey) {
				res.writeHead(400, { "content-type": "application/json" });
				res.end(
					JSON.stringify({
						error: { code: "invalid_request", message: "Missing jobId/composition/resolution/outputKey" },
					}),
				);
				return;
			}

			jobs.set(body.jobId, { status: "starting", progress: 0 });
			// Fire-and-forget: the caller polls GET /progress/:jobId instead of
			// holding this connection open for the whole render.
			runRender(body).catch((err) => console.error("runRender threw", err));

			res.writeHead(202, { "content-type": "application/json" });
			res.end(JSON.stringify({ accepted: true, jobId: body.jobId }));
			return;
		}

		const progressMatch = url.pathname.match(/^\/progress\/([^/]+)$/);
		if (req.method === "GET" && progressMatch) {
			const jobId = progressMatch[1];
			const job = jobs.get(jobId);
			if (!job) {
				res.writeHead(404, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: { code: "not_found", message: "Unknown job" } }));
				return;
			}
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify(job));
			return;
		}

		res.writeHead(404, { "content-type": "application/json" });
		res.end(JSON.stringify({ error: { code: "not_found", message: "Unknown route" } }));
	} catch (err) {
		console.error("Request handler error", err);
		res.writeHead(500, { "content-type": "application/json" });
		res.end(
			JSON.stringify({ error: { code: "internal_error", message: err instanceof Error ? err.message : String(err) } }),
		);
	}
});

server.listen(PORT, () => {
	console.log(`Renderer container listening on :${PORT}`);
});
