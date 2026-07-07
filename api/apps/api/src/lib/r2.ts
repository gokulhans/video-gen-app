import { AwsClient } from "aws4fetch";
import type { Env } from "../env";

export type PresignBucket = "assets" | "renders" | "uploads";

const BUCKET_NAMES: Record<PresignBucket, string> = {
	assets: "assets",
	renders: "renders",
	uploads: "uploads",
};

function client(env: Env) {
	return new AwsClient({
		accessKeyId: env.R2_ACCESS_KEY_ID,
		secretAccessKey: env.R2_SECRET_ACCESS_KEY,
		service: "s3",
		region: "auto",
	});
}

function endpoint(env: Env, bucket: PresignBucket, key: string) {
	return `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${BUCKET_NAMES[bucket]}/${key}`;
}

/** Presigned PUT URL (upload), valid for `expiresInSeconds`. */
export async function presignPut(
	env: Env,
	bucket: PresignBucket,
	key: string,
	contentType: string,
	expiresInSeconds = 600,
): Promise<string> {
	const aws = client(env);
	const url = new URL(endpoint(env, bucket, key));
	url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));

	const signed = await aws.sign(
		new Request(url.toString(), {
			method: "PUT",
			headers: { "content-type": contentType },
		}),
		{ aws: { signQuery: true } },
	);
	return signed.url;
}

/** Presigned GET URL (download), valid for `expiresInSeconds`. */
export async function presignGet(
	env: Env,
	bucket: PresignBucket,
	key: string,
	expiresInSeconds = 600,
): Promise<string> {
	const aws = client(env);
	const url = new URL(endpoint(env, bucket, key));
	url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));

	const signed = await aws.sign(new Request(url.toString(), { method: "GET" }), {
		aws: { signQuery: true },
	});
	return signed.url;
}
