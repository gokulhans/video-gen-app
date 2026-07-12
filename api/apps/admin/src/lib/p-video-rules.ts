export const P_VIDEO_PROVIDER_KEY = "replicate";
export const P_VIDEO_MODEL_KEY = "prunaai/p-video";
export const P_VIDEO_PINNED_DIGEST = "68b33d8ba1189a1a997abf2c09edc5bbb90d6cfa239befbf9c903bcfee7f9a59";
export const P_VIDEO_TEST_PRICE_KEY = "pvideo_test";
export const P_VIDEO_TEST_CREDITS = 5;

export type PVideoPublishState = {
	pipelineType: string;
	providerKey: string | null;
	modelKey: string | null;
	modelVersionRef: string | null;
	configProvider: unknown;
	configModel: unknown;
	configModelVersion: unknown;
	defaultsValid: boolean;
	mode: unknown;
	testDefaultsValid: boolean;
	pricingKey: string | null;
	creditAmount: number | null;
};

export function validatePVideoPublishState(state: PVideoPublishState): string[] {
	if (state.pipelineType !== "p_video") return [];
	const errors: string[] = [];
	if (state.providerKey !== P_VIDEO_PROVIDER_KEY || state.configProvider !== P_VIDEO_PROVIDER_KEY) errors.push("P-Video must use the Replicate provider");
	if (state.modelKey !== P_VIDEO_MODEL_KEY || state.configModel !== P_VIDEO_MODEL_KEY) errors.push("P-Video must use prunaai/p-video");
	if (state.modelVersionRef !== P_VIDEO_PINNED_DIGEST || state.configModelVersion !== P_VIDEO_PINNED_DIGEST) errors.push("P-Video must use the pinned 64-character model digest");
	if (!state.defaultsValid) errors.push("P-Video defaults are invalid or incomplete");
	if (state.mode === "test") {
		if (!state.testDefaultsValid) errors.push("P-Video test mode must use 1 second, 720p, 24 fps, draft rendering, prompt upsampling, and no generated audio");
		if (state.pricingKey !== P_VIDEO_TEST_PRICE_KEY || state.creditAmount !== P_VIDEO_TEST_CREDITS) errors.push("P-Video test mode must use the pinned 5-credit test price");
	}
	return errors;
}
